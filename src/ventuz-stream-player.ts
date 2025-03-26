import { H264Demuxer } from './muxer/h264-demuxer'
import { SlicesReader } from './muxer/h264-nal-slicesreader'
import { MP4Remuxer } from './muxer/mp4-remuxer'
class VentuzStreamPlayer extends HTMLElement {
    static observedAttributes = ['url']

    url: string
    private ws: WebSocket | undefined
    private streamHeader: StreamOut.StreamHeader | undefined
    private frameHeader: StreamOut.FrameHeader | undefined
    private mediaSource: MediaSource | undefined
    private vidSrcBuffer: SourceBuffer | undefined
    private video: HTMLVideoElement | undefined
    private queue: Uint8Array[] = []

    private slicesReader: SlicesReader | undefined
    private h264Demuxer: H264Demuxer | undefined
    private mp4Remuxer: MP4Remuxer | undefined

    private codec: string | undefined

    private sent = 0;

    private createSrcBuffer() {
        if (this.mediaSource) {
            if (this.vidSrcBuffer)
                this.mediaSource.removeSourceBuffer(this.vidSrcBuffer)

            this.vidSrcBuffer = this.mediaSource.addSourceBuffer(
                `video/mp4; codecs="${this.codec}"`
            )
            this.vidSrcBuffer.onerror = (e) => {
                console.error('vid source error', e)
                this.closeStream()
            }
            this.vidSrcBuffer.onupdateend = () => {
                //                console.log('updateend')
                this.handleQueue()
            }

            this.sent = 0;
            this.handleQueue()
        }
    }

    private openStream(hdr: StreamOut.StreamHeader) {
        console.log('openStream')
        this.closeStream()

        this.streamHeader = hdr

        this.mp4Remuxer = new MP4Remuxer({
            onInitSegment: (is) => {
                console.log('got is', is)

                if (this.mediaSource) delete this.mediaSource

                const mediaSource = (this.mediaSource = new MediaSource())
                mediaSource.onsourceopen = () => {
                    console.log('source open')
                    this.createSrcBuffer()
                }

                if (this.video) {
                    this.video.src = URL.createObjectURL(mediaSource)
                    this.video.width = is.metadata.width
                    this.video.height = is.metadata.height
                    this.video.tabIndex = 0

                    this.video.onerror = (e) =>
                    {
                        console.error('video error', e)                        
                    }

                }

                this.onMuxerData(is.data)
            },

            onData: (data) => {
                //console.log("got data", data)
                this.onMuxerData(data)              
            },
        })

        this.h264Demuxer = new H264Demuxer({
            forceKeyFrameOnDiscontinuity: false,

            onBufferReset: (codec) => {
                this.codec = codec
                this.createSrcBuffer()
            },

            onVideo: (sn, track) => {
                this.mp4Remuxer?.pushVideo(sn, track)
            },
        })

        this.slicesReader = new SlicesReader({
            onNal: (data) => this.h264Demuxer?.pushData(data),
        })
    }

    private closeStream() {
        console.log('closeStream')

        this.queue.length = 0

        if (this.mediaSource && this.video)
        {
            URL.revokeObjectURL(this.video.src)
        }
        delete this.mediaSource
        delete this.vidSrcBuffer

        delete this.mp4Remuxer
        delete this.h264Demuxer
        delete this.slicesReader

        delete this.frameHeader
        delete this.streamHeader
    }

    private onMuxerData(data: Uint8Array) {
        if (!this.mediaSource) return

        if (this.vidSrcBuffer && !this.vidSrcBuffer.updating) {
            console.log('add', data.length)
            this.vidSrcBuffer.appendBuffer(data)
            if (++this.sent == 3) {
                try {
                    this.video?.play();
                }
                catch {
                    
                }
            }        
            //            console.log('add done', data.length)
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
            if (++this.sent == 3) {
                try {
                    this.video?.play();
                }
                catch {

                }
            }        
            //            console.log('dq done', data.length)
        }
    }

    private handlePacket(pkg: StreamOut.StreamPacket) {
        switch (pkg.type) {
            case 'connected':
                // create and connect muxer
                this.openStream(pkg.data)
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
        if (this.slicesReader && this.streamHeader && this.frameHeader) {
            this.slicesReader!.read(data)
            delete this.frameHeader
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

        const video = (this.video = document.createElement('video'))
        video.autoplay = true
        video.width = 640
        video.height = 360
        video.style.touchAction = 'none'

        const getIntXY = (x: number, y: number) => {
            var rect = video.getBoundingClientRect()
            return { x: Math.round(x - rect.left), y: Math.round(y - rect.top) }
        }

        video.onpointerdown = (e) => {
            if (e.pointerType === 'mouse') {
                // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                this.sendCommand({ type: 'mouseButtons', data: e.buttons })
                video.setPointerCapture(e.pointerId)
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

            video.focus()

            e.stopPropagation()
            e.preventDefault()
        }

        video.onpointerup = (e) => {
            if (e.pointerType === 'mouse') {
                // turns out JS and the stream device use the same order of buttons, so no mapping necessary here
                this.sendCommand({ type: 'mouseButtons', data: e.buttons })
                video.releasePointerCapture(e.pointerId)
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

        video.onpointermove = (e) => {
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

        video.onpointerover = (e) => {
            //console.log("over", e);
            e.stopPropagation()
            e.preventDefault()
        }

        video.onpointercancel = (e) => {
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

        video.onpointerout = (e) => {
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

        video.onwheel = (e) => {
            this.sendCommand({
                type: 'mouseWheel',
                data: { x: -e.deltaX, y: -e.deltaY },
            })
            e.stopPropagation()
            e.preventDefault()
        }

        video.onclick = (e) => {
            e.stopPropagation()
            e.preventDefault()
        }

        video.oncontextmenu = (e) => {
            e.stopPropagation()
            e.preventDefault()
        }

        video.onkeypress = (e) => {
            // console.log("press", e);
            e.stopPropagation()
            e.preventDefault()
        }

        video.onkeyup = (e) => {
            this.sendCommand({ type: 'keyUp', data: e.keyCode })
            e.stopPropagation()
            e.preventDefault()
        }

        video.onkeydown = (e) => {
            //console.log(e);
            this.sendCommand({ type: 'keyDown', data: e.keyCode })
            this.sendCommand({
                type: 'char',
                data: e.keyCode >= 32 ? e.key.charCodeAt(0) : e.keyCode,
            })
            e.stopPropagation()
            e.preventDefault()
        }

        this.appendChild(video)
        this.openWS()
    }

    disconnectedCallback() {
        console.log('disconnected')
        this.ws?.close()
        delete this.ws
    }
}

customElements.define('ventuz-stream-player', VentuzStreamPlayer)
