import { H264Demuxer } from "./muxer/h264-demuxer";
import { MP4Remuxer } from "./muxer/mp4-remuxer";
import { logger } from "./muxer/logger";

import "./style.css";

// localize me, or something
const statusMsgs = {
    connecting: "Connecting...",
    noStream: "Waiting for stream...",
    playing: "",

    errNoRuntime: "Couldn't connect to VMS",
    errClosed: "Connection lost",
    errGeneric: "Error",
    errBadFormat: "Can't play this video format",
};

type StatusType = keyof typeof statusMsgs;

class VentuzStreamPlayer extends HTMLElement {
    
    // parameters
    url = "";
    extraLatency = 0;
    useKeyboard = true;
    useMouse = true;
    useTouch = true;

    // state
    private ws?: WebSocket;
    private streamHeader?: StreamOut.StreamHeader;
    private frameHeader?: StreamOut.FrameHeader;
    private mediaSource?: MediaSource;
    private vidSrcBuffer?: SourceBuffer;
    private lastKeyFrameIndex = 0;
    private lastLatency = 0;
    private codec?: string;

    private video?: HTMLVideoElement;
    private statusLine?: HTMLDivElement;

    private h264Demuxer?: H264Demuxer;
    private mp4Remuxer?: MP4Remuxer;
    private queue: Uint8Array[] = [];

    private createSrcBuffer() {
        if (this.mediaSource) {
            if (this.vidSrcBuffer) this.mediaSource.removeSourceBuffer(this.vidSrcBuffer);

            try {
                this.vidSrcBuffer = this.mediaSource.addSourceBuffer(`video/mp4; codecs="${this.codec}"`);
            } catch {
                logger.error("error creating source buffer", this.codec);
                this.setStatus("errBadFormat");
                return;
            }
            this.vidSrcBuffer.mode = "sequence";
            this.vidSrcBuffer.onerror = (e) => {
                logger.error("vid source error", e);
                this.closeStream();
                this.setStatus("errGeneric");
            };

            this.vidSrcBuffer.onupdateend = () => this.handleQueue();
            this.handleQueue();
        }
    }

    private openStream(hdr: StreamOut.StreamHeader) {
        logger.log("openStream");
        this.closeStream();

        this.streamHeader = hdr;
        this.lastKeyFrameIndex = -1;
        while (hdr.videoFrameRateDen < 1000) {
            hdr.videoFrameRateNum *= 10;
            hdr.videoFrameRateDen *= 10;
        }

        if (this.streamHeader.videoCodecFourCC !== 0x68323634) { // h264 only
            logger.error("Unsupported codec", this.streamHeader.videoCodecFourCC.toString(16));
            this.setStatus("errBadFormat");
            return false;
        }

        if (this.video) {
            this.video.width = hdr.videoWidth;
            this.video.height = hdr.videoHeight;
        }

        this.mp4Remuxer = new MP4Remuxer({
            timeBase: hdr.videoFrameRateDen,
            timeScale: hdr.videoFrameRateNum,
            onInitSegment: (is) => {
                logger.log("got is", is);

                delete this.mediaSource;

                const mediaSource = (this.mediaSource = new MediaSource());

                mediaSource.onsourceopen = () => {
                    mediaSource.duration = Infinity;
                    logger.log("source open");
                    this.createSrcBuffer();
                };

                if (this.video) {
                    try {
                        this.video.src = URL.createObjectURL(mediaSource);
                    } catch (error: any) {
                        logger.log(error);
                    }

                    this.video.onerror = (e) => {
                        logger.error("video error", e);
                    };
                }

                this.queue.push(is.data);
                this.handleQueue();
            },

            onData: (data) => {
                this.queue.push(data);
                this.handleQueue();
            },
        });

        this.h264Demuxer = new H264Demuxer({
            width: hdr.videoWidth,
            height: hdr.videoHeight,
            timeBase: hdr.videoFrameRateDen,
            fragSize: Math.max(1, Math.ceil((this.extraLatency * hdr.videoFrameRateNum) / hdr.videoFrameRateDen)),

            onBufferReset: (codec) => {
                this.codec = codec;
                this.createSrcBuffer();
            },

            onData: (track) => {
                this.mp4Remuxer?.pushVideo(track);
            },
        });

        return true;
    }

    private closeStream() {
        logger.log("closeStream");

        this.queue.length = 0;

        if (this.mediaSource && this.video) {
            URL.revokeObjectURL(this.video.src);
        }
        delete this.mediaSource;
        delete this.vidSrcBuffer;

        delete this.mp4Remuxer;
        delete this.h264Demuxer;

        delete this.frameHeader;
        delete this.streamHeader;
    }

