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
            codec: "hev1",
        };
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
                    if (debug)
                        debugString += "VPS ";
                    if (!track.vps) {
                        track.vps = unit.data;
                        // push = true;
                    }
                    break;
                case 33: // SPS
                    if (debug)
                        debugString += "SPS ";
                    if (!track.sps) {                    
                        track.width = this.config.width;
                        track.height = this.config.height;
                        track.sps = unit.data;
                        track.duration = 0;

                        const sps = this.decodeRBSP(unit.data);

                        const codecstring = this.getCodecString(sps);
                        this.config.onBufferReset(codecstring);
                        push = true;
                    }
                    break;
                case 34: // PPS
                    if (debug)
                        debugString += "PPS ";
                    if (!track.pps) {
                        track.pps = unit.data;
                        push = true;
                    }
                    break;
                case 39: // SEI
                    if (debug) 
                        debugString += "SEI ";
                    push = true;
                    break;
                default:
                    if (unit.type >= 19 && unit.type <= 20) {
                        // IDR
                        if (debug) 
                            debugString += "IDR ";
                        frame = true;
                        push = true;
                    } else if (unit.type < 32) {
                        // Non-IDR VCL
                        if (debug) 
                            debugString += "VCL ";
                        frame = true;
                        push = true;
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

    private reverseBitsU32(value: number) {
        let result = 0;
        for (let i = 0; i < 32; i++) {
            result <<= 1;
            result |= value & 1;
            value >>= 1;
        }
        return result >>> 0;
    }

    private getCodecString(sps: Uint8Array) {
        //const sps_video_parameter_set_id = (sps[0] & 0xf0) >> 4;
        //const sps_max_sub_layers_minus1 = (sps[0] & 0x0e) >> 1;
        //const sps_temporal_id_nesting_flag = sps[0] & 0x01;
        const general_profile_space = (sps[1] & 0xc0) >> 6;
        const general_tier_flag = (sps[1] & 0x20) >> 5;
        const general_profile_idc = (sps[1] & 0x1f);
        const general_profile_compatibility_flags = (sps[2] << 24) | (sps[3] << 16) | (sps[4] << 8) | sps[5];
        const constraints_flags = sps.slice(6, 12);
        const general_level_idc = sps[12];

        let str = "hev1.";
        if (general_profile_space>0)
            str += String.fromCharCode(0x40 + general_profile_space);
        str += general_profile_idc.toString(10);
        str += ".";
        str += this.reverseBitsU32(general_profile_compatibility_flags).toString(16);
        str += ".";
        str += general_tier_flag ? "H" : "L";
        str += general_level_idc.toString(10);

        let numCf = 0;
        for (let i=0; i<6; i++)
            if (constraints_flags[i]>0)
                numCf = i+1;
        for (let i=0; i<numCf; i++) {
            str +=".";
            str += constraints_flags[i].toString(16);
        }       

        return str;
    }

    private decodeRBSP(array: Uint8Array) {
        const rbsp: number[] = [];
        let zeroes = 0;

        for (let i = 2; i < array.byteLength; ) {
            const value = array[i++];
            if (value !== 3 || zeroes < 2)
                rbsp.push(value);
            zeroes = value ? 0 : zeroes + 1;
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
