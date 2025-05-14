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
    codec: string;
    decoderConfiguration?: Uint8Array;
};

const fcCache: { [key: string]: number[] } = {};

export function fourcc(i: string) {
    return fcCache[i] || (fcCache[i] = [i.charCodeAt(0), i.charCodeAt(1), i.charCodeAt(2), i.charCodeAt(3)]);
}

export function u16(i: number) {
    return [(i >>> 8) & 0xff, i & 0xff];
}

export function u24(i: number) {
    return [(i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff];
}

export function u32(i: number) {
    return [(i >>> 24) & 0xff, (i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff];
}

const DREF = box("dref", [
    [
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
    ],
]);

const DINF = box("dinf", [DREF]);

const HDLR = box("hdlr", [
    [
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
    ],
]);

const STTS = box("stts", [
    [
        0x00, // version
        0x00,
        0x00,
        0x00, // flags
        0x00,
        0x00,
        0x00,
        0x00, // entry_count
    ],
]);

const STSC = box("stsc", [
    [
        0x00, // version
        0x00,
        0x00,
        0x00, // flags
        0x00,
        0x00,
        0x00,
        0x00, // entry_count
    ],
]);

const STCO = box("stco", [
    [
        0x00, // version
        0x00,
        0x00,
        0x00, // flags
        0x00,
        0x00,
        0x00,
        0x00, // entry_count
    ],
]);

const STSZ = box("stsz", [
    [
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
    ],
]);

const VMHD = box("vmhd", [
    [
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
    ],
]);

const STSD = [
    0x00, // version 0
    0x00,
    0x00,
    0x00, // flags
    0x00,
    0x00,
    0x00,
    0x01,
]; // entry_count

function box(type: string, args: ArrayLike<number>[] = []) {
    let size = args.reduce((acc, arg) => acc + arg.length, 8); // 8 bytes for the box header
    const result = new Uint8Array(size);

    result.set(u32(size), 0);
    result.set(fourcc(type), 4);
    // copy the payload into the result
    for (let i = 0, size = 8; i < args.length; i++) {
        // copy payload[i] array @ offset size
        result.set(args[i], size);
        size += args[i].length;
    }
    return result;
}

function mdhd(timescale: number, duration: number) {
    return box("mdhd", [
        [
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
            ...u32(timescale), // timescale
            ...u32(duration * timescale), // duration
            0x55,
            0xc4, // 'und' language (undetermined)
            0x00,
            0x00,
        ],
    ]);
}

function mdia(track: VideoTrack) {
    return box("mdia", [mdhd(track.timescale, track.duration), HDLR, minf(track)]);
}

function mfhd(sequenceNumber: number) {
    return box("mfhd", [
        [
            0x00,
            0x00,
            0x00,
            0x00, // flags
            ...u32(sequenceNumber), // sequence_number
        ],
    ]);
}

function minf(track: VideoTrack) {
    return box("minf", [VMHD, DINF, stbl(track)]);
}

export function moof(sn: number, baseMediaDecodeTime: number, track: VideoTrack) {
    return box("moof", [mfhd(sn), traf(track, baseMediaDecodeTime)]);
}

function moov(track: VideoTrack) {
    return box("moov", [mvhd(track.timescale, track.duration), trak(track), mvex(track)]);
}

function mvex(track: VideoTrack) {
    return box("mvex", [trex(track)]);
}

function mvhd(timescale: number, duration: number) {
    return box("mvhd", [
        [
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
            ...u32(timescale), // timescale
            ...u32(duration * timescale), // duration
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
        ],
    ]);
}

function sdtp(track: VideoTrack) {
    const samples = track.samples,
        bytes = new Uint8Array(4 + samples.length);

    // leave the full box header (4 bytes) all zero
    // write the sample table
    for (let i = 0; i < samples.length; i++) {
        const flags = samples[i].flags;
        bytes[i + 4] = flags.dependsOn << 4;
    }

    return box("sdtp", [bytes]);
}

function stbl(track: VideoTrack) {
    return box("stbl", [stsd(track), STTS, STSC, STSZ, STCO]);
}

function videoSample(track: VideoTrack) {
    return [
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
        ...u16(track.width), // width
        ...u16(track.height), // height
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
    ]; // pre_defined = -1
}

function avc1(track: VideoTrack) {   
    const avcc = box("avcC", [track.decoderConfiguration! ]);
    return box("avc1", [videoSample(track), avcc]);
}

function hvc1(track: VideoTrack) {
    const hvcc = box("hvcC", [track.decoderConfiguration! ]);
    return box("hvc1", [videoSample(track), hvcc]);
}

function stsd(track: VideoTrack) {
    if (track.codec === "avc1") return box("stsd", [STSD, avc1(track)]);
    else if (track.codec === "hvc1") return box("stsd", [STSD, hvc1(track)]);
    else throw new Error("Unsupmported codec: " + track.codec);
}

function tkhd(track: VideoTrack) {
    return box("tkhd", [
        [0x00], // version 0
        u24(7), // flags
        u32(0), // creation_time
        u32(0), // modification_time
        u32(track.id), // track_ID
        u32(0), // reserved
        u32(track.duration * track.timescale), // duration
        u32(0), // reserved
        u32(0), // reserved
        u16(0), // layer
        u16(0), // alternate_group
        u16(0), // track volume
        u16(0), // reserved
        u32(1 << 16), // transformation: unity matrix
        u32(0),
        u32(0),
        u32(0),
        u32(1 << 16),
        u32(0),
        u32(0),
        u32(0),
        u32(1 << 30),
        u32(track.width << 16), // width
        u32(track.height << 16), // height
    ]);
}

function traf(track: VideoTrack, baseMediaDecodeTime: number) {
    const sampleDependencyTable = sdtp(track);

    return box("traf", [
        box("tfhd", [
            u32(0), // version 0 / flags
            u32(track.id), // track_ID
        ]),
        box("tfdt", [
            u32(0), // version 0 / flags
            u32(baseMediaDecodeTime), // baseMediaDecodeTime
        ]),
        trun(
            track,
            sampleDependencyTable.length +
                16 + // tfhd
                16 + // tfdt
                8 + // traf header
                16 + // mfhd
                8 + // moof header
                8 // mdat header
        ),
        sampleDependencyTable,
    ]);
}

function trak(track: VideoTrack) {
    track.duration = track.duration || 0xffffffff;
    return box("trak", [tkhd(track), mdia(track)]);
}

function trex(track: VideoTrack) {
    return box("trex", [
        u32(0), // version 0 / flags
        u32(track.id), // track_ID
        u32(1), // default_sample_description_index
        u32(0), // default_sample_duration
        u32(0), // default_sample_size
        u32(0), // default_sample_flags
    ]);
}

function trun(track: VideoTrack, offset: number) {
    const samples = track.samples || [],
        len = samples.length,
        arraylen = 12 + 16 * len,
        array = new Uint8Array(arraylen);

    offset += 8 + arraylen;
    array.set(
        [
            0x00, // version 0
            ...u24(0x0f01), // flags
            ...u32(len), // sample_count
            ...u32(offset), // data_offset
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
                ...u32(duration), // sample_duration
                ...u32(size), // sample_size
                flags.dependsOn,
                flags.isNonSync,
                0,
                0,
                ...u32(cts), // sample_composition_time_offset
            ],
            12 + 16 * i
        );
    }
    return box("trun", [array]);
}

export function initSegment(track: VideoTrack) {
    const movie = moov(track);

    const majorBrand = fourcc("isom");
    const minorVersion = u32(1);
    const ftyp = box("ftyp", [majorBrand, minorVersion, majorBrand, fourcc(track.codec)]);

    const result = new Uint8Array(ftyp.byteLength + movie.byteLength);
    result.set(ftyp);
    result.set(movie, ftyp.byteLength);
    return result;
}
