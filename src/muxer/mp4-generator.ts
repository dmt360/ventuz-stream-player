/**
 * Generate MP4 Box
 * 
 * Originally from https://github.com/dailymotion/hls.js
 * Copyright (c) 2017 Dailymotion, licensed under the Apache License, Version 2.0 
 * 
 * Typescript conversion and modifications by Tammo Hinrichs
 */

export type Unit = {
    type: number;
    data: Uint8Array;
};

export type VideoSample = {
    flags: {
        dependsOn: number;
        isNonSync: number;
    };
    duration: number;
    size: number;
    cts: number;
    pts: number;
    dts: number;
    units: Unit[];
    key: boolean;
};

export type VideoTrack = {
    timescale: number;
    duration: number;

    len: number;
    id: number;
    width: number;
    height: number;
    sequenceNumber: number;
    lastKeyFrameDTS: number;

    nbNalu: number;

    samples: VideoSample[];

    sps?: Uint8Array[];
    pps?: Uint8Array[];
};

export const types: { [k: string]: number[] } = {
    avc1: [], // codingname
    avcC: [],
    btrt: [],
    dinf: [],
    dref: [],
    esds: [],
    ftyp: [],
    hdlr: [],
    mdat: [],
    mdhd: [],
    mdia: [],
    mfhd: [],
    minf: [],
    moof: [],
    moov: [],
    mp4a: [],
    mvex: [],
    mvhd: [],
    sdtp: [],
    stbl: [],
    stco: [],
    stsc: [],
    stsd: [],
    stsz: [],
    stts: [],
    tfdt: [],
    tfhd: [],
    traf: [],
    trak: [],
    trun: [],
    trex: [],
    tkhd: [],
    vmhd: [],
    smhd: [],
};

const HDLR_video = new Uint8Array([
    0x00, // version 0
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x00, // pre_defined
    0x76,
    0x69,
    0x64,
    0x65, // handler_type: 'vide'
    0x00,
    0x00,
    0x00,
    0x00, // reserved
    0x00,
    0x00,
    0x00,
    0x00, // reserved
    0x00,
    0x00,
    0x00,
    0x00, // reserved
    0x56,
    0x69,
    0x64,
    0x65,
    0x6f,
    0x48,
    0x61,
    0x6e,
    0x64,
    0x6c,
    0x65,
    0x72,
    0x00, // name: 'VideoHandler'
]);

const STTS = new Uint8Array([
    0x00, // version
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x00, // entry_count
]);

const STSC = new Uint8Array([
    0x00, // version
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x00, // entry_count
]);

const STCO = new Uint8Array([
    0x00, // version
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x00, // entry_count
]);

const STSZ = new Uint8Array([
    0x00, // version
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x00, // sample_size
    0x00,
    0x00,
    0x00,
    0x00, // sample_count
]);

const VMHD = new Uint8Array([
    0x00, // version
    0x00,
    0x00,
    0x01, // flags
    0x00,
    0x00, // graphicsmode
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // opcolor
]);

const STSD = new Uint8Array([
    0x00, // version 0
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x01,
]); // entry_count

let FTYP: Uint8Array;
let DINF: Uint8Array;

export function init() {
    for (const i in types) {
        if (types.hasOwnProperty(i)) {
            types[i] = [i.charCodeAt(0), i.charCodeAt(1), i.charCodeAt(2), i.charCodeAt(3)];
        }
    }

    const dref = new Uint8Array([
        0x00, // version 0
        0x00,
        0x00,
        0x00, // flags
        0x00,
        0x00,
        0x00,
        0x01, // entry_count
        0x00,
        0x00,
        0x00,
        0x0c, // entry_size
        0x75,
        0x72,
        0x6c,
        0x20, // 'url' type
        0x00, // version 0
        0x00,
        0x00,
        0x01, // entry_flags
    ]);

    const majorBrand = new Uint8Array([105, 115, 111, 109]); // isom
    const avc1Brand = new Uint8Array([97, 118, 99, 49]); // avc1
    const minorVersion = new Uint8Array([0, 0, 0, 1]);

    FTYP = box(types.ftyp, [majorBrand, minorVersion, majorBrand, avc1Brand]);
    DINF = box(types.dinf, [box(types.dref, [dref])]);
}

