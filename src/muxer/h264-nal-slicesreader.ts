/*
 * H264 NAL Slicer
 */

export type SlicesReaderConfig = {
    onNal(data: Uint8Array): void
}

export class SlicesReader {
    private lastBuf: Uint8Array | null = null
    private config: SlicesReaderConfig;

    constructor(config: SlicesReaderConfig)
    {
        this.config = config;
    }

    destroy() {
        this.lastBuf = null
    }

    read(buffer: Uint8Array) {
        let typedAr = null
        const nals = []
        if (!buffer || buffer.byteLength < 1) return
        if (this.lastBuf) {
            typedAr = new Uint8Array(buffer.byteLength + this.lastBuf.length)
            typedAr.set(this.lastBuf)
            typedAr.set(new Uint8Array(buffer), this.lastBuf.length)
        } else {
            typedAr = new Uint8Array(buffer)
        }
        let lastNalEndPos = 0
        let b1 = -1 // byte before one
        let b2 = -2 // byte before two
        const nalStartPos = new Array()
        for (let i = 0; i < typedAr.length; i += 2) {
            const b_0 = typedAr[i]
            const b_1 = typedAr[i + 1]
            if (b1 == 0 && b_0 == 0 && b_1 == 0) {
                nalStartPos.push(i - 1)
            } else if (b_1 == 1 && b_0 == 0 && b1 == 0 && b2 == 0) {
                nalStartPos.push(i - 2)
            }
            b2 = b_0
            b1 = b_1
        }
        if (nalStartPos.length > 1) {
            for (let i = 0; i < nalStartPos.length - 1; ++i) {
                nals.push(
                    typedAr.subarray(nalStartPos[i], nalStartPos[i + 1] + 1)
                )
                lastNalEndPos = nalStartPos[i + 1]
            }
        } else {
            lastNalEndPos = nalStartPos[0]
        }
        if (lastNalEndPos != 0 && lastNalEndPos < typedAr.length) {
            this.lastBuf = typedAr.subarray(lastNalEndPos)
        } else {
            if (!!!this.lastBuf) {
                this.lastBuf = typedAr
            }
            const _newBuf = new Uint8Array(
                this.lastBuf.length + buffer.byteLength
            )
            _newBuf.set(this.lastBuf)
            _newBuf.set(new Uint8Array(buffer), this.lastBuf.length)
            this.lastBuf = _newBuf
        }

        for (const nal of nals)
            this.config.onNal(nal);
    }
   
}
