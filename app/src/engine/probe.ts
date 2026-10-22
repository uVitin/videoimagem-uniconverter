/** Le os metadados do arquivo de entrada com ffprobe. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveBinaries } from "./binaries";
import type { SourceInfo } from "./resolver";

const run = promisify(execFile);

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; bit_rate?: string; format_name?: string; size?: string };
}

export interface ProbeResult extends SourceInfo {
  path: string;
  containerFormats: string[];
  sizeBytes?: number;
  totalBitrateKbps?: number;
  audioSampleRateHz?: number;
  audioChannels?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** "30000/1001" -> 29.97. Devolve null para "0/0". */
function parseRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const [num, den] = raw.split("/");
  const numerator = Number(num);
  const denominator = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const value = numerator / denominator;
  return value > 0 ? Math.round(value * 1000) / 1000 : null;
}

export async function probeFile(path: string): Promise<ProbeResult> {
  const { ffprobe } = await resolveBinaries();
  const { stdout } = await run(
    ffprobe,
    [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const duration = Number(parsed.format?.duration);
  const totalBitrate = Number(parsed.format?.bit_rate);
  const size = Number(parsed.format?.size);

  const result: ProbeResult = {
    path,
    containerFormats: (parsed.format?.format_name ?? "").split(",").filter(Boolean),
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
  };

  if (Number.isFinite(duration) && duration > 0) result.durationSeconds = duration;
  if (Number.isFinite(totalBitrate) && totalBitrate > 0) {
    result.totalBitrateKbps = Math.round(totalBitrate / 1000);
  }
  if (Number.isFinite(size) && size > 0) result.sizeBytes = size;

  if (video) {
    if (video.width) result.width = video.width;
    if (video.height) result.height = video.height;
    if (video.codec_name) result.videoCodec = video.codec_name;
    const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate);
    if (fps) result.frameRate = fps;
  }
  if (audio) {
    if (audio.codec_name) result.audioCodec = audio.codec_name;
    const sampleRate = Number(audio.sample_rate);
    if (Number.isFinite(sampleRate) && sampleRate > 0) result.audioSampleRateHz = sampleRate;
    if (audio.channels) result.audioChannels = audio.channels;
  }

  return result;
}