export function box(type: number[], args: Uint8Array[] = []) {
    let size = args.reduce((acc, arg) => acc + arg.byteLength, 8); // 8 bytes for the box header
    const result = new Uint8Array(size);
    result[0] = (size >> 24) & 0xff;
    result[1] = (size >> 16) & 0xff;
    result[2] = (size >> 8) & 0xff;
    result[3] = size & 0xff;
    result.set(type, 4);
    // copy the payload into the result
    for (let i = 0, size = 8; i < args.length; i++) {
        // copy payload[i] array @ offset size
        result.set(args[i], size);
        size += args[i].byteLength;
    }
    return result;
}

export function hdlr() {
    return box(types.hdlr, [HDLR_video]);
}

export function mdat(data: Uint8Array) {
    return box(types.mdat, [data]);
}

export function mdhd(timescale: number, duration: number) {
    duration *= timescale;
    return box(types.mdhd, [
        new Uint8Array([
            0x00, // version 0
            0x00,
            0x00,
            0x00, // flags
            0x00,
            0x00,
            0x00,
            0x02, // creation_time
            0x00,
            0x00,
            0x00,
            0x03, // modification_time
            (timescale >> 24) & 0xff,
            (timescale >> 16) & 0xff,
            (timescale >> 8) & 0xff,
            timescale & 0xff, // timescale
            duration >> 24,
            (duration >> 16) & 0xff,
            (duration >> 8) & 0xff,
            duration & 0xff, // duration
            0x55,
            0xc4, // 'und' language (undetermined)
            0x00,
            0x00,
        ]),
    ]);
}

export function mdia(track: VideoTrack) {
    return box(types.mdia, [mdhd(track.timescale, track.duration), hdlr(), minf(track)]);
}

export function mfhd(sequenceNumber: number) {
    return box(types.mfhd, [
        new Uint8Array([
            0x00,
            0x00,
            0x00,
            0x00, // flags
            sequenceNumber >> 24,
            (sequenceNumber >> 16) & 0xff,
            (sequenceNumber >> 8) & 0xff,
            sequenceNumber & 0xff, // sequence_number
        ]),
    ]);
}

export function minf(track: VideoTrack) {
    return box(types.minf, [box(types.vmhd, [VMHD]), DINF, stbl(track)]);
}

export function moof(sn: number, baseMediaDecodeTime: number, track: VideoTrack) {
    return box(types.moof, [mfhd(sn), traf(track, baseMediaDecodeTime)]);
}

export function moov(tracks: VideoTrack[]) {
    return box(types.moov, [mvhd(tracks[0].timescale, tracks[0].duration), ...tracks.map(trak), mvex(tracks)]);
}

export function mvex(tracks: VideoTrack[]) {
    return box(types.mvex, tracks.map(trex));
}

export function mvhd(timescale: number, duration: number) {
    duration *= timescale;
    const bytes = new Uint8Array([
        0x00, // version 0
        0x00,
        0x00,
        0x00, // flags
        0x00,
        0x00,
        0x00,
        0x01, // creation_time
        0x00,
        0x00,
        0x00,
        0x02, // modification_time
        (timescale >> 24) & 0xff,
        (timescale >> 16) & 0xff,
        (timescale >> 8) & 0xff,
        timescale & 0xff, // timescale
        (duration >> 24) & 0xff,
        (duration >> 16) & 0xff,
        (duration >> 8) & 0xff,
        duration & 0xff, // duration
        0x00,
        0x01,
        0x00,
        0x00, // 1.0 rate
        0x01,
        0x00, // 1.0 volume
        0x00,
        0x00, // reserved
        0x00,
        0x00,
        0x00,
        0x00, // reserved
        0x00,
        0x00,
        0x00,
        0x00, // reserved
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x40,
        0x00,
        0x00,
        0x00, // transformation: unity matrix
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00, // pre_defined
        0xff,
        0xff,
        0xff,
        0xff, // next_track_ID
    ]);
    return box(types.mvhd, [bytes]);
}

export function sdtp(track: VideoTrack) {
    const samples = track.samples,
        bytes = new Uint8Array(4 + samples.length);

    // leave the full box header (4 bytes) all zero
    // write the sample table
    for (let i = 0; i < samples.length; i++) {
        const flags = samples[i].flags;
        bytes[i + 4] = flags.dependsOn << 4;
    }

    return box(types.sdtp, [bytes]);
}

