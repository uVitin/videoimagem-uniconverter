/**
 * Monta a linha de comando do ffmpeg a partir de um preset resolvido.
 *
 * Fica separado da execucao de proposito: assim da para mostrar o comando na
 * UI, copiar, testar o builder sem rodar nada, e auditar o que o app faz.
 */

import { parseResolution } from "./limits";
import type { PassthroughDecision } from "./passthrough";
import type { ProbeResult } from "./probe";
import type { ResolvedPreset } from "./resolver";
import type { CodecMap } from "./types";

/** Como encaixar a imagem quando a proporcao da origem difere do alvo. */
export type FitMode = "fit" | "fill" | "stretch";

export interface BuildOptions {
  inputPath: string;
  outputPath: string;
  /** usar VideoToolbox quando o codec-map oferecer e o encoder existir */
  preferHardware?: boolean;
  fitMode?: FitMode;
  passthrough?: PassthroughDecision;
  source?: ProbeResult;
  /** encoders que este ffmpeg tem; se vazio, nao filtramos */
  availableEncoders?: Set<string>;
  /** sobrescrever o arquivo de saida */
  overwrite?: boolean;
  /** so os primeiros N segundos (util para preview rapido) */
  durationLimitSeconds?: number;
}

export interface BuiltCommand {
  args: string[];
  /** o que foi escolhido, para explicar na UI */
  videoEncoder: string | null;
  audioEncoder: string | null;
  usedHardware: boolean;
  videoCopied: boolean;
  audioCopied: boolean;
  warnings: string[];
}

const FASTSTART_CONTAINERS = new Set([".mp4", ".m4v", ".mov", ".m4a", ".m4b"]);

/** Dimensao par; x264/x265 em yuv420p exigem largura e altura pares. */
function evenize(value: number): number {
  return value % 2 === 0 ? value : value - 1;
}

function buildScaleFilter(
  width: number,
  height: number,
  fitMode: FitMode,
): string {
  const w = evenize(width);
  const h = evenize(height);
  switch (fitMode) {
    case "stretch":
      return `scale=${w}:${h}:flags=lanczos`;
    case "fill":
      // preenche o quadro e corta o excesso
      return (
        `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,` +
        `crop=${w}:${h}`
      );
    case "fit":
    default:
      // cabe inteiro e completa com barras
      return (
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
      );
  }
}

/** Escolhe entre o encoder de software e o de hardware do codec-map. */
function pickVideoEncoder(
  codecMap: CodecMap,
  fourcc: string,
  preferHardware: boolean,
  available: Set<string> | undefined,
  warnings: string[],
): { encoder: string | null; extraArgs: string[]; usedHardware: boolean } {
  const entry = codecMap.video[fourcc];
  if (!entry) {
    warnings.push(`FourCC de video '${fourcc}' nao esta no codec-map`);
    return { encoder: null, extraArgs: [], usedHardware: false };
  }
  if (entry.confidence === "low") {
    warnings.push(
      `o mapeamento de '${fourcc}' -> '${entry.encoder}' tem confianca baixa; ` +
        `verifique o resultado`,
    );
  }
  if (!entry.encoder) {
    warnings.push(
      `o ffmpeg nao codifica '${fourcc}'${entry.note ? ` (${entry.note})` : ""}`,
    );
    return { encoder: null, extraArgs: [], usedHardware: false };
  }

  const has = (name: string) => !available || available.size === 0 || available.has(name);

  if (preferHardware && entry.encoder_hw_macos && process.platform === "darwin") {
    if (has(entry.encoder_hw_macos)) {
      // VideoToolbox nao tem CRF; o controle e por bitrate, que e o que usamos.
      return { encoder: entry.encoder_hw_macos, extraArgs: [], usedHardware: true };
    }
    warnings.push(
      `${entry.encoder_hw_macos} nao existe neste ffmpeg; usando ${entry.encoder}`,
    );
  }

  if (!has(entry.encoder)) {
    warnings.push(
      `${entry.encoder} nao existe neste ffmpeg (compile com o suporte ou instale outro build)`,
    );
  }
  return { encoder: entry.encoder, extraArgs: [...entry.extra_args], usedHardware: false };
}

function pickAudioEncoder(
  codecMap: CodecMap,
  fourcc: string,
  available: Set<string> | undefined,
  warnings: string[],
): { encoder: string | null; extraArgs: string[] } {
  const entry = codecMap.audio[fourcc];
  if (!entry) {
    warnings.push(`FourCC de audio '${fourcc}' nao esta no codec-map`);
    return { encoder: null, extraArgs: [] };
  }
  if (entry.confidence === "low") {
    warnings.push(`o mapeamento de audio '${fourcc}' tem confianca baixa`);
  }
  if (!entry.encoder) {
    warnings.push(
      `o ffmpeg nao codifica '${fourcc}'${entry.note ? ` (${entry.note})` : ""}`,
    );
    return { encoder: null, extraArgs: [] };
  }
  if (available && available.size > 0 && !available.has(entry.encoder)) {
    warnings.push(`${entry.encoder} nao existe neste ffmpeg`);
  }
  return { encoder: entry.encoder, extraArgs: [...entry.extra_args] };
}

