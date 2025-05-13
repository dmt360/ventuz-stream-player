/**
  HEVC parser/demuxer

  Originally from https://github.com/ChihChengYang/wfs.js 
  Copyright (c) 2018 ChihChengYang, licensed under the BSD-2-Clause license

  Adaption to HEVC, Typescript conversion and modifications by Tammo Hinrichs
*/
import * as MP4 from "./mp4-generator";
import { logger } from "./logger";
import { DemuxerConfig } from "./demuxer";

export class HEVCDemuxer {
    private config: DemuxerConfig;
    private timestamp: number;
    private hevcTrack: MP4.VideoTrack;
    //private firefox: boolean;

    constructor(config: DemuxerConfig) {
        this.config = config;
        this.timestamp = 0;
        this.hevcTrack = {
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
        };
        //this.firefox = navigator.userAgent.toLowerCase().indexOf("firefox") !== -1;
    }

    pushData(array: Uint8Array) {
        const track = this.hevcTrack,
            samples = track.samples,
            units = this.parseHEVCNALu(array),
            debug = false;
        let units2: typeof units = [],
            key = false,
            frame = false,
            length = 0,
            debugString = "";

        units.forEach((unit) => {
            let push = false;
            switch (unit.type) {
                case 32: // VPS
                    const vps = this.decodeRBSP(unit.data);

                    //push = true;
                    break;
                case 33: // SPS
                    const sps = this.decodeRBSP(unit.data);

                    //push = true;
                    break;
                case 34: // PPS
                    const pps = this.decodeRBSP(unit.data);
                    
                    //push = true;
                    break;
                case 39: // SEI
                    //push = true;
                    break;
                default:
                    if (unit.type >= 19 && unit.type <= 20) {
                        // IDR
                        if (debug) 
                            debugString += "IDR ";
                        frame = true;
                        //push = true;
                    } else if (unit.type < 32) {
                        // Non-IDR VCL
                        if (debug) 
                            debugString += "NDR ";
                        frame = true;
                        //push = true;
                    } else {
                        // unknown
                        debugString += unit.type + "? ";
                    }

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
            this.config.onData(this.hevcTrack);
        }
    }

    private decodeRBSP(array: Uint8Array) {
        const len = array.byteLength,
            rbsp: number[] = [];
        let state = 0,
            value = 0;

        for (let i = 0; i < len; ) {
            value = array[i++];    
            switch (state) {
                case 0:
                    if (value === 0)
                        state = 1
                    rbsp.push(value);
                    break;
                case 1:
                    if (value === 0)
                        state = 2;
                    else 
                        state = 0;
                    rbsp.push(value);
                    break;
                case 2:
                    if (value !== 3)
                        rbsp.push(value);
                    state = 0;
                    break;
            }
        }

        return new Uint8Array(rbsp);
    }

    private parseHEVCNALu(array: Uint8Array) {
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
                        lastUnitType = array[i] >> 1;
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