export function stbl(track: VideoTrack) {
    return box(types.stbl, [
        stsd(track),
        box(types.stts, [STTS]),
        box(types.stsc, [STSC]),
        box(types.stsz, [STSZ]),
        box(types.stco, [STCO]),
    ]);
}

export function avc1(track: VideoTrack) {
    let sps: number[] = [],
        pps: number[] = [];

    // assemble the SPSs

    for (let i = 0; i < track.sps!.length; i++) {
        const data = track.sps![i];
        const len = data.byteLength;
        sps = [...sps, (len >>> 8) & 0xff, len & 0xff, ...data];
    }

    // assemble the PPSs
    for (let i = 0; i < track.pps!.length; i++) {
        const data = track.pps![i];
        const len = data.byteLength;
        pps = [...pps, (len >>> 8) & 0xff, len & 0xff, ...data];
    }

    const avcc = box(types.avcC, [
            new Uint8Array([
                0x01, // version
                sps[3], // profile
                sps[4], // profile compat
                sps[5], // level
                0xfc | 3, // lengthSizeMinusOne, hard-coded to 4 bytes
                0xe0 | track.sps!.length, // 3bit reserved (111) + numOfSequenceParameterSets
                ...sps,
                track.pps!.length,
                ...pps,
            ]),
        ]), // "PPS"
        width = track.width,
        height = track.height;
    //console.log('avcc:' + Hex.hexDump(avcc));
    return box(
        types.avc1,
        [
            new Uint8Array([
                0x00,
                0x00,
                0x00, // reserved
                0x00,
                0x00,
                0x00, // reserved
                0x00,
                0x01, // data_reference_index
                0x00,
                0x00, // pre_defined
                0x00,
                0x00, // reserved
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00, // pre_defined
                (width >> 8) & 0xff,
                width & 0xff, // width
                (height >> 8) & 0xff,
                height & 0xff, // height
                0x00,
                0x48,
                0x00,
                0x00, // horizresolution
                0x00,
                0x48,
                0x00,
                0x00, // vertresolution
                0x00,
                0x00,
                0x00,
                0x00, // reserved
                0x00,
                0x01, // frame_count
                0x12,
                0x6a,
                0x65,
                0x66,
                0x66, // wfs.js
                0x2d,
                0x79,
                0x61,
                0x6e,
                0x2f,
                0x2f,
                0x2f,
                0x67,
                0x77,
                0x66,
                0x73,
                0x2e,
                0x6a,
                0x73,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00, // compressorname
                0x00,
                0x18, // depth = 24
                0x11,
                0x11,
            ]), // pre_defined = -1
            avcc,
            box(types.btrt, [
                new Uint8Array([
                    0x00,
                    0x1c,
                    0x9c,
                    0x80, // bufferSizeDB
                    0x00,
                    0x2d,
                    0xc6,
                    0xc0, // maxBitrate
                    0x00,
                    0x2d,
                    0xc6,
                    0xc0,
                ]),
            ]),
        ] // avgBitrate
    );
}

export function stsd(track: VideoTrack) {
    return box(types.stsd, [STSD, avc1(track)]);
}

export function tkhd(track: VideoTrack) {
    const id = track.id,
        duration = track.duration * track.timescale,
        width = track.width,
        height = track.height;

    //   console.log( "tkhd==> ",track.id, track.duration, track.timescale, width,height );

    return box(types.tkhd, [
        new Uint8Array([
            0x00, // version 0
            0x00,
            0x00,
            0x07, // flags
            0x00,
            0x00,
            0x00,
            0x00, // creation_time
            0x00,
            0x00,
            0x00,
            0x00, // modification_time
            (id >> 24) & 0xff,
            (id >> 16) & 0xff,
            (id >> 8) & 0xff,
            id & 0xff, // track_ID
            0x00,
            0x00,
            0x00,
            0x00, // reserved
            duration >> 24,
            (duration >> 16) & 0xff,
            (duration >> 8) & 0xff,
            duration & 0xff, // duration
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00, // reserved
            0x00,
            0x00, // layer
            0x00,
            0x00, // alternate_group
            0x00,
            0x00, // non-audio track volume
            0x00,
            0x00, // reserved
            0x00,
            0x01,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x01,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x40,
            0x00,
            0x00,
            0x00, // transformation: unity matrix
            (width >> 8) & 0xff,
            width & 0xff,
            0x00,
            0x00, // width
            (height >> 8) & 0xff,
            height & 0xff,
            0x00,
            0x00, // height
        ]),
    ]);
}

