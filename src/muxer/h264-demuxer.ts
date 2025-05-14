/**
  H264 parser/demuxer

  Originally from https://github.com/ChihChengYang/wfs.js 
  Copyright (c) 2018 ChihChengYang, licensed under the BSD-2-Clause license

  Typescript conversion and modifications by Tammo Hinrichs
  Copyright (c) 2025 Ventuz Technology, all rights reserved.
*/
import * as MP4 from "./mp4-generator";
import { logger } from "./logger";
import { DemuxerConfig } from "./demuxer";

export class H264Demuxer {
    private config: DemuxerConfig;
    private timestamp: number;
    private avcTrack: MP4.VideoTrack;
    private sps?: Uint8Array;
    private pps?: Uint8Array;

    constructor(config: DemuxerConfig) {
        this.config = config;
        this.timestamp = 0;
        this.avcTrack = {
            id: 1,
            sequenceNumber: 0,
            samples: [],
            len: 0,
            nbNalu: 0,
            timescale: 0,
            duration: 0,
            width: 0,
            height: 0,
            lastKeyFrameDTS: -1,
            codec: "avc1",
        };
        //this.firefox = navigator.userAgent.toLowerCase().indexOf("firefox") !== -1;
    }

    pushData(array: Uint8Array) {
        const track = this.avcTrack,
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
                    if (!this.sps) {
                        track.width = this.config.width;
                        track.height = this.config.height;
                        this.sps = unit.data;
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
                    if (!this.pps) {
                        this.pps = unit.data;
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
            samples.push({
                units: [...units2],
                pts: this.timestamp,
                dts: this.timestamp,
                key: key,
                cts: 0,
                duration: 0,
                flags: { dependsOn: 0, isNonSync: 0 },
                size: length,
            });

            if (key) track.lastKeyFrameDTS = this.timestamp;

            track.len += length;
            track.nbNalu += units2.length;
            if (frame) {
                this.timestamp += this.config.timeBase;
            }
        }

        if (track.samples.length >= Math.max(1, this.config.fragSize)) {
            if (!this.avcTrack.decoderConfiguration && this.sps && this.pps) this.makeAvCC();

            this.config.onData(this.avcTrack);
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

    private makeAvCC() {
        const sps = this.sps!;
        const pps = this.pps!;
        this.avcTrack.decoderConfiguration = new Uint8Array([
            0x01, // version
            sps[1], // profile
            sps[2], // profile compat
            sps[3], // level
            0xfc | 3, // lengthSizeMinusOne, hard-coded to 4 bytes
            0xe0 | 1, // 3bit reserved (111) + numOfSequenceParameterSets
            ...MP4.u16(sps.length), // length of SPS
            ...sps,
            1, // numOfPictureParameterSets
            ...MP4.u16(pps.length), // length of PPS
            ...pps,
        ]);
    }
}
