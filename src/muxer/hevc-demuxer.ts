/**
  HEVC parser/demuxer

  Originally from https://github.com/ChihChengYang/wfs.js 
  Copyright (c) 2018 ChihChengYang, licensed under the BSD-2-Clause license

  Adaption to HEVC, Typescript conversion and modifications by Tammo Hinrichs
*/
import * as MP4 from "./mp4-generator";
import { logger } from "./logger";
import { DemuxerConfig, GetBits } from "./demuxer";

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
            units = this.parseNALu(array),
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
                    if (debug) debugString += "VPS ";
                    if (!track.vps) {
                        track.vps = unit.data;
                        // push = true;
                    }
                    break;
                case 33: // SPS
                    if (debug) debugString += "SPS ";
                    if (!track.sps) {
                        track.width = this.config.width;
                        track.height = this.config.height;
                        track.sps = unit.data;
                        track.duration = 0;

                        this.config.onBufferReset(this.getCodecString());
                        push = true;
                    }
                    break;
                case 34: // PPS
                    if (debug) debugString += "PPS ";
                    if (!track.pps) {
                        track.pps = unit.data;
                        push = true;
                    }
                    break;
                case 39: // SEI
                    if (debug) debugString += "SEI ";
                    push = true;
                    break;
                default:
                    if (unit.type >= 19 && unit.type <= 20) {
                        // IDR
                        if (debug) debugString += "IDR ";
                        frame = true;
                        push = true;
                    } else if (unit.type < 32) {
                        // Non-IDR VCL
                        if (debug) debugString += "VCL ";
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

    private getCodecString() {
        const sps = new GetBits(this.decodeRBSP(this.hevcTrack.sps!));
        sps.get(4); // sps_video_parameter_set_id
        const sps_max_layers_minus1 = sps.get(3);
        sps.get(1); // sps_temporal_id_nesting_flag
        const ptl = this.parseProfileTierLevel(sps, sps_max_layers_minus1);

        let str = "hev1.";
        if (ptl.general_profile_space > 0) str += String.fromCharCode(0x40 + ptl.general_profile_space);
        str += ptl.general_profile_idc.toString(10);
        str += ".";
        str += this.reverseBitsU32(ptl.general_profile_compatibility_flags).toString(16);
        str += ".";
        str += ptl.general_tier_flag ? "H" : "L";
        str += ptl.general_level_idc.toString(10);

        const getFlagByte = (n: number) =>
            Math.floor(ptl.general_constraint_indicator_flags * Math.pow(256, n - 5)) & 0xff;
        let numCf = 0;
        for (let i = 0; i < 6; i++) if (getFlagByte(i)) numCf = i + 1;
        for (let i = 0; i < numCf; i++) {
            str += ".";
            str += getFlagByte(i).toString(16);
        }

        return str;
    }

    private parseNALu(array: Uint8Array) {
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

    // get NALu payload (skip header, unescape)
    private decodeRBSP(nalu: Uint8Array) {
        const rbsp: number[] = [];
        let zeroes = 0;

        for (let i = 2; i < nalu.byteLength; ) {
            const value = nalu[i++];
            if (value !== 3 || zeroes < 2) rbsp.push(value);
            zeroes = value ? 0 : zeroes + 1;
        }

        return new Uint8Array(rbsp);
    }

    private parseHRD(hrd: GetBits, cprms_present_flag: boolean, max_sub_layers_minus1: number) {
        let nal_hrd_parameters_present_flag = 0;
        let vcl_hrd_parameters_present_flag = 0;
        let sub_pic_hrd_params_present_flag = 0;

        if (cprms_present_flag) {
            nal_hrd_parameters_present_flag = hrd.get(1);
            vcl_hrd_parameters_present_flag = hrd.get(1);

            if (nal_hrd_parameters_present_flag || vcl_hrd_parameters_present_flag) {
                sub_pic_hrd_params_present_flag = hrd.get(1);

                if (sub_pic_hrd_params_present_flag) {
                    hrd.get(8); // tick_divisor_minus2
                    hrd.get(5); // du_cpb_removal_delay_increment_length_minus1
                    hrd.get(1); // sub_pic_cpb_params_in_pic_timing_sei_flag
                    hrd.get(5); // dpb_output_delay_du_length_minus1
                }

                hrd.get(4); // bit_rate_scale
                hrd.get(4); // cpb_size_scale

                if (sub_pic_hrd_params_present_flag) hrd.get(4); // cpb_size_du_scale

                hrd.get(5); // initial_cpb_removal_delay_length_minus1
                hrd.get(5); // au_cpb_removal_delay_length_minus1
                hrd.get(5); // dpb_output_delay_length_minus1
            }
        }

        for (let i = 0; i <= max_sub_layers_minus1; i++) {
            const fixed_pic_rate_general_flag = hrd.get(1);

            let fixed_pic_rate_within_cvs_flag = 0;
            if (!fixed_pic_rate_general_flag) fixed_pic_rate_within_cvs_flag = hrd.get(1);

            let low_delay_hrd_flag = 0;
            if (fixed_pic_rate_within_cvs_flag) hrd.getExpGolomb(); // elemental_duration_in_tc_minus1
            else low_delay_hrd_flag = hrd.get(1);

            let cpb_cnt_minus1 = 0;
            if (!low_delay_hrd_flag) cpb_cnt_minus1 = hrd.getExpGolomb();

            const toSkip = cpb_cnt_minus1 * (nal_hrd_parameters_present_flag + vcl_hrd_parameters_present_flag);

            for (i = 0; i <= toSkip; i++) {
                hrd.getExpGolomb(); // bit_rate_value_minus1
                hrd.getExpGolomb(); // cpb_size_value_minus1

                if (sub_pic_hrd_params_present_flag) {
                    hrd.getExpGolomb(); // cpb_size_du_value_minus1
                    hrd.getExpGolomb(); // bit_rate_du_value_minus1
                }

                hrd.get(1); // cbr_flag
            }
        }

        return 0;
    }

    private parseVUIParameters(vui: GetBits, max_sub_layers_minus1: number) {
        const result: {
            colour_primaries?: number;
            transfer_characteristics?: number;
            matrix_coeffs?: number;
            min_spatial_segmentation_idc?: number;
        } = {};

        const aspect_ratio_info_present_flag = vui.get(1);
        if (aspect_ratio_info_present_flag) {
            const aspect_ratio_idc = vui.get(8);
            if (aspect_ratio_idc == 0xff) {
                vui.get(16); // sar_width
                vui.get(16); // sar_height
            }
        }

        const overscan_info_present_flag = vui.get(1);
        if (overscan_info_present_flag) vui.get(1); // overscan_appropriate_flag

        const video_signal_type_present_flag = vui.get(1);
        if (video_signal_type_present_flag) {
            vui.get(3); // video_format
            vui.get(1); // video_full_range_flag

            const colour_description_present_flag = vui.get(1);
            if (colour_description_present_flag) {
                result.colour_primaries = vui.get(8);
                result.transfer_characteristics = vui.get(8);
                result.matrix_coeffs = vui.get(8);
            }
        }

        const chroma_loc_info_present_flag = vui.get(1);
        if (chroma_loc_info_present_flag) {
            vui.getExpGolomb(); // chroma_sample_loc_type_top_field
            vui.getExpGolomb(); // chroma_sample_loc_type_bottom_field
        }

        vui.get(1); // neutral_chroma_indication_flag
        vui.get(1); // field_seq_flag
        vui.get(1); // frame_field_info_present_flag

        const default_display_window_flag = vui.get(1);
        if (default_display_window_flag) {
            vui.getExpGolomb(); // def_disp_win_left_offset
            vui.getExpGolomb(); // def_disp_win_right_offset
            vui.getExpGolomb(); // def_disp_win_top_offset
            vui.getExpGolomb(); // def_disp_win_bottom_offset
        }

        const vui_timing_info_present_flag = vui.get(1);
        if (vui_timing_info_present_flag) {
            //
            vui.get(32); // num_units_in_tick
            vui.get(32); // time_scale

            const poc_proportional_to_timing_flag = vui.get(1);
            if (poc_proportional_to_timing_flag) vui.getExpGolomb(); // num_ticks_poc_diff_one_minus1

            const vui_hrd_parameters_present_flag = vui.get(1);
            if (vui_hrd_parameters_present_flag) this.parseHRD(vui, true, max_sub_layers_minus1);
        }

        const bitstream_restriction_flag = vui.get(1);
        if (bitstream_restriction_flag) {
            vui.get(1); // tiles_fixed_structure_flag
            vui.get(1); // motion_vectors_over_pic_boundaries_flag
            vui.get(1); // restricted_ref_pic_lists_flag

            result.min_spatial_segmentation_idc = vui.getExpGolomb();

            vui.getExpGolomb(); // max_bytes_per_pic_denom
            vui.getExpGolomb(); // max_bits_per_min_cu_denom
            vui.getExpGolomb(); // log2_max_mv_length_horizontal
            vui.getExpGolomb(); // log2_max_mv_length_vertical
        }

        return result;
    }

    private parseProfileTierLevel(ptl: GetBits, max_sub_layers_minus1: number) {
        const general_profile_space = ptl.get(2);
        const general_tier_flag = ptl.get(1);
        const general_profile_idc = ptl.get(5);
        const general_profile_compatibility_flags = ptl.get(32);
        const general_constraint_indicator_flags = ptl.get(48);
        const general_level_idc = ptl.get(8);

        // skip sub layers
        const sub_layer_profile_present_flag: number[] = [];
        const sub_layer_level_present_flag: number[] = [];
        for (let i = 0; i < max_sub_layers_minus1; i++) {
            sub_layer_profile_present_flag.push(ptl.get(1));
            sub_layer_level_present_flag.push(ptl.get(1));
        }

        if (max_sub_layers_minus1 > 0) for (let i = max_sub_layers_minus1; i < 8; i++) ptl.get(2); // reserved_zero_2bits

        for (let i = 0; i < max_sub_layers_minus1; i++) {
            if (sub_layer_profile_present_flag[i]) {
                ptl.get(8); // profile
                ptl.get(32); // compatibility flags
                ptl.get(4); // source/constraint flags
                ptl.get(44); // reserved
            }
            if (sub_layer_level_present_flag[i]) ptl.get(8);
        }

        return {
            general_profile_space,
            general_tier_flag,
            general_profile_idc,
            general_profile_compatibility_flags,
            general_constraint_indicator_flags,
            general_level_idc,
        };
    }

    private parseSPS() {
        const sps = new GetBits(this.decodeRBSP(this.hevcTrack.sps!));
        sps.get(4); // sps_video_parameter_set_id
        const sps_max_sub_layers_minus1 = sps.get(3);
        const sps_temporal_id_nesting_flag = sps.get(1);
        const profile_tier_level = this.parseProfileTierLevel(sps, sps_max_sub_layers_minus1);

        sps.getExpGolomb(); // sps_seq_parameter_set_id

        const chroma_format_idc = sps.getExpGolomb();
        if (chroma_format_idc == 3) sps.get(1); // separate_colour_plane_flag

        sps.getExpGolomb(); // pic_width_in_luma_samples
        sps.getExpGolomb(); // pic_height_in_luma_samples

        const conformance_window_flag = sps.get(1);
        if (conformance_window_flag) {
            sps.getExpGolomb(); // conf_win_left_offset
            sps.getExpGolomb(); // conf_win_right_offset
            sps.getExpGolomb(); // conf_win_top_offset
            sps.getExpGolomb(); // conf_win_bottom_offset
        }

        const bit_depth_luma_minus8 = sps.getExpGolomb();
        const bit_depth_chroma_minus8 = sps.getExpGolomb();
        const log2_max_pic_order_cnt_lsb_minus4 = sps.getExpGolomb();

        const sps_sub_layer_ordering_info_present_flag = sps.get(1);
        for (
            let i = sps_sub_layer_ordering_info_present_flag ? 0 : sps_max_sub_layers_minus1;
            i <= sps_max_sub_layers_minus1;
            i++
        ) {
            sps.getExpGolomb(); // max_dec_pic_buffering_minus1
            sps.getExpGolomb(); // max_num_reorder_pics
            sps.getExpGolomb(); // max_latency_increase_plus1
        }

        sps.getExpGolomb(); // log2_min_luma_coding_block_size_minus3
        sps.getExpGolomb(); // log2_diff_max_min_luma_coding_block_size
        sps.getExpGolomb(); // log2_min_transform_block_size_minus2
        sps.getExpGolomb(); // log2_diff_max_min_transform_block_size
        sps.getExpGolomb(); // max_transform_hierarchy_depth_inter
        sps.getExpGolomb(); // max_transform_hierarchy_depth_intra

        const scaling_list_enabled_flag = sps.get(1);
        const sps_scaling_list_data_present_flag = scaling_list_enabled_flag && sps.get(1);
        if (sps_scaling_list_data_present_flag) {
            for (let i = 0; i < 4; i++)
                for (let j = 0; j < (i == 3 ? 2 : 6); j++) {
                    const scaling_list_pred_mode_flag = sps.get(1);
                    if (!scaling_list_pred_mode_flag) sps.getExpGolomb(); // scaling_list_pred_matrix_id_delta
                    else {
                        const nCoeffs = Math.min(64, 1 << (4 + (i << 1)));
                        if (i > 1) sps.getExpGolomb(); // scaling_list_dc_coef_minus8
                        for (let k = 0; k < nCoeffs; k++) sps.getExpGolomb(); // scaling_list_delta_coef
                    }
                }
        }

        sps.get(1); // amp_enabled_flag
        sps.get(1); // sample_adaptive_offset_enabled_flag

        const pcm_enabled_flag = sps.get(1);
        if (pcm_enabled_flag) {
            sps.get(4); // pcm_sample_bit_depth_luma_minus1
            sps.get(4); // pcm_sample_bit_depth_chroma_minus1
            sps.getExpGolomb(); // log2_min_pcm_luma_coding_block_size_minus3
            sps.getExpGolomb(); // log2_diff_max_min_pcm_luma_coding_block_size
            sps.get(1); // pcm_loop_filter_disabled_flag
        }

        const num_short_term_ref_pic_sets = sps.getExpGolomb();
        // skip st_ref_pic_set[]
        const nDeltas: number[] = [];
        for (let rps = 0; rps < num_short_term_ref_pic_sets; rps++) {
            const inter_ref_pic_set_prediction_flag = rps && sps.get(1);
            if (inter_ref_pic_set_prediction_flag) {
                sps.get(1); // delta_rps_sign
                sps.getExpGolomb(); // abs_delta_rps_minus1
                nDeltas.push(0);
                for (let i = 0; i <= nDeltas[rps - 1]; i++) {
                    const used_by_curr_pic_flag = sps.get(1);
                    const use_delta_flag = used_by_curr_pic_flag || sps.get(1);
                    if (use_delta_flag) nDeltas[rps]++;
                }
            } else {
                const num_negative_pics = sps.getExpGolomb();
                const num_positive_pics = sps.getExpGolomb();
                const nPics = num_negative_pics + num_positive_pics;
                nDeltas.push(nPics);
                for (let i = 0; i < nPics; i++) {
                    sps.getExpGolomb(); // delta_poc_s0_minus1
                    sps.get(1); // used_by_curr_pic_s0_flag
                }
            }
        }

        const long_term_ref_pics_present_flag = sps.get(1);
        if (long_term_ref_pics_present_flag) {
            const num_long_term_ref_pics_sps = sps.getExpGolomb();
            for (let i = 0; i < num_long_term_ref_pics_sps; i++) {
                sps.get(log2_max_pic_order_cnt_lsb_minus4 + 4); // lt_ref_pic_poc_lsb_sps
                sps.get(1); // used_by_curr_pic_lt_sps_flag
            }
        }

        sps.get(1); // sps_temporal_mvp_enabled_flag
        sps.get(1); // strong_intra_smoothing_enabled_flag

        const vui_parameters_present_flag = sps.get(1);
        const vui_parameters = vui_parameters_present_flag
            ? this.parseVUIParameters(sps, sps_max_sub_layers_minus1)
            : {};

        return {
            sps_max_sub_layers_minus1,
            sps_temporal_id_nesting_flag,
            ...profile_tier_level,
            chroma_format_idc,
            bit_depth_luma_minus8,
            bit_depth_chroma_minus8,
            ...vui_parameters,
        };
    }

    private parseVPS() {
        const vps = new GetBits(this.decodeRBSP(this.hevcTrack.vps!));

        vps.get(4); // vps_video_parameter_set_id
        vps.get(2); // vps_reserved_three_2bits
        vps.get(6); // vps_max_layers_minus1

        const vps_max_sub_layers_minus1 = vps.get(3);

        vps.get(1); // vps_temporal_id_nesting_flag
        vps.get(16); // vps_reserved_0xffff_16bits

        const profile_tier_level = this.parseProfileTierLevel(vps, vps_max_sub_layers_minus1);

        return {
            vps_max_sub_layers_minus1,
            ...profile_tier_level,
        };
    }

    private parsePPS() {
        const pps = new GetBits(this.decodeRBSP(this.hevcTrack.pps!));
        pps.getExpGolomb(); // pps_pic_parameter_set_id
        pps.getExpGolomb(); // pps_seq_parameter_set_id

        pps.get(1); // dependent_slice_segments_enabled_flag
        pps.get(1); // output_flag_present_flag
        pps.get(3); // num_extra_slice_header_bits
        pps.get(1); // sign_data_hiding_enabled_flag
        pps.get(1); // cabac_init_present_flag

        pps.getExpGolomb(); // num_ref_idx_l0_default_active_minus1
        pps.getExpGolomb(); // num_ref_idx_l1_default_active_minus1
        pps.getExpGolombSigned(); // init_qp_minus26

        pps.get(1); // constrained_intra_pred_flag
        pps.get(1); // transform_skip_enabled_flag

        const cu_qp_delta_enabled_flag = pps.get(1);
        if (cu_qp_delta_enabled_flag) pps.getExpGolomb(); // diff_cu_qp_delta_depth

        pps.getExpGolombSigned(); // pps_cb_qp_offset
        pps.getExpGolombSigned(); // pps_cr_qp_offset

        pps.get(1); // pps_slice_chroma_qp_offsets_present_flag
        pps.get(1); // weighted_pred_flag
        pps.get(1); // weighted_bipred_flag
        pps.get(1); // transquant_bypass_enabled_flag

        const tiles_enabled_flag = pps.get(1);
        const entropy_coding_sync_enabled_flag = pps.get(1);

        return {
            tiles_enabled_flag,
            entropy_coding_sync_enabled_flag,
        };
    }

    private parseHEVCInitData() {
        const spsData = this.parseSPS();
        const vpsData = this.parseVPS();
        const ppsData = this.parsePPS();

        return {
            ...spsData,
            ...vpsData,
            ...ppsData,
        };
    }
}

export interface HEVCDecoderConfigurationRecord {
    min_spatial_segmentation_idc: number;
    parallelismType: number;
}
