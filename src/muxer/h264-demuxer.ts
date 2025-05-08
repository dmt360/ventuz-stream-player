/**

*/
import * as MP4 from "./mp4-generator";
import { logger } from "./logger";

export type H264DemuxerConfig = {
    width: number;
    height: number;
    timeBase: number;
    fragSize: number;
    onBufferReset(codec: string): void;
    onData(track: MP4.VideoTrack): void;
};

export class H264Demuxer {
    private config: H264DemuxerConfig;
    private timestamp: number;
    private _avcTrack: MP4.VideoTrack;
    //private firefox: boolean;

    constructor(config: H264DemuxerConfig) {
        this.config = config;
        this.timestamp = 0;
        this._avcTrack = {
            id: 1,
            sequenceNumber: 0,
            samples: [],
            len: 0,
            nbNalu: 0,
            timescale: 0,
            duration: 0,
            width: 0,
            height: 0,
        };
        //this.firefox = navigator.userAgent.toLowerCase().indexOf("firefox") !== -1;
    }

    pushData(array: Uint8Array) {
        const track = this._avcTrack,
            samples = track.samples,
            units = this.parseAVCNALu(array),
            debug = false;
        let units2: typeof units = [],
            key = false,
            frame = false,
            length = 0,
            debugString = "";

        units.forEach((unit) => {
            let push = false;
            switch (unit.type) {
                //NDR
                case 1:
                    push = true;
                    if (debug) {
                        debugString += "NDR ";
                    }
                    frame = true;
                    break;
                //IDR
                case 5:
                    push = true;
                    if (debug) {
                        debugString += "IDR ";
                    }
                    key = true;
                    frame = true;
                    break;
                //SPS
                case 7:
                    if (debug) {
                        debugString += "SPS ";
                    }
                    if (!track.sps) {
                        track.width = this.config.width;
                        track.height = this.config.height;
                        track.sps = [unit.data];
                        track.duration = 0;
                        const codecstring = unit.data
                            .subarray(1, 4)
                            .reduce((acc, val) => (acc += val.toString(16).padStart(2, "0")), "avc1.");
                        this.config.onBufferReset(codecstring);
                        push = true;
                    }
                    break;
                //PPS
                case 8:
                    if (debug) {
                        debugString += "PPS ";
                    }
                    if (!track.pps) {
                        track.pps = [unit.data];
                        push = true;
                    }
                    break;
                default:
                    debugString += "unknown NAL " + unit.type + " ";
                    break;
            }

            if (push) {
                units2.push(unit);
                length += unit.data.byteLength;
            }
        });

        if (debug || debugString.length) {
            logger.log(debugString);
        }

        if (units2.length) {
            const tss = this.timestamp;
            samples.push({
                units: [...units2],
                pts: tss,
                dts: tss,
                key: key,
                cts: 0,
                duration: 0,
                flags: { dependsOn: 0, isNonSync: 0 },
                size: length,
            });
            track.len += length;
            track.nbNalu += units2.length;
            if (frame) {
                this.timestamp += this.config.timeBase;
            }
        }
        //if (this.firefox || track.samples.length >= 2) {
        if (track.samples.length >= this.config.fragSize) {
            this.config.onData(this._avcTrack);
        }
    }

    private parseAVCNALu(array: Uint8Array) {
        const len = array.byteLength,
            units: MP4.Unit[] = [];
        let state = 0,
            lastUnitType = 0,
            lastUnitStart = 0;

        for (let i = 0; i < len; ) {
            const value = array[i++];
            // finding 3 or 4-byte start codes (00 00 01 OR 00 00 00 01)
            switch (state) {
                case 0:
                    if (value === 0) {
                        state = 1;
                    }
                    break;
                case 1:
                    if (value === 0) {
                        state = 2;
                    } else {
                        state = 0;
                    }
                    break;
                case 2:
                case 3:
                    if (value === 0) {
                        state = 3;
                    } else if (value === 1 && i < len) {
                        if (lastUnitStart) {
                            units.push({
                                data: array.subarray(lastUnitStart, i - state - 1),
                                type: lastUnitType,
                            });
                        }
                        lastUnitStart = i;
                        lastUnitType = array[i] & 0x1f;
                        state = 0;
                    } else {
                        state = 0;
                    }
                    break;
                default:
                    break;
            }
        }

        if (lastUnitStart) {
            units.push({
                data: array.subarray(lastUnitStart, len),
                type: lastUnitType,
            });
        }

        return units;
    }
}
