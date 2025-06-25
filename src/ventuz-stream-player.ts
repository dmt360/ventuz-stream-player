/**
 * Ventuz Stream Player
 * A web component for playing back Ventuz Stream Out outputs in the browser,
 * with keyboard, mouse, and touch input support.
 * Copyright (c) 2025 Ventuz Technology, all rights reserved.
 */

import { DemuxerConfig } from "./muxer/demuxer";
import { H264Demuxer } from "./muxer/h264-demuxer";
import { HEVCDemuxer } from "./muxer/hevc-demuxer";
import { MP4Remuxer } from "./muxer/mp4-remuxer";
import { logger } from "./muxer/logger";
import { keyEventToVKey } from "./key-mapper";

import "./style.css";

// all user visible strings; override these in the "ventuz-stream-player:strings" event for i18n
const defaultStatusMsgs = {
    connecting: "Connecting...",
    noStream: "Waiting for stream...",
    playing: "",

    errNoRuntime: "Couldn't connect",
    errClosed: "Connection lost",
    errGeneric: "Error",
    errBadFormat: "Can't play this video format",

    fsButtonLabel: "Fullscreen",
};

type StatusType = keyof typeof defaultStatusMsgs;

type QueueEntry = {
    data: Uint8Array;
    keyTSOffset: number | undefined;
};

declare global {
    var overrideVSPStrings: ((strings: typeof defaultStatusMsgs) => void) | undefined;
}

export default class VentuzStreamPlayer extends HTMLElement {
    // parameters
    url = "";
    extraLatency = 0;
    useKeyboard = true;
    useMouse = true;
    useTouch = true;
    fullscreenButton = false;
    retryInterval = 3000;

    // state
    private statusMsgs = defaultStatusMsgs;
    private ws?: WebSocket;
    private streamHeader?: StreamOut.StreamHeader;
    private frameHeader?: StreamOut.FrameHeader;
    private mediaSource?: MediaSource;
    private srcBuffer?: SourceBuffer;
    private lastKeyFrameIndex = 0;
    private lastLatency = 0;
    private lastKfTs: number | undefined = undefined;
    private codec?: string;
    private parseBin?: (arr: Uint8Array) => void;
    private retryHandle?: number;
    private maxKfInterval: number;
    private firstJump = true;

    private video?: HTMLVideoElement;
    private statusLine?: HTMLDivElement;
    private fsbutton?: HTMLDivElement;

    private demuxer?: H264Demuxer | HEVCDemuxer;
    private mp4Remuxer?: MP4Remuxer;
    private queue: QueueEntry[] = [];

    private retry() {
        if (this.retryInterval) this.retryHandle = setTimeout(() => this.openWS(), this.retryInterval);
    }

    // create Source buffer after init or format change
    private createSrcBuffer() {
        if (this.mediaSource) {
            if (this.srcBuffer) this.mediaSource.removeSourceBuffer(this.srcBuffer);

            try {
                this.srcBuffer = this.mediaSource.addSourceBuffer(`video/mp4; codecs="${this.codec}"`);
            } catch {
                logger.error("error creating source buffer", this.codec);
                this.setStatus("errBadFormat");
                return;
            }
            this.srcBuffer.mode = "sequence";
            this.srcBuffer.onerror = (e) => {
                logger.error("vid source error", e);
                this.closeStream();
                if (this.lastLatency) {
                    this.setStatus("errGeneric");
                    this.retry();
                } else this.setStatus("errBadFormat");
            };

            this.srcBuffer.onupdateend = () => this.handleQueue();
            this.handleQueue();
        }
    }

    private openStream(hdr: StreamOut.StreamHeader) {
        logger.log("openStream");
        this.closeStream();

        this.streamHeader = hdr;
        this.lastKeyFrameIndex = -1;
        this.lastLatency = 0;
        this.firstJump = true;
        while (hdr.videoFrameRateDen < 1000) {
            hdr.videoFrameRateNum *= 10;
            hdr.videoFrameRateDen *= 10;
        }

        if (this.streamHeader.videoCodecFourCC !== 0x68323634 && this.streamHeader.videoCodecFourCC !== 0x68657663) {
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
                logger.log("got is");

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
                        this.closeStream();
                        if (this.lastLatency) {
                            this.setStatus("errGeneric");
                            this.retry();
                        } else this.setStatus("errBadFormat");
                    };
                }

