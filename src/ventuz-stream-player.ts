import { H264Demuxer } from './muxer/h264-demuxer';
import { SlicesReader } from './muxer/h264-nal-slicesreader';
import { MP4Remuxer } from './muxer/mp4-remuxer';
import { logger } from './muxer/logger';

import './style.css';

// localize me, or something
const statusMsgs = {
    connecting: "Connecting...",
    noStream: "Waiting for stream...",
    playing: "",
    
    errNoRuntime: "Couldn't connect to VMS",
    errClosed: "Connection lost",
    errGeneric: "Error",
};

type StatusType = keyof typeof statusMsgs;

class VentuzStreamPlayer extends HTMLElement {
    static observedAttributes = ['url'];

    url: string;
    private ws: WebSocket | undefined;
    private streamHeader: StreamOut.StreamHeader | undefined;
    private frameHeader: StreamOut.FrameHeader | undefined;
    private mediaSource: MediaSource | undefined;
    private vidSrcBuffer: SourceBuffer | undefined;

    private video: HTMLVideoElement | undefined;
    private statusLine: HTMLDivElement | undefined;

    private slicesReader: SlicesReader | undefined;
    private h264Demuxer: H264Demuxer | undefined;
    private mp4Remuxer: MP4Remuxer | undefined;
    private queue: Uint8Array[] = [];

    private codec: string | undefined;

    private createSrcBuffer() {
        if (this.mediaSource) {
            if (this.vidSrcBuffer) this.mediaSource.removeSourceBuffer(this.vidSrcBuffer);

            this.vidSrcBuffer = this.mediaSource.addSourceBuffer(`video/mp4; codecs="${this.codec}"`);
            this.vidSrcBuffer.onerror = (e) => {
                logger.error('vid source error', e);
                this.closeStream();
            };
            this.vidSrcBuffer.onupdateend = () => {
                //                logger.log('updateend')
                this.handleQueue();
            };

            this.handleQueue();
        }
    }

    private openStream(hdr: StreamOut.StreamHeader) {
        logger.log('openStream');
        this.closeStream();

        this.streamHeader = hdr;
        while (hdr.videoFrameRateDen < 1000) {
            hdr.videoFrameRateNum *= 10;
            hdr.videoFrameRateDen *= 10;
        }

        this.mp4Remuxer = new MP4Remuxer({
            timeBase: hdr.videoFrameRateDen,
            timeScale: hdr.videoFrameRateNum,
            onInitSegment: (is) => {
                logger.log('got is', is);

                if (this.mediaSource) delete this.mediaSource;

                const mediaSource = (this.mediaSource = new MediaSource());
                mediaSource.setLiveSeekableRange;
                mediaSource.onsourceopen = () => {
                    mediaSource.duration = Infinity;
                    logger.log('source open');
                    this.createSrcBuffer();
                };

                if (this.video) {
                    try {
                        this.video.src = URL.createObjectURL(mediaSource);
                    } catch (error: any) {
                        console.log(error);
                    }

                    this.video.onerror = (e) => {
                        logger.error('video error', e);
                    };
                }

                this.onMuxerData(is.data);
            },

            onData: (data) => {
                //logger.log("got data", data)
                this.onMuxerData(data);
            },
        });

        this.h264Demuxer = new H264Demuxer({
            timeBase: hdr.videoFrameRateDen,

            forceKeyFrameOnDiscontinuity: false,

            onBufferReset: (codec) => {
                this.codec = codec;
                this.createSrcBuffer();
            },

            onVideo: (sn, track) => {
                this.mp4Remuxer?.pushVideo(sn, track);
            },
        });

        this.slicesReader = new SlicesReader({
            onNal: (data) => this.h264Demuxer?.pushData(data),
        });
    }

    private closeStream() {
        logger.log('closeStream');

        this.queue.length = 0;

        if (this.mediaSource && this.video) {
            URL.revokeObjectURL(this.video.src);
        }
        delete this.mediaSource;
        delete this.vidSrcBuffer;

        delete this.mp4Remuxer;
        delete this.h264Demuxer;
        delete this.slicesReader;

        delete this.frameHeader;
        delete this.streamHeader;
    }

    private onMuxerData(data: Uint8Array) {
        if (!this.mediaSource) return;

        this.queue.push(data);
        this.handleQueue();
    }

    private handleQueue() {
        if (this.queue.length > 0 && this.vidSrcBuffer && !this.vidSrcBuffer.updating) {
            // Remove old frames from the buffer
            if (this.vidSrcBuffer.buffered.length > 0) {
                const start = this.vidSrcBuffer.buffered.start(0);
                const end = this.vidSrcBuffer.buffered.end(0);
                const currentTime = this.video?.currentTime ?? 0;
                const bufferThreshold = 5;

                if (currentTime - start >= 2 * bufferThreshold) {
                    if (end > currentTime + 0.3) {
                        logger.log('jump!', currentTime, end);
                        this.video!.currentTime = end;
                    }
                    //logger.log('remove', start, currentTime - bufferThreshold);
                    this.vidSrcBuffer.remove(start, currentTime - bufferThreshold);
                    return;
                }
            }

            const data = this.queue.shift()!;
            //logger.log('dq', data.length)
            this.vidSrcBuffer.appendBuffer(data);
        }
    }

    private handlePacket(pkg: StreamOut.StreamPacket) {
        switch (pkg.type) {
            case 'connected':
                // create and connect muxer
                this.openStream(pkg.data);
                this.setStatus('playing');
                break;
            case 'disconnected':
                this.closeStream();
                this.setStatus('noStream');
                break;
            case 'error':
                logger.error('got error from VMS', pkg.data);
                this.setStatus('errGeneric');
                this.closeStream();
                break;
            case 'frame':
                this.frameHeader = pkg.data;
                break;
            default:
                throw new Error('pkg syntax');
        }
    }

