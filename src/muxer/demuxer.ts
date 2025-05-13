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