                this.queue.push({ data: is, keyTSOffset: undefined });
                this.handleQueue();
            },

            onData: (data, keyTSOffset) => {
                this.queue.push({ data, keyTSOffset });
                this.handleQueue();
            },
        });

        const demuxerConfig: DemuxerConfig = {
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
        };

        if (this.streamHeader.videoCodecFourCC !== 0x68323634) this.demuxer = new HEVCDemuxer(demuxerConfig);
        else this.demuxer = new H264Demuxer(demuxerConfig);

        return true;
    }

    private closeStream() {
        logger.log("closeStream");

        this.queue.length = 0;

        if (this.mediaSource && this.video) {
            URL.revokeObjectURL(this.video.src);
        }
        delete this.mediaSource;
        delete this.srcBuffer;

        delete this.mp4Remuxer;
        delete this.demuxer;

        delete this.frameHeader;
        delete this.streamHeader;
    }

    private handleQueue() {
        if (this.queue.length > 0 && this.srcBuffer && !this.srcBuffer.updating) {
            if (this.srcBuffer.buffered.length > 0) {
                const start = this.srcBuffer.buffered.start(0);
                const end = this.srcBuffer.buffered.end(0);
                const currentTime = this.video?.currentTime ?? 0;
                const bufferThreshold = 5 + this.extraLatency;
                const frametime = this.streamHeader!.videoFrameRateDen / this.streamHeader!.videoFrameRateNum;

                // if we get a new keyframe and the actual latency exceeds the measured one, jump ahead
                if (this.lastKfTs !== undefined) {
                    var jumpTo = this.lastKfTs + frametime;
                    if (end > jumpTo) {
                        if (this.firstJump || jumpTo - currentTime > this.lastLatency + 2 * frametime) {
                            logger.log("jump", "ct", currentTime, "kf", this.lastKfTs, "en", end);
                            this.video!.currentTime = jumpTo;
                            this.lastLatency = 0;
                        }

                        this.lastKfTs = undefined;
                        this.firstJump = false;
                    }
                }

                // remove old frames from the buffer
                if (currentTime - start >= 2 * bufferThreshold) {
                    this.srcBuffer.remove(start, currentTime - bufferThreshold);
                    return;
                }
            }

            const entry = this.queue.shift()!;

            if (entry.keyTSOffset !== undefined && this.srcBuffer.buffered.length) {
                this.lastKfTs =
                    this.srcBuffer.buffered.end(0) + entry.keyTSOffset / this.streamHeader!.videoFrameRateNum;
            }
            this.srcBuffer.appendBuffer(entry.data as BufferSource);
        }
    }

    private handlePacket(pkg: StreamOut.StreamPacket) {
        switch (pkg.type) {
            case "connected":
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
                this.parseBin = (arr) => this.handleVideoFrame(arr);
                break;
            default:
                logger.log("unknown packet type", (pkg as any).type);
                break;
        }
    }

    private handleVideoFrame(data: Uint8Array) {
        if (this.demuxer && this.streamHeader && this.frameHeader) {
            this.demuxer.pushData(data);

            // make sure we get a keyframe at least every 4 to 6 seconds
            // so we can throw away old frames and recover from transmission errors
            if (this.frameHeader.flags === "keyFrame") {
                this.lastKeyFrameIndex = this.frameHeader.frameIndex;
            } else if (
                this.frameHeader.frameIndex - this.lastKeyFrameIndex >
                (this.maxKfInterval * this.streamHeader.videoFrameRateNum) / this.streamHeader.videoFrameRateDen
            ) {
                logger.log("requesting IDR frame");
                this.lastKeyFrameIndex = this.frameHeader.frameIndex;
                this.sendCommand({ type: "requestIDRFrame" });
            }

            delete this.frameHeader;
        }
    }

    private openWS() {
        if (this.retryHandle) {
            clearTimeout(this.retryHandle);
            delete this.retryHandle;
        } else this.setStatus("connecting");

        this.closeStream();
        this.ws?.close();
        delete this.ws;

        let newWS = new WebSocket(this.url);
        newWS.binaryType = "arraybuffer";

        newWS.onopen = () => {
            if (this.ws != newWS) return;

            logger.log("WS open");
            this.setStatus("noStream");
        };

        newWS.onclose = () => {
            if (this.ws != newWS) return;

            logger.log("WS close");
            this.setStatus("errClosed");
            this.closeStream();
            delete this.ws;
            this.retry();
        };

        newWS.onerror = (ev) => {
            if (this.ws != newWS) return;

            logger.log("WS error", ev);
            this.setStatus("errNoRuntime");
            this.closeStream();
            delete this.ws;
            this.retry();
        };

        newWS.onmessage = (ev) => {
            if (this.ws != newWS) return;

            if (typeof ev.data === "string") {
                this.handlePacket(JSON.parse(ev.data) as StreamOut.StreamPacket);
                return;
            } else if (this.parseBin) {
                this.parseBin(new Uint8Array(ev.data as ArrayBuffer));
                delete this.parseBin;
            }
        };

        this.ws = newWS;
    }

    sendCommand(cmd: StreamOut.Command) {
        if (this.ws && this.ws.readyState === this.ws.OPEN && this.streamHeader) {
            //logger.log("sendcmd", cmd);
            this.ws.send(JSON.stringify(cmd));
        }
    }

    setStatus(status: StatusType) {
        if (this.statusLine) {
            const text = this.statusMsgs[status];
            this.statusLine.textContent = text;
            this.statusLine.style.visibility = text ? "visible" : "hidden";
        }
    }

    onFullscreenChange() {
        if (this.fsbutton) {
            if (document.fullscreenElement || (this.clientWidth === screen.availWidth && this.clientHeight === screen.availHeight) ) {
                this.fsbutton.style.visibility = "hidden";
            } else {
                this.fsbutton.style.visibility = "visible";
            }
        }
    }

    //-------------------------------------------------------------------------------------------
    // Custom Element implementation

    constructor() {
        super();

        // randomize the max keyframe interval to avoid all clients requesting at the same time
        this.maxKfInterval = 4 + 2 * Math.random();

        if (window.overrideVSPStrings) window.overrideVSPStrings(this.statusMsgs);

        this.dispatchEvent(
            new CustomEvent("ventuz-stream-player:strings", {
                bubbles: true,
                cancelable: false,
                detail: this.statusMsgs,
            })
        );
    }

    static observedAttributes = [
        "url",
        "latency",
        "noinput",
        "nokeyboard",
        "nomouse",
        "notouch",
        "fullscreenbutton",
        "retryinterval",
    ];

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
            case "fullscreenbutton":
                this.fullscreenButton = newValue !== null;
                break;
            case "retryinterval":
                this.retryInterval = 1000 * Math.max(0, parseInt(newValue ?? "0") || 0);
                break;
        }
    }

    connectedCallback() {
        logger.log("connectedCallback");

        const video = (this.video = document.createElement("video"));
        video.muted = true;
        video.controls = false;
        video.playsInline = true;

        video.oncanplay = (_) => {
            if (this.srcBuffer) {
                // measure latency (buffered end - current play time)
                let end = this.srcBuffer.buffered.end(0);
                const frametime = this.streamHeader!.videoFrameRateDen / this.streamHeader!.videoFrameRateNum;

                const latency = Math.ceil((end - video.currentTime) / frametime) * frametime;
                if (!this.firstJump && latency > this.lastLatency) {
                    this.lastLatency = latency;
                    logger.log("oncanplay", this.lastLatency);
                }
            }
            video.play();
        };

        const status = (this.statusLine = document.createElement("div"));
        status.className = "vsp-statusdisplay";

        const overlay = document.createElement("div");
        overlay.tabIndex = 0;
        overlay.appendChild(status);

        // Move all existing children of the component into the overlay
        while (this.firstChild) {
            overlay.appendChild(this.firstChild);
        }

        // translate pointer event coordinates to output
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
            //logger.log("pointerdown", e.pointerType, e.pointerId);

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
                        id: Math.abs(e.pointerId) & 0xffffffff,
                    },
                });
                overlay.focus();
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onpointerup = (e) => {
            //logger.log("pointerup", e.pointerType, e.pointerId);
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
                        id: Math.abs(e.pointerId) & 0xffffffff,
                    },
                });
                e.stopPropagation();
                e.preventDefault();
            }
        };

        overlay.onpointermove = (e) => {
            //logger.log("pointermove", e.pointerType, e.pointerId);
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
                        id: Math.abs(e.pointerId) & 0xffffffff,
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
                        id: Math.abs(e.pointerId) & 0xffffffff,
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
                        id: Math.abs(e.pointerId) & 0xffffffff,
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
            // deprecated but let's at least stop the event if it's there
            if (!this.useKeyboard) return;
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeyup = (e) => {
            if (!this.useKeyboard) return;
            const vkey = keyEventToVKey(e);
            if (vkey) this.sendCommand({ type: "keyUp", data: vkey });
            e.stopPropagation();
            e.preventDefault();
        };

        overlay.onkeydown = (e) => {
            if (!this.useKeyboard) return;
            var vkey = keyEventToVKey(e);
            if (vkey) {
                if (e.repeat) this.sendCommand({ type: "keyUp", data: vkey });

                this.sendCommand({ type: "keyDown", data: vkey });

                if (vkey < 32)
                    // tab, enter, esc, etc
                    this.sendCommand({
                        type: "char",
                        data: vkey,
                    });
            }

            if (e.key.length == 1)
                this.sendCommand({
                    type: "char",
                    data: e.key.charCodeAt(0),
                });

            e.stopPropagation();
            e.preventDefault();
        };

        this.appendChild(video);
        this.appendChild(overlay);

        if (this.fullscreenButton && document.fullscreenEnabled) {
            this.fsbutton = document.createElement("div");
            this.fsbutton.className = "vsp-fsbutton";
            this.fsbutton.innerText = "Fullscreen";
            if (document.fullscreenElement) this.fsbutton.style.visibility = "hidden";

            this.fsbutton.onclick = () => {
                this.requestFullscreen();
            };

            this.appendChild(this.fsbutton);
            
            this.onFullscreenChange = this.onFullscreenChange.bind(this);
            window.addEventListener("resize", this.onFullscreenChange);
            document.addEventListener("fullscreenchange", this.onFullscreenChange);
        }

        this.openWS();
    }

    disconnectedCallback() {
        logger.log("disconnected");
        if (this.retryHandle) {
            clearTimeout(this.retryHandle);
            delete this.retryHandle;
        }
        this.closeStream();
        this.ws?.close();
        delete this.ws;
        this.innerHTML = "";
        if (this.fsbutton) {
            document.removeEventListener("fullscreenchange", this.onFullscreenChange);
            window.removeEventListener("resize", this.onFullscreenChange);
        }
    }
}

customElements.define("ventuz-stream-player", VentuzStreamPlayer);
