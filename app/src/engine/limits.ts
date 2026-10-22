/**
 * Avaliacao dos <limit> de um formato.
 *
 * Um limit e uma restricao condicional: "quando o encoder de audio for AC-3,
 * os canais permitidos passam a ser 2 ou 6". Medido sobre as 240 restricoes
 * dos 174 formatos, as condicoes usam so 6 chaves e NUNCA ha duas restricoes
 * com a mesma condicao tocando a mesma chave de resultado -- entao a politica
 * de merge pode ser simples.
 *
 * Politica: aplica todas as restricoes cuja condicao casa, em ordem crescente
 * de especificidade (numero de chaves em `when`). A mais especifica escreve por
 * ultimo e vence. Isso reflete como os dados estao organizados: 32 restricoes
 * condicionam so por VideoEncoder (o caso geral) e 94 por VideoEncoder +
 * Resolution (o refinamento).
 */

import type { ConstraintKey, Format, Limit, ValueSet } from "./types";

/** O estado atual da selecao, contra o qual as condicoes sao testadas. */
export interface Selection {
  videoEncoder?: string | null;
  audioEncoder?: string | null;
  /** "1920*1080" */
  resolution?: string | null;
  frameRate?: number | null;
  sampleRateHz?: number | null;
  channels?: number | null;
}

/** Os conjuntos de valores efetivos depois de aplicar as restricoes. */
export type Constraints = Partial<{
  resolution: ValueSet<string>;
  frame_rate: ValueSet<number>;
  video_bitrate_kbps: ValueSet<number>;
  audio_bitrate_kbps: ValueSet<number>;
  sample_rate_hz: ValueSet<number>;
  channels: ValueSet<number>;
  video_encoders: ValueSet<string>;
  audio_encoders: ValueSet<string>;
}>;

export function formatResolution(width: number, height: number): string {
  return `${width}*${height}`;
}

/** Aceita "1920*1080" e "1920x1080"; devolve a forma canonica com '*'. */
export function canonicalResolution(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^\s*(\d+)\s*[*x×]\s*(\d+)\s*$/.exec(raw);
  return match ? `${match[1]}*${match[2]}` : null;
}

export function parseResolution(raw: string | null | undefined): { width: number; height: number } | null {
  const canonical = canonicalResolution(raw);
  if (!canonical) return null;
  const [w, h] = canonical.split("*");
  return { width: Number(w), height: Number(h) };
}

/** Compara numeros tolerando 23.976 vs "23.976" e 30 vs "30". */
function numbersEqual(a: number | null | undefined, b: string | undefined): boolean {
  if (a == null || b === undefined) return false;
  const parsed = Number(b);
  if (Number.isNaN(parsed)) return false;
  return Math.abs(a - parsed) < 0.01;
}

function stringsEqual(a: string | null | undefined, b: string | undefined): boolean {
  if (a == null || b === undefined) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Uma condicao casa so se TODAS as suas chaves casarem. Chave cujo valor
 * correspondente na selecao esta indefinido NAO casa -- preferimos nao aplicar
 * uma restricao a aplicar a restricao errada.
 */
export function limitMatches(limit: Limit, selection: Selection): boolean {
  const { when } = limit;
  const checks: Array<boolean> = [];

  if (when.VideoEncoder !== undefined) {
    checks.push(stringsEqual(selection.videoEncoder, when.VideoEncoder));
  }
  if (when.AudioEncoder !== undefined) {
    checks.push(stringsEqual(selection.audioEncoder, when.AudioEncoder));
  }
  if (when.Resolution !== undefined) {
    checks.push(
      canonicalResolution(selection.resolution) === canonicalResolution(when.Resolution),
    );
  }
  if (when.FrameRate !== undefined) {
    checks.push(numbersEqual(selection.frameRate, when.FrameRate));
  }
  if (when.SampleRate !== undefined) {
    checks.push(numbersEqual(selection.sampleRateHz, when.SampleRate));
  }
  if (when.Channel !== undefined) {
    checks.push(numbersEqual(selection.channels, when.Channel));
  }

  return checks.length > 0 && checks.every(Boolean);
}

function specificity(limit: Limit): number {
  return Object.keys(limit.when).length;
}

/** Os conjuntos declarados no proprio formato, sem restricao nenhuma. */
export function baseConstraints(format: Format): Constraints {
  const out: Constraints = {};
  if (format.resolution) out.resolution = format.resolution;
  if (format.frame_rate) out.frame_rate = format.frame_rate;
  if (format.video_bitrate_kbps) out.video_bitrate_kbps = format.video_bitrate_kbps;
  if (format.audio_bitrate_kbps) out.audio_bitrate_kbps = format.audio_bitrate_kbps;
  if (format.sample_rate_hz) out.sample_rate_hz = format.sample_rate_hz;
  if (format.channels) out.channels = format.channels;
  if (format.video_encoders) out.video_encoders = format.video_encoders;
  if (format.audio_encoders) out.audio_encoders = format.audio_encoders;
  return out;
}

export interface ConstraintResult {
  constraints: Constraints;
  /** quais restricoes casaram, para poder explicar a decisao na UI */
  applied: Limit[];
}

export function effectiveConstraints(format: Format, selection: Selection): ConstraintResult {
  const constraints = baseConstraints(format);
  const applied = (format.limits ?? [])
    .filter((limit) => limitMatches(limit, selection))
    .sort((a, b) => specificity(a) - specificity(b));

  for (const limit of applied) {
    for (const [key, valueSet] of Object.entries(limit.then)) {
      if (valueSet) {
        // sobrescreve, nao intersecta: o conjunto da restricao e autoritativo
        // ("com AC-3 os canais SAO {2,6}", nao "{1,2,6} ∩ {2,6}")
        (constraints as Record<string, ValueSet<unknown>>)[key as ConstraintKey] = valueSet;
      }
    }
  }

  return { constraints, applied };
}