    private handleVideoFrame(data: Uint8Array) {
        if (this.slicesReader && this.streamHeader && this.frameHeader) {
            this.slicesReader!.read(data);
            delete this.frameHeader;
        }
    }

    private openWS() {
        this.ws?.close();

        this.setStatus('connecting');
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            logger.log('WS open');
            this.setStatus('noStream');
        };

        this.ws.onclose = () => {
            logger.log('WS close');
            if (this.ws)
            {
                this.setStatus('errClosed');
                this.closeStream();    
            }
            delete this.ws;
        };

        this.ws.onerror = (ev) => {
            logger.log('WS error', ev);
            this.setStatus('errNoRuntime');
            delete this.ws;
        };

        this.ws.onmessage = (ev) => {
            if (typeof ev.data === 'string') {
                this.handlePacket(JSON.parse(ev.data) as StreamOut.StreamPacket);
                return;
            }

            this.handleVideoFrame(new Uint8Array(ev.data as ArrayBuffer));
        };
    }

    sendCommand(cmd: StreamOut.Command) {
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            //logger.log("sendcmd", cmd);
            this.ws.send(JSON.stringify(cmd));
        }
    }

    setStatus(status: StatusType) {
        if (this.statusLine) {
            this.statusLine.textContent = statusMsgs[status];
        }
    }

    //-------------------------------------------------------------------------------------------
    // Custom Element implementation

    constructor() {
        super();
        this.url = '';
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        switch (name) {
            case 'url':
                this.url = newValue ?? '';
                if (newValue !== oldValue && this.ws) this.openWS();
                break;
        }
    }

    connectedCallback() {
        logger.log('connectedCallback');

        const video = (this.video = document.createElement('video'));
        video.muted = true;
        video.autoplay = true;
        video.controls = false;

        video.onplaying = (_) => {
            if (this.vidSrcBuffer) {
                const end = this.vidSrcBuffer.buffered.end(0);
                const currentTime = this.video?.currentTime ?? 0;
                if (end > currentTime + 0.3) {
                    logger.log('jump!', currentTime, end);
                    video.currentTime = end;
                }
            }
        };

        const status = (this.statusLine = document.createElement('div'));
        status.className = 'vsp-statusdisplay';

        const overlay = /*this.overlay =*/ document.createElement('div');
        overlay.tabIndex = 0;
        overlay.appendChild(status);

        // Move all existing children of the component into the overlay
        while (this.firstChild) {
            overlay.appendChild(this.firstChild);
        }

        const getIntXY = (x: number, y: number) => {
            var rect = overlay.getBoundingClientRect();
            return {
                x: Math.round(((x - rect.left) * this.streamHeader!.videoWidth) / rect.width),
                y: Math.round(((y - rect.top) * this.streamHeader!.videoHeight) / rect.height),
            };
        };

        overlay.onpointerdown = (e) => {
            if (this.streamHeader) {
                if (e.pointerType === 'mouse') {
                    // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                    this.sendCommand({ type: 'mouseButtons', data: e.buttons });
                    overlay.setPointerCapture(e.pointerId);
                }

                if (e.pointerType === 'touch') {
                    this.sendCommand({
                        type: 'touchBegin',
                        data: {
                            ...getIntXY(e.clientX, e.clientY),
                            id: e.pointerId,
                        },
                    });
                }
            }

            overlay.focus();

            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onpointerup = (e) => {
            if (this.streamHeader) {
                if (e.pointerType === 'mouse') {
                    // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                    this.sendCommand({ type: 'mouseButtons', data: e.buttons });
                    overlay.releasePointerCapture(e.pointerId);
                }

                if (e.pointerType === 'touch') {
                    this.sendCommand({
                        type: 'touchEnd',
                        data: {
                            ...getIntXY(e.clientX, e.clientY),
                            id: e.pointerId,
                        },
                    });
                }
            }

            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onpointermove = (e) => {
            if (this.streamHeader) {
                if (e.pointerType === 'mouse') {
                    this.sendCommand({
                        type: 'mouseMove',
                        data: getIntXY(e.x, e.y),
                    });
                }

                if (e.pointerType === 'touch') {
                    this.sendCommand({
                        type: 'touchMove',
                        data: {
                            ...getIntXY(e.clientX, e.clientY),
                            id: e.pointerId,
                        },
                    });
                }
            }

            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onpointerover = (e) => {
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onpointercancel = (e) => {
            if (this.streamHeader && e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchCancel',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
            }

            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onpointerout = (e) => {
            if (this.streamHeader && e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchCancel',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
            }

            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onwheel = (e) => {
            if (this.streamHeader)
                this.sendCommand({
                    type: 'mouseWheel',
                    data: { x: -e.deltaX, y: -e.deltaY },
                });
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onclick = async (e) => {
            video.play();
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.oncontextmenu = (e) => {
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeypress = (e) => {
            // logger.log("press", e);
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeyup = (e) => {
            this.sendCommand({ type: 'keyUp', data: e.keyCode });
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeydown = (e) => {
            //logger.log(e);
            this.sendCommand({ type: 'keyDown', data: e.keyCode });
            this.sendCommand({
                type: 'char',
                data: e.keyCode >= 32 ? e.key.charCodeAt(0) : e.keyCode,
            });
            e.stopPropagation();
            e.preventDefault();
        };

        this.appendChild(video);
        this.appendChild(overlay);

        this.openWS();
    }

    disconnectedCallback() {
        logger.log('disconnected');
        this.closeStream();
        this.ws?.close();
        delete this.ws;
    }
}

customElements.define('ventuz-stream-player', VentuzStreamPlayer);