export function buildCommand(
  codecMap: CodecMap,
  resolved: ResolvedPreset,
  options: BuildOptions,
): BuiltCommand {
  const warnings: string[] = [...resolved.notes
    .filter((note) => note.severity === "warning")
    .map((note) => note.message)];

  const { choices, container } = resolved;
  const passthrough = options.passthrough;
  const fitMode = options.fitMode ?? "fit";

  const args: string[] = ["-hide_banner", "-nostdin"];
  args.push(options.overwrite === false ? "-n" : "-y");
  args.push("-i", options.inputPath);

  if (options.durationLimitSeconds && options.durationLimitSeconds > 0) {
    args.push("-t", String(options.durationLimitSeconds));
  }

  let videoEncoder: string | null = null;
  let audioEncoder: string | null = null;
  let usedHardware = false;
  const videoCopied = passthrough?.video === true;
  const audioCopied = passthrough?.audio === true;

  // --- video ---------------------------------------------------------------
  const hasVideoTarget = choices.videoEncoder != null;
  if (!hasVideoTarget) {
    args.push("-vn");
  } else if (videoCopied) {
    args.push("-c:v", "copy");
  } else {
    const picked = pickVideoEncoder(
      codecMap,
      choices.videoEncoder!,
      options.preferHardware === true,
      options.availableEncoders,
      warnings,
    );
    videoEncoder = picked.encoder;
    usedHardware = picked.usedHardware;

    if (picked.encoder) {
      args.push("-c:v", picked.encoder);
      args.push(...picked.extraArgs);

      const dimensions = parseResolution(choices.resolution);
      if (dimensions) {
        args.push("-vf", buildScaleFilter(dimensions.width, dimensions.height, fitMode));
      }
      if (choices.frameRate != null) {
        args.push("-r", String(choices.frameRate));
      }
      if (choices.videoBitrateKbps != null) {
        const kbps = choices.videoBitrateKbps;
        args.push("-b:v", `${kbps}k`);
        args.push("-maxrate", `${Math.round(kbps * 1.5)}k`);
        args.push("-bufsize", `${kbps * 2}k`);
      }
      // compatibilidade ampla; ProRes e FFV1 tem seus proprios pix_fmt
      if (!["prores_ks", "ffv1", "libwebp", "gif", "png"].includes(picked.encoder)) {
        args.push("-pix_fmt", "yuv420p");
      }
    } else {
      args.push("-vn");
    }
  }

  // --- audio ---------------------------------------------------------------
  const hasAudioTarget = choices.audioEncoder != null;
  if (!hasAudioTarget) {
    args.push("-an");
  } else if (audioCopied) {
    args.push("-c:a", "copy");
  } else {
    const picked = pickAudioEncoder(
      codecMap,
      choices.audioEncoder!,
      options.availableEncoders,
      warnings,
    );
    audioEncoder = picked.encoder;

    if (picked.encoder) {
      args.push("-c:a", picked.encoder);
      // extra_args pode fixar -ar/-ac (AMR-NB exige 8 kHz mono), entao vem antes
      args.push(...picked.extraArgs);
      const pinnedByCodec = new Set(picked.extraArgs);
      if (choices.audioBitrateKbps != null && !isLossless(picked.encoder)) {
        args.push("-b:a", `${choices.audioBitrateKbps}k`);
      }
      if (choices.sampleRateHz != null && !pinnedByCodec.has("-ar")) {
        args.push("-ar", String(choices.sampleRateHz));
      }
      if (choices.channels != null && !pinnedByCodec.has("-ac")) {
        args.push("-ac", String(choices.channels));
      }
    } else {
      args.push("-an");
    }
  }

  // --- container -----------------------------------------------------------
  if (FASTSTART_CONTAINERS.has(container.toLowerCase())) {
    args.push("-movflags", "+faststart");
  }

  // progresso em stdout, em key=value; muito mais estavel que ler o stderr
  args.push("-progress", "pipe:1", "-nostats");
  args.push(options.outputPath);

  return {
    args,
    videoEncoder,
    audioEncoder,
    usedHardware,
    videoCopied,
    audioCopied,
    warnings,
  };
}

function isLossless(encoder: string): boolean {
  return ["flac", "alac", "pcm_s16le", "pcm_s24le", "pcm_s16be", "pcm_f32le"].includes(encoder);
}

/** O comando como string, pronto para copiar e colar no terminal. */
export function commandToString(ffmpegPath: string, args: string[]): string {
  const quote = (value: string) =>
    /[\s"'$`\\!*?{}[\]()<>|&;]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value;
  return [ffmpegPath, ...args].map(quote).join(" ");
}
