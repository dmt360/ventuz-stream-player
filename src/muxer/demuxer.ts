/**
 * Ventuz Stream Player
 * Copyright (c) 2025 Ventuz Technology, all rights reserved.
 */

import * as MP4 from "./mp4-generator";

export type DemuxerConfig = {
    width: number;
    height: number;
    timeBase: number;
    fragSize: number;
    onBufferReset(codec: string): void;
    onData(track: MP4.VideoTrack): void;
};

export class GetBits {
    private array: Uint8Array;
    private pos = 0;
    private accu = 0;
    private remain = 0;

    constructor(array: Uint8Array) {
        this.array = array;
    }

    // let's do bitwise operations with fp math because we need >31 bits
    // (worst case: get(48) with 7 remaining bits in accu -> 55 bits which fits into the double mantissa)

    peek(bits: number) {
        while (this.remain < bits) {
            if (this.pos >= this.array.byteLength) throw new Error("out of bits");
            this.accu = this.accu * 256 + this.array[this.pos++];
            this.remain += 8;
        }
        return Math.floor(this.accu * Math.pow(2, bits - this.remain));
    }

    get(bits: number) {
        const result = this.peek(bits);
        this.remain -= bits;
        this.accu %= Math.pow(2, this.remain);
        return result;
    }

    getExpGolomb() {
        const maxBits = Math.min(32, 8 * (this.array.byteLength - this.pos) + this.remain);
        const pre = this.peek(maxBits);
        const zeroes = maxBits - 1 - Math.floor(Math.log2(pre));
        this.remain -= zeroes;
        return this.get(zeroes + 1) - 1;
    }

    getExpGolombSigned() {
        const x = this.getExpGolomb();
        return (x % 2 ? x - 1 : -x) / 2;
    }
}