export function traf(track: VideoTrack, baseMediaDecodeTime: number) {
    const sampleDependencyTable = sdtp(track),
        id = track.id;

    //  console.log( "traf==> ",id ,baseMediaDecodeTime);

    return box(types.traf, [
        box(types.tfhd, [
            new Uint8Array([
                0x00, // version 0
                0x00,
                0x00,
                0x00, // flags
                id >> 24,
                (id >> 16) & 0xff,
                (id >> 8) & 0xff,
                id & 0xff, // track_ID
            ]),
        ]),
        box(types.tfdt, [
            new Uint8Array([
                0x00, // version 0
                0x00,
                0x00,
                0x00, // flags
                baseMediaDecodeTime >> 24,
                (baseMediaDecodeTime >> 16) & 0xff,
                (baseMediaDecodeTime >> 8) & 0xff,
                baseMediaDecodeTime & 0xff, // baseMediaDecodeTime
            ]),
        ]),
        trun(
            track,
            sampleDependencyTable.length +
                16 + // tfhd
                16 + // tfdt
                8 + // traf header
                16 + // mfhd
                8 + // moof header
                8
        ), // mdat header
        sampleDependencyTable,
    ]);
}

/**
 * Generate a track box.
 * @param track {object} a track definition
 * @return {Uint8Array} the track box
 */
export function trak(track: VideoTrack) {
    track.duration = track.duration || 0xffffffff;
    return box(types.trak, [tkhd(track), mdia(track)]);
}

export function trex(track: VideoTrack) {
    const id = track.id;
    return box(types.trex, [
        new Uint8Array([
            0x00, // version 0
            0x00,
            0x00,
            0x00, // flags
            id >> 24,
            (id >> 16) & 0xff,
            (id >> 8) & 0xff,
            id & 0xff, // track_ID
            0x00,
            0x00,
            0x00,
            0x01, // default_sample_description_index
            0x00,
            0x00,
            0x00,
            0x00, // default_sample_duration
            0x00,
            0x00,
            0x00,
            0x00, // default_sample_size
            0x00,
            0x01,
            0x00,
            0x01, // default_sample_flags
        ]),
    ]);
}

export function trun(track: VideoTrack, offset: number) {
    const samples = track.samples || [],
        len = samples.length,
        arraylen = 12 + 16 * len,
        array = new Uint8Array(arraylen);

    //sample = samples[0];
    //       console.log( "trun==> ",sample.duration, sample.cts ,sample.size,len );

    offset += 8 + arraylen;
    array.set(
        [
            0x00, // version 0
            0x00,
            0x0f,
            0x01, // flags
            (len >>> 24) & 0xff,
            (len >>> 16) & 0xff,
            (len >>> 8) & 0xff,
            len & 0xff, // sample_count
            (offset >>> 24) & 0xff,
            (offset >>> 16) & 0xff,
            (offset >>> 8) & 0xff,
            offset & 0xff, // data_offset
        ],
        0
    );
    for (let i = 0; i < len; i++) {
        const sample = samples[i];
        const duration = sample.duration;
        const size = sample.size;
        const flags = sample.flags;
        const cts = sample.cts;
        array.set(
            [
                (duration >>> 24) & 0xff,
                (duration >>> 16) & 0xff,
                (duration >>> 8) & 0xff,
                duration & 0xff, // sample_duration
                (size >>> 24) & 0xff,
                (size >>> 16) & 0xff,
                (size >>> 8) & 0xff,
                size & 0xff, // sample_size
                flags.dependsOn,
                flags.isNonSync,
                0,
                0,
                (cts >>> 24) & 0xff,
                (cts >>> 16) & 0xff,
                (cts >>> 8) & 0xff,
                cts & 0xff, // sample_composition_time_offset
            ],
            12 + 16 * i
        );
    }
    return box(types.trun, [array]);
}

export function initSegment(tracks: VideoTrack[]) {
    if (!types[0]) {
        init();
    }
    const movie = moov(tracks);

    const result = new Uint8Array(FTYP.byteLength + movie.byteLength);
    result.set(FTYP);
    result.set(movie, FTYP.byteLength);
    return result;
}
