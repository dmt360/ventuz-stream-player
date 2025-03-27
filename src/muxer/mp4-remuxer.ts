/**
 * fMP4 remuxer
 */
import * as MP4 from './mp4-generator';
import { logger } from './logger';

const ErrorTypes = {
    MEDIA_ERROR: 'Media Error',
};

export type InitSegmentData = {
    container: 'video/mp4';
    codec: string;
    data: Uint8Array;
    sn: number;
    metadata: {
        width: number;
        height: number;
    };
};

export type MP4RemuxerConfig = {
    //stretchShortVideoTrack: boolean
    //maxBufferHole: number
    //maxSeekHole: number
    timeBase: number;
    timeScale: number;
    onInitSegment(is: InitSegmentData): void;
    onData(data: Uint8Array): void;
};

export class MP4Remuxer {
    constructor(config: MP4RemuxerConfig /*observer, id, */) {
        //this.observer = observer;
        //this.id = id;
        this.config = config;
    }

    private ISGenerated = false;
    //private PES2MP4SCALEFACTOR = 4
    //private PES_TIMESCALE = 90000
    //private MP4_TIMESCALE = this.PES_TIMESCALE / this.PES2MP4SCALEFACTOR
    private nextAvcDts = 90300;
    private _initPTS: number | undefined = undefined;
    private _initDTS: number | undefined = undefined;
    private sn = 0;
    private config: MP4RemuxerConfig;
    //private nextAacPts = 0

    get passthrough() {
        return false;
    }

    destroy() {}

    insertDiscontinuity() {
        this._initPTS = this._initDTS = undefined;
    }

    switchLevel() {
        this.ISGenerated = false;
    }

    pushVideo(sn: number, videoTrack: MP4.Track) {
        this.sn = sn;

        // generate Init Segment if needed
        if (!this.ISGenerated) {
            this.generateVideoIS(videoTrack);
        }
        if (this.ISGenerated) {
            if (videoTrack.samples.length) {
                this.remuxVideo_2(videoTrack);
            }
        }
    }

    remuxVideo_2(track: MP4.Track) {
        var offset = 8,
            mdat,
            moof,
            inputSamples = track.samples,
            outputSamples: MP4.VideoSample[] = [];

        /* concatenate the video data and construct the mdat in place
      (need 8 more bytes to fill length and mpdat type) */
        mdat = new Uint8Array(track.len + 4 * track.nbNalu + 8);
        let view = new DataView(mdat.buffer);
        view.setUint32(0, mdat.byteLength);
        mdat.set(MP4.types.mdat, 4);
        let ptsnorm,
            dtsnorm = 0,
            lastDTS;

        for (let i = 0; i < inputSamples.length; i++) {
            let avcSample = inputSamples[i],
                mp4SampleLength = 0;
            // convert NALU bitstream to MP4 format (prepend NALU with size field)
            while (avcSample.units.units.length) {
                let unit = avcSample.units.units.shift()!;
                view.setUint32(offset, unit.data.byteLength);
                offset += 4;
                mdat.set(unit.data, offset);
                offset += unit.data.byteLength;
                mp4SampleLength += 4 + unit.data.byteLength;
            }

            let pts = avcSample.pts - this._initPTS!;
            let dts = avcSample.dts - this._initDTS!;
            dts = Math.min(pts, dts);

            if (lastDTS !== undefined) {
                ptsnorm = this._PTSNormalize(pts, lastDTS);
                dtsnorm = this._PTSNormalize(dts, lastDTS);
            } else {
                var nextAvcDts = this.nextAvcDts,
                    delta;
                ptsnorm = this._PTSNormalize(pts, nextAvcDts);
                dtsnorm = this._PTSNormalize(dts, nextAvcDts);
                if (nextAvcDts) {
                    delta = Math.round(dtsnorm - nextAvcDts);
                    if (/*contiguous ||*/ Math.abs(delta) < 600) {
                        if (delta) {
                            if (delta > 1) {
                                logger.log(`AVC:${delta} ms hole between fragments detected,filling it`);
                            } else if (delta < -1) {
                                logger.log(`AVC:${-delta} ms overlapping between fragments detected`);
                            }
                            dtsnorm = nextAvcDts;
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
                    dependsOn: avcSample.key ? 2 : 1,
                    isNonSync: avcSample.key ? 0 : 1,
                },
                pts,
                dts,
                key: avcSample.key,
                units: { units: [] },
            });
            lastDTS = dtsnorm;
        }

        var lastSampleDuration = 0;
        if (outputSamples.length >= 2) {
            lastSampleDuration = outputSamples[outputSamples.length - 2].duration;
            outputSamples[0].duration = lastSampleDuration;
        }
        this.nextAvcDts = dtsnorm + lastSampleDuration;
        //let dropped = track.dropped
        track.len = 0;
        track.nbNalu = 0;
        track.dropped = 0;
        if (outputSamples.length && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) {
            let flags = outputSamples[0].flags;
            flags.dependsOn = 2;
            flags.isNonSync = 0;
        }
        track.samples = outputSamples;
        moof = MP4.moof(track.sequenceNumber++, dtsnorm, track);
        track.samples = [];

        this.config.onData(moof);
        this.config.onData(mdat);
    }

    generateVideoIS(videoTrack: MP4.Track) {
        var videoSamples = videoTrack.samples,
            computePTSDTS = this._initPTS === undefined,
            initPTS = Infinity,
            initDTS = Infinity;

        var initseg: InitSegmentData | null = null;

        if (videoTrack.sps && videoTrack.pps && videoSamples.length) {
            videoTrack.timescale = this.config.timeScale; //this.MP4_TIMESCALE;
            initseg = {
                container: 'video/mp4',
                codec: videoTrack.codec,
                data: MP4.initSegment([videoTrack]),
                sn: this.sn,
                metadata: {
                    width: videoTrack.width,
                    height: videoTrack.height,
                },
            };
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
        } else {
            console.log('generateVideoIS ERROR==> ', ErrorTypes.MEDIA_ERROR);
        }
    }

    _PTSNormalize(value: number, reference: number) {
        var offset;
        if (reference === undefined) {
            return value;
        }
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
