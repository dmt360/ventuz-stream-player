import * as Mp4Muxer from 'mp4-muxer'

class VentuzStreamPlayer extends HTMLElement {
    static observedAttributes = ['url']

    url: string
    private ws: WebSocket | undefined
    private muxer: Mp4Muxer.Muxer<Mp4Muxer.StreamTarget> | undefined
    private streamHeader: StreamOut.StreamHeader | undefined
    private frameHeader: StreamOut.FrameHeader | undefined
    private mediaSource: MediaSource | undefined
    private vidSrcBuffer: SourceBuffer | undefined
    private video: HTMLVideoElement | undefined
    private queue: Uint8Array[] = []

    private openStream() {
        console.log('openStream')
        this.closeStream()

        if (!this.video || !this.streamHeader) return

        this.mediaSource = new MediaSource()
        this.mediaSource.onsourceopen = () => {
            console.log('source open')
            this.vidSrcBuffer = this.mediaSource!.addSourceBuffer(
                'video/mp4; codecs="avc1.640C20"'
            )
            this.vidSrcBuffer.onerror = (e) => {
                console.error('vid source error', e)
                this.closeStream()
            }
            this.vidSrcBuffer.onupdateend = () => {
                console.log('updateend')
                this.handleQueue()
            }
            this.handleQueue()
        }

        this.video.src = URL.createObjectURL(this.mediaSource)
        this.video.width = this.streamHeader.videoWidth
        this.video.height = this.streamHeader.videoHeight
        this.video.tabIndex = 0

        this.muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.StreamTarget({
                onData: (data, _) => this.onMuxerData(data),
            }),
            fastStart: 'fragmented',
            firstTimestampBehavior: 'offset',
            video: {
                codec: 'avc',
                width: this.streamHeader.videoWidth,
                height: this.streamHeader.videoHeight,
                frameRate:
                    this.streamHeader.videoFrameRateNum /
                    this.streamHeader.videoFrameRateDen,
            },
            minFragmentDuration: 0,
        })
    }

    private closeStream() {
        if (!this.muxer) return
        console.log('closeStream')

        this.queue.length = 0
        delete this.vidSrcBuffer

        if (this.video) this.video.src = ''
        delete this.mediaSource

        delete this.muxer

        delete this.frameHeader
        delete this.streamHeader
    }

    private onMuxerData(data: Uint8Array) {
        if (!this.mediaSource) return

        if (this.vidSrcBuffer && !this.vidSrcBuffer.updating) {
            console.log('add', data.length)
            this.vidSrcBuffer.appendBuffer(data)
            console.log('add done', data.length)
        } else {
            //console.log("q mp4", data.length);
            this.queue.push(data)
        }
    }

    private handleQueue() {
        if (this.queue.length > 0 && this.vidSrcBuffer != null) {
            const data = this.queue.shift()!
            console.log('dq', data.length)
            this.vidSrcBuffer.appendBuffer(data)
            console.log('dq done', data.length)
        }
    }

    private handlePacket(pkg: StreamOut.StreamPacket) {
        switch (pkg.type) {
            case 'connected':
                // create and connect muxer
                this.streamHeader = pkg.data
                this.openStream()
                break
            case 'disconnected':
                this.closeStream()
                break
            case 'error':
                console.error('got error from VMS', pkg.data)
                this.closeStream()
                break
            case 'frame':
                this.frameHeader = pkg.data
                break
            default:
                throw new Error('pkg syntax')
        }
    }

    private handleVideoFrame(data: Uint8Array) {
        if (this.muxer && this.streamHeader && this.frameHeader) {
            const key = true // this.frameHeader.flags === "keyFrame";
            const dur =
                (1000000 * this.streamHeader.videoFrameRateDen) /
                this.streamHeader.videoFrameRateNum
            const ts = this.frameHeader.frameIndex * dur

            //console.log("send", data.length, key ? "key" : "delta", ts, dur, meta);

            const meta: EncodedVideoChunkMetadata = {
                decoderConfig: {
                    codec: 'avc1',
                    codedWidth: this.streamHeader.videoWidth,
                    codedHeight: this.streamHeader.videoHeight,
                    colorSpace: {},
                    optimizeForLatency: true,
                },
            }
            // const meta = null;
            this.muxer.addVideoChunkRaw(
                data,
                key ? 'key' : 'delta',
                ts,
                dur,
                meta
            )

            delete this.frameHeader

            this.video?.play()
        }
    }

    private openWS() {
        this.ws?.close()
        this.ws = new WebSocket(this.url)
        this.ws.binaryType = 'arraybuffer'

        this.ws.onopen = async () => {
            console.log('WS open')
        }

        this.ws.onclose = () => {
            console.log('WS close')
            this.closeStream()
        }

        this.ws.onerror = (ev) => {
            console.error('WS error', ev)
        }

        this.ws.onmessage = async (ev) => {
            if (typeof ev.data === 'string') {
                this.handlePacket(JSON.parse(ev.data) as StreamOut.StreamPacket)
                return
            }

            this.handleVideoFrame(new Uint8Array(ev.data as ArrayBuffer))
        }
    }

    sendCommand(cmd: StreamOut.Command) {
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            //console.log("sendcmd", cmd);
            this.ws.send(JSON.stringify(cmd))
        }
    }

    constructor() {
        super()
        this.url = ''
    }

    //-------------------------------------------------------------------------------------------
    // Custom Element implementation

    attributeChangedCallback(
        name: string,
        oldValue: string | null,
        newValue: string | null
    ) {
        switch (name) {
            case 'url':
                this.url = newValue ?? ''
                if (newValue !== oldValue && this.ws) this.openWS()
                break
        }
    }

    connectedCallback() {
        console.log('connectedCallback')
    
        this.video = document.createElement('video')
        this.video.autoplay = true
        this.video.width = 640
        this.video.height = 360
        this.video.style.touchAction = 'none'

        const getIntXY = (x: number, y: number) => {
            var rect = this.video!.getBoundingClientRect()
            return { x: Math.round(x - rect.left), y: Math.round(y - rect.top) }
        }

        this.video.onpointerdown = (e) => {
            if (e.pointerType === 'mouse') {
                // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                this.sendCommand({ type: 'mouseButtons', data: e.buttons })
                this.video!.setPointerCapture(e.pointerId)
            }

            if (e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchBegin',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                })
            }

            this.video!.focus()

            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onpointerup = (e) => {
            if (e.pointerType === 'mouse') {
                // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                this.sendCommand({ type: 'mouseButtons', data: e.buttons })
                this.video!.releasePointerCapture(e.pointerId)
            }

            if (e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchEnd',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                })
            }

            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onpointermove = (e) => {
            if (e.pointerType === 'mouse') {
                this.sendCommand({
                    type: 'mouseMove',
                    data: getIntXY(e.x, e.y),
                })
            }

            if (e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchMove',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                })
            }

            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onpointerover = (e) => {
            //console.log("over", e);
            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onpointercancel = (e) => {
            if (e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchCancel',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                })
            }

            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onpointerout = (e) => {
            if (e.pointerType === 'touch') {
                this.sendCommand({
                    type: 'touchCancel',
                    data: {
                        ...getIntXY(e.clientX, e.clientY),
                        id: e.pointerId,
                    },
                })
            }

            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onwheel = (e) => {
            this.sendCommand({
                type: 'mouseWheel',
                data: { x: -e.deltaX, y: -e.deltaY },
            })
            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onclick = (e) => {
            e.stopPropagation()
            e.preventDefault()
        }

        this.video.oncontextmenu = (e) => {
            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onkeypress = (e) => {
            // console.log("press", e);
            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onkeyup = (e) => {
            this.sendCommand({ type: 'keyUp', data: e.keyCode })
            e.stopPropagation()
            e.preventDefault()
        }

        this.video.onkeydown = (e) => {
            //console.log(e);
            this.sendCommand({ type: 'keyDown', data: e.keyCode })
            this.sendCommand({
                type: 'char',
                data: e.keyCode >= 32 ? e.key.charCodeAt(0) : e.keyCode,
            })
            e.stopPropagation()
            e.preventDefault()
        }

        this.appendChild(this.video)
        this.openWS()
    }

    disconnectedCallback() {
        console.log('disconnected')
        this.ws?.close()
        delete this.ws
    }
}

customElements.define('ventuz-stream-player', VentuzStreamPlayer)
