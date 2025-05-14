/**
 * fMP4 remuxer
 *
 * Originally from https://github.com/dailymotion/hls.js
 * Copyright (c) 2017 Dailymotion, licensed under the Apache License, Version 2.0
 *
 * Typescript conversion and modifications by Tammo Hinrichs
 */

import * as MP4 from "./mp4-generator";
import { logger } from "./logger";

export type MP4RemuxerConfig = {
    timeBase: number;
    timeScale: number;
    onInitSegment(is: Uint8Array): void;
    onData(data: Uint8Array, keyFrameTS: number | undefined): void;
};

export class MP4Remuxer {
    constructor(config: MP4RemuxerConfig) {
        this.config = config;
    }

    private ISGenerated = false;
    private nextVideoDts = 0;
    private _initPTS?: number;
    private _initDTS?: number;
    private config: MP4RemuxerConfig;

    insertDiscontinuity() {
        this._initPTS = this._initDTS = undefined;
    }

    switchLevel() {
        this.ISGenerated = false;
    }

    pushVideo(videoTrack: MP4.VideoTrack) {
        // generate Init Segment if needed
        if (!this.ISGenerated) {
            this.generateVideoIS(videoTrack);
        }
        if (this.ISGenerated) {
            if (videoTrack.samples.length) {
                this.remuxVideo(videoTrack);
            }
        }
    }

    remuxVideo(track: MP4.VideoTrack) {
        const inputSamples = track.samples,
            outputSamples: MP4.VideoSample[] = [];

        try {
            let offset = 8;
            let hasKey = false;
            let dts0 = inputSamples[0].dts;

            // concatenate the video data and construct the mdat in place
            // (need 8 more bytes to fill length and mdat type)
            const mdat = new Uint8Array(track.len + 4 * track.nbNalu + 8);
            let view = new DataView(mdat.buffer);
            view.setUint32(0, mdat.byteLength);
            mdat.set(MP4.fourcc("mdat"), 4);
            let ptsnorm: number,
                dtsnorm = 0,
                lastDTS: number | undefined;

            for (let i = 0; i < inputSamples.length; i++) {
                let videoSample = inputSamples[i],
                    mp4SampleLength = 0;
                // convert NALU bitstream to MP4 format (prepend NALU with size field)
                while (videoSample.units.length) {
                    let unit = videoSample.units.shift()!;
                    view.setUint32(offset, unit.data.byteLength);
                    offset += 4;
                    mdat.set(unit.data, offset);
                    offset += unit.data.byteLength;
                    mp4SampleLength += 4 + unit.data.byteLength;
                }

                let pts = videoSample.pts - this._initPTS!;
                let dts = videoSample.dts - this._initDTS!;
                dts = Math.min(pts, dts);

                if (lastDTS !== undefined) {
                    ptsnorm = this._PTSNormalize(pts, lastDTS);
                    dtsnorm = this._PTSNormalize(dts, lastDTS);
                } else {
                    const nextVideoDts = this.nextVideoDts;
                    ptsnorm = this._PTSNormalize(pts, nextVideoDts);
                    dtsnorm = this._PTSNormalize(dts, nextVideoDts);
                    if (nextVideoDts) {
                        const delta = Math.round(dtsnorm - nextVideoDts);
                        if (Math.abs(delta) < 600) {
                            if (delta) {
                                if (delta > 1) {
                                    logger.log(`Vid:${delta} ms hole between fragments detected,filling it`);
                                } else if (delta < -1) {
                                    logger.log(`Vid:${-delta} ms overlapping between fragments detected`);
                                }
                                dtsnorm = nextVideoDts;
                                ptsnorm = Math.max(ptsnorm - delta, dtsnorm);
                                logger.log(`Video/PTS/DTS adjusted: ${ptsnorm}/${dtsnorm},delta:${delta}`);
                            }
                        }
                    }
                }

                outputSamples.push({
                    size: mp4SampleLength,
                    duration: this.config.timeBase,
                    cts: 0,
                    flags: {
                        dependsOn: videoSample.key ? 2 : 1,
                        isNonSync: videoSample.key ? 0 : 1,
                    },
                    pts,
                    dts,
                    key: videoSample.key,
                    units: [],
                });
                lastDTS = dtsnorm;
                if (videoSample.key) hasKey = true;
            }
            this.nextVideoDts = dtsnorm;

            if (outputSamples.length && navigator.userAgent.toLowerCase().indexOf("chrome") > -1) {
                let flags = outputSamples[0].flags;
                flags.dependsOn = 2;
                flags.isNonSync = 0;
            }
            track.samples = outputSamples;

            const moof = MP4.moof(track.sequenceNumber++, dtsnorm, track);
            this.config.onData(moof, undefined);
            this.config.onData(mdat, hasKey ? track.lastKeyFrameDTS - dts0 : undefined);
        } catch (e) {
            logger.error("Error while remuxing video track", e);
        }
        track.samples = [];
        track.len = 0;
        track.nbNalu = 0;
    }

    private generateVideoIS(videoTrack: MP4.VideoTrack) {
        const videoSamples = videoTrack.samples,
            computePTSDTS = this._initPTS === undefined;
        let initPTS = Infinity,
            initDTS = Infinity,
            initseg: Uint8Array | null = null;

        if (videoTrack.decoderConfiguration && videoSamples.length) {
            videoTrack.timescale = this.config.timeScale; //this.MP4_TIMESCALE;
            initseg = MP4.initSegment(videoTrack);
            if (computePTSDTS) {
                initPTS = Math.min(initPTS, videoSamples[0].pts - this.config.timeBase);
                initDTS = Math.min(initDTS, videoSamples[0].dts - this.config.timeBase);
            }
        }

        if (initseg) {
            this.config.onInitSegment(initseg);

            this.ISGenerated = true;
            if (computePTSDTS) {
                this._initPTS = initPTS;
                this._initDTS = initDTS;
            }
        } else if (videoSamples.length > 3) {
            logger.error("didn't get SPS and PPS");
        }
    }

    private _PTSNormalize(value: number, reference?: number) {
        if (reference === undefined) {
            return value;
        }
        let offset;
        if (reference < value) {
            // - 2^33
            offset = -8589934592;
        } else {
            // + 2^33
            offset = 8589934592;
        }
        /* PTS is 33bit (from 0 to 2^33 -1)
      if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
      PTS looping occured. fill the gap */
        while (Math.abs(value - reference) > 4294967296) {
            value += offset;
        }
        return value;
    }
}
