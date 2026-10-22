/**
 * Decide quando copiar o stream em vez de reencodar (`-c copy`).
 *
 * E a feature que o UniConverter chama de "lossless" / smart render, e vem de
 * LossLess_xml.xml: por container, quais codecs podem passar direto. Copiar e
 * instantaneo e nao perde qualidade nenhuma -- entao vale sempre tentar.
 */

import type { PassthroughMap } from "./types";
import type { ProbeResult } from "./probe";
import type { UserChoices } from "./resolver";
import { parseResolution } from "./limits";

/**
 * codec_name do ffprobe -> nome usado em LossLess_xml.xml.
 * Os nomes deles sao poucos: H264, HEVC, AAC, AC3, MP3, PCM.
 */
const FFPROBE_TO_WONDERSHARE: Record<string, string> = {
  h264: "H264",
  hevc: "HEVC",
  aac: "AAC",
  ac3: "AC3",
  eac3: "AC3",
  mp3: "MP3",
  pcm_s16le: "PCM",
  pcm_s24le: "PCM",
  pcm_s16be: "PCM",
  pcm_f32le: "PCM",
};

/** ".mp4" -> "MP4", para casar com as chaves de passthrough.json. */
function containerKey(container: string): string {
  return container.replace(/^\./, "").toUpperCase();
}

export interface PassthroughDecision {
  video: boolean;
  audio: boolean;
  /** por que sim ou por que nao, para mostrar na UI */
  videoReason: string;
  audioReason: string;
}

export function decidePassthrough(
  map: PassthroughMap,
  container: string,
  choices: UserChoices,
  source: ProbeResult | undefined,
  allowed: { video: boolean; audio: boolean } = { video: true, audio: true },
): PassthroughDecision {
  const decision: PassthroughDecision = {
    video: false,
    audio: false,
    videoReason: "",
    audioReason: "",
  };

  const key = containerKey(container);
  const entry = map[key];

  if (!source) {
    decision.videoReason = "sem metadados da origem";
    decision.audioReason = "sem metadados da origem";
    return decision;
  }
  if (!entry) {
    const reason = `o container ${key} nao esta no mapa de passthrough`;
    decision.videoReason = reason;
    decision.audioReason = reason;
    return decision;
  }

  // --- video ---------------------------------------------------------------
  if (!allowed.video) {
    decision.videoReason = "desligado nas opcoes";
  } else if (!source.hasVideo) {
    decision.videoReason = "a origem nao tem video";
  } else {
    const sourceName = FFPROBE_TO_WONDERSHARE[source.videoCodec ?? ""];
    const target = parseResolution(choices.resolution);
    const sameSize =
      target == null ||
      (source.width === target.width && source.height === target.height);
    const sameRate =
      choices.frameRate == null ||
      source.frameRate == null ||
      Math.abs(source.frameRate - choices.frameRate) < 0.01;

    if (!sourceName) {
      decision.videoReason = `codec de origem '${source.videoCodec}' nao e copiavel para ${key}`;
    } else if (!(entry.video ?? []).includes(sourceName)) {
      decision.videoReason = `${key} nao aceita ${sourceName} por copia`;
    } else if (!sameSize) {
      decision.videoReason = "a resolucao muda, precisa reencodar";
    } else if (!sameRate) {
      decision.videoReason = "o framerate muda, precisa reencodar";
    } else {
      decision.video = true;
      decision.videoReason = `${sourceName} copiado direto, sem reencode`;
    }
  }

  // --- audio ---------------------------------------------------------------
  if (!allowed.audio) {
    decision.audioReason = "desligado nas opcoes";
  } else if (!source.hasAudio) {
    decision.audioReason = "a origem nao tem audio";
  } else {
    const sourceName = FFPROBE_TO_WONDERSHARE[source.audioCodec ?? ""];
    const sameRate =
      choices.sampleRateHz == null ||
      source.audioSampleRateHz == null ||
      source.audioSampleRateHz === choices.sampleRateHz;
    const sameChannels =
      choices.channels == null ||
      source.audioChannels == null ||
      source.audioChannels === choices.channels;

    if (!sourceName) {
      decision.audioReason = `codec de origem '${source.audioCodec}' nao e copiavel para ${key}`;
    } else if (!(entry.audio ?? []).includes(sourceName)) {
      decision.audioReason = `${key} nao aceita ${sourceName} por copia`;
    } else if (!sameRate) {
      decision.audioReason = "o sample rate muda, precisa reencodar";
    } else if (!sameChannels) {
      decision.audioReason = "o numero de canais muda, precisa reencodar";
    } else {
      decision.audio = true;
      decision.audioReason = `${sourceName} copiado direto, sem reencode`;
    }
  }

  return decision;
}
