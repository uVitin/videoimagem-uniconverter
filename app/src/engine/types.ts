/**
 * Tipos do banco de presets extraido em ../../data.
 *
 * O modelo tem duas camadas:
 *   Format  - o que e POSSIVEL (valores permitidos + limites condicionais)
 *   Profile - o que usar por PADRAO para um alvo concreto, via format_id
 */

/** Um campo com valor padrao e conjunto de valores aceitos. */
export interface ValueSet<T> {
  default?: T;
  allowed?: T[];
  /** flags cruas do XML original; 0/1, nao booleano */
  custom?: number;
  variable?: number;
}

/** As chaves que um <limit> pode restringir. */
export type ConstraintKey =
  | "resolution"
  | "frame_rate"
  | "video_bitrate_kbps"
  | "audio_bitrate_kbps"
  | "sample_rate_hz"
  | "channels"
  | "video_encoders"
  | "audio_encoders";

/** As chaves que um <limit> pode testar. */
export type ConditionKey =
  | "VideoEncoder"
  | "AudioEncoder"
  | "Resolution"
  | "FrameRate"
  | "SampleRate"
  | "Channel"
  /** typo presente no XML deles; normalizado para AudioEncoder na leitura */
  | "AudioEncoders";

/**
 * Restricao condicional. Exemplo real do MP4:
 *   { when: { AudioEncoder: "AC3" },
 *     then: { channels: { default: 2, allowed: [2, 6] } } }
 *
 * Varias condicoes no mesmo `when` sao um E logico.
 */
export interface Limit {
  when: Partial<Record<ConditionKey, string>>;
  then: Partial<{
    resolution: ValueSet<string>;
    frame_rate: ValueSet<number>;
    video_bitrate_kbps: ValueSet<number>;
    audio_bitrate_kbps: ValueSet<number>;
    sample_rate_hz: ValueSet<number>;
    channels: ValueSet<number>;
    video_encoders: ValueSet<string>;
    audio_encoders: ValueSet<string>;
  }>;
}

export interface Format {
  id: number;
  title: string;
  description?: string | null;
  category_id: number;
  /** com ponto: ".mp4" */
  extension: string;
  fourcc: string;
  icon?: string;

  multi_track?: boolean;
  keep_chapters?: boolean;
  is_vr?: boolean;
  allows_4k?: boolean;
  intel_only?: boolean;
  sandbox_limited?: boolean;
  is_image_format?: boolean;
  export_to_itunes?: boolean;
  export_wifi?: boolean;
  exposes_h264_profile_level?: boolean;
  default_auto_enc?: number;
  allowed_auto_enc?: number;

  resolution?: ValueSet<string>;
  frame_rate?: ValueSet<number>;
  video_bitrate_kbps?: ValueSet<number>;
  audio_bitrate_kbps?: ValueSet<number>;
  sample_rate_hz?: ValueSet<number>;
  channels?: ValueSet<number>;
  video_encoders?: ValueSet<string>;
  audio_encoders?: ValueSet<string>;

  limits?: Limit[];
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface Profile {
  id: number;
  format_id: number;
  title: string;
  short_title?: string;
  icon?: string;
  order?: number;
  region?: string;
  default_auto_enc?: number;

  /** FourCC, ex. "M264" */
  video_encoder?: string;
  audio_encoder?: string;
  resolution?: Dimensions;
  frame_rate?: number;
  video_bitrate_kbps?: number;
  audio_bitrate_kbps?: number;
  sample_rate_hz?: number;
  channels?: number;

  lossless?: boolean;
  supports_video_stream_copy?: boolean;
  same_as_source?: boolean;
  supports_alpha?: boolean;
  lossless_scale?: number;
}

export interface Category {
  id: number;
  title: string;
  icon?: string;
}

export interface FormatIndexEntry {
  id: number;
  title: string;
  category_id: number;
  icon?: string;
  order?: number;
}

// --- codec-map.json (curadoria nossa, nao extraida) ----------------------- //

export type Confidence = "high" | "medium" | "low";

export interface VideoCodecEntry {
  family: string;
  /** encoder FFmpeg de software; null = FFmpeg nao codifica isso */
  encoder: string | null;
  /** encoder por hardware no macOS (VideoToolbox) */
  encoder_hw_macos: string | null;
  extra_args: string[];
  confidence: Confidence;
  note?: string;
}

export interface AudioCodecEntry {
  family: string;
  encoder: string | null;
  extra_args: string[];
  confidence: Confidence;
  note?: string;
}

export interface CodecMap {
  video: Record<string, VideoCodecEntry>;
  audio: Record<string, AudioCodecEntry>;
}

// --- bitrate-model.json --------------------------------------------------- //

export interface BitrateAnchor {
  width: number;
  height: number;
  fps: number;
  video_bitrate_kbps: number;
}

export interface BitrateModel {
  fourcc_to_family: Record<string, string>;
  family_coefficient: Record<string, number>;
  family_anchors: Record<string, BitrateAnchor[]>;
}

// --- passthrough.json ----------------------------------------------------- //

/** { MP4: { video: ["HEVC","H264"], audio: ["AAC","AC3","PCM"] }, ... } */
export type PassthroughMap = Record<string, { video?: string[]; audio?: string[] }>;