    private handleQueue() {
        if (this.queue.length > 0 && this.vidSrcBuffer && !this.vidSrcBuffer.updating) {
            // Remove old frames from the buffer
            if (this.vidSrcBuffer.buffered.length > 0) {
                const start = this.vidSrcBuffer.buffered.start(0);
                const end = this.vidSrcBuffer.buffered.end(0);
                const currentTime = this.video?.currentTime ?? 0;
                const bufferThreshold = 5 + this.extraLatency;

                if (currentTime - start >= 2 * bufferThreshold) {
                    // check if player has gotten behind and jump forwards
                    const frametime = this.streamHeader!.videoFrameRateDen / this.streamHeader!.videoFrameRateNum;
                    const max = end - this.lastLatency - 2 * frametime;
                    if (max > currentTime) {
                        logger.log("jump!", end - currentTime);
                        this.video!.currentTime = end;
                    }

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
            case "connected":
                // create and connect muxer
                if (this.openStream(pkg.data)) this.setStatus("playing");
                break;
            case "disconnected":
                this.closeStream();
                this.setStatus("noStream");
                break;
            case "error":
                logger.error("got error from VMS", pkg.data);
                this.setStatus("errGeneric");
                this.closeStream();
                break;
            case "frame":
                this.frameHeader = pkg.data;
                break;
            default:
                logger.error("unknown packet type", (pkg as any).type);
                break;
        }
    }

    private handleVideoFrame(data: Uint8Array) {
        if (this.h264Demuxer && this.streamHeader && this.frameHeader) {
            this.h264Demuxer.pushData(data);

            // make sure we get a keyframe at least every 4 seconds so we can throw away old frames
            if (this.frameHeader.flags === "keyFrame") {
                this.lastKeyFrameIndex = this.frameHeader.frameIndex;
            } else if (
                this.frameHeader.frameIndex - this.lastKeyFrameIndex >
                (4 * this.streamHeader.videoFrameRateNum) / this.streamHeader.videoFrameRateDen
            ) {
                logger.log("requesting IDR frame");
                this.lastKeyFrameIndex = this.frameHeader.frameIndex;
                this.sendCommand({ type: "requestIDRFrame" });
            }

            delete this.frameHeader;
        }
    }

    private openWS() {
        this.ws?.close();

        this.setStatus("connecting");
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            logger.log("WS open");
            this.setStatus("noStream");
        };

        this.ws.onclose = () => {
            logger.log("WS close");
            if (this.ws) {
                this.setStatus("errClosed");
                this.closeStream();
            }
            delete this.ws;
        };

        this.ws.onerror = (ev) => {
            logger.log("WS error", ev);
            this.setStatus("errNoRuntime");
            delete this.ws;
        };

        this.ws.onmessage = (ev) => {
            if (typeof ev.data === "string") {
                this.handlePacket(JSON.parse(ev.data) as StreamOut.StreamPacket);
                return;
            }

            this.handleVideoFrame(new Uint8Array(ev.data as ArrayBuffer));
        };
    }

    sendCommand(cmd: StreamOut.Command) {
        if (this.ws && this.ws.readyState === this.ws.OPEN && this.streamHeader) {
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
    }

    static observedAttributes = ["url", "latency", "noinput", "nokeyboard", "nomouse", "notouch"];

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
        switch (name) {
            case "url":
                this.url = newValue ?? "";
                if (newValue !== oldValue && this.ws) this.openWS();
                break;
            case "latency":
                this.extraLatency = Math.max(0, Math.min(60, parseFloat(newValue ?? "0") || 0));
                if (newValue !== oldValue && this.ws) this.openWS();
                break;
            case "noinput":
                this.useKeyboard = this.useMouse = this.useTouch = newValue === null;
                break;
            case "nokeyboard":
                this.useKeyboard = newValue === null;
                break;
            case "nomouse":
                this.useMouse = newValue === null;
                break;
            case "notouch":
                this.useTouch = newValue === null;
                break;
        }
    }

    connectedCallback() {
        logger.log("connectedCallback");

        const video = (this.video = document.createElement("video"));
        video.muted = true;
        video.controls = false;

        video.oncanplay = (_) => {
            if (this.vidSrcBuffer) {
                // measure latency (buffered end - current play time)
                let end = this.vidSrcBuffer.buffered.end(0);
                this.lastLatency = end - video.currentTime;
                logger.log("oncanplay", this.lastLatency);
            }
            video.play();
        };

        video.onplay = (_) => {
            if (this.vidSrcBuffer) {
                const currentTime = this.video?.currentTime ?? 0;
                let end = this.vidSrcBuffer.buffered.end(0);
                logger.log("onplay", currentTime, end);
                if (end > currentTime) {
                    logger.log("jump!", currentTime, end);
                    video.currentTime = end;
                }
            }
        };

        const status = (this.statusLine = document.createElement("div"));
        status.className = "vsp-statusdisplay";

        const overlay = /*this.overlay =*/ document.createElement("div");
        overlay.tabIndex = 0;
        overlay.appendChild(status);

        // Move all existing children of the component into the overlay
        while (this.firstChild) {
            overlay.appendChild(this.firstChild);
        }

        const getIntXY = (x: number, y: number) => {
            if (!this.streamHeader) return { x, y };
            let rect = overlay.getBoundingClientRect();

            // get the actual video rectangle (assuming center fit)
            const rasp = rect.width / rect.height;
            const vasp = this.streamHeader.videoWidth / this.streamHeader.videoHeight;
            if (rasp > vasp) {
                const w = (rect.width * vasp) / rasp;
                rect.x += (rect.width - w) / 2;
                rect.width = w;
            } else {
                const h = (rect.height * rasp) / vasp;
                rect.y += (rect.height - h) / 2;
                rect.height = h;
            }

            return {
                x: Math.round(((x - rect.left) * this.streamHeader.videoWidth) / rect.width),
                y: Math.round(((y - rect.top) * this.streamHeader.videoHeight) / rect.height),
            };
        };

        overlay.onpointerdown = (e) => {
            //console.log("pointerdown", e.pointerType, e.pointerId);

            if (e.pointerType === "mouse") {
                if (!this.useMouse) return;
                // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                this.sendCommand({ type: "mouseButtons", data: e.buttons });

                overlay.focus();
                overlay.setPointerCapture(e.pointerId);
                e.stopPropagation();
                e.preventDefault();
            }

            if (e.pointerType === "touch") {
                if (!this.useTouch) return;
                this.sendCommand({
                    type: "touchBegin",
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
                overlay.focus();
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onpointerup = (e) => {
            //console.log("pointerup", e.pointerType, e.pointerId);
            if (e.pointerType === "mouse") {
                if (!this.useMouse) return;
                // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                this.sendCommand({ type: "mouseButtons", data: e.buttons });
                overlay.releasePointerCapture(e.pointerId);
                e.stopPropagation();
                e.preventDefault();
            }

            if (e.pointerType === "touch") {
                if (!this.useTouch) return;
                this.sendCommand({
                    type: "touchEnd",
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onpointermove = (e) => {
            //console.log("pointermove", e.pointerType, e.pointerId);
            if (e.pointerType === "mouse") {
                if (!this.useMouse) return;
                this.sendCommand({
                    type: "mouseMove",
                    data: getIntXY(e.x, e.y),
                });
                e.stopPropagation();
                e.preventDefault();
            }

            if (e.pointerType === "touch") {
                if (!this.useTouch) return;
                this.sendCommand({
                    type: "touchMove",
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onpointercancel = (e) => {
            if (e.pointerType === "mouse") {
                if (!this.useMouse) return;
                e.stopPropagation();
                e.preventDefault();
            }
            if (e.pointerType === "touch") {
                if (!this.useTouch) return;
                this.sendCommand({
                    type: "touchCancel",
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onpointerout = (e) => {
            if (e.pointerType === "mouse") {
                if (!this.useMouse) return;
                e.stopPropagation();
                e.preventDefault();
            }

            if (e.pointerType === "touch") {
                if (!this.useTouch) return;
                this.sendCommand({
                    type: "touchCancel",
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                });
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onwheel = (e) => {
            if (!this.useMouse) return;
            this.sendCommand({
                type: "mouseWheel",
                data: { x: -e.deltaX, y: -e.deltaY },
            });
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onclick = async (e) => {
            video.play();
            if (!this.useMouse) return;
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.oncontextmenu = (e) => {
            if (!this.useMouse) return;
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeypress = (e) => {
            // logger.log("press", e);
            if (!this.useKeyboard) return;
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeyup = (e) => {
            if (!this.useKeyboard) return;
            this.sendCommand({ type: "keyUp", data: e.keyCode });
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeydown = (e) => {
            //logger.log(e);
            if (!this.useKeyboard) return;
            this.sendCommand({ type: "keyDown", data: e.keyCode });
            this.sendCommand({
                type: "char",
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
        logger.log("disconnected");
        this.closeStream();
        this.ws?.close();
        delete this.ws;
    }
}

customElements.define("ventuz-stream-player", VentuzStreamPlayer);
