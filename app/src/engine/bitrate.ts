/**
 * Bitrate recomendado, reconstruido a partir de ParamterRules_Std.plist.
 *
 * O app guarda tres tabelas:
 *   fourcc_to_family  M264 -> "H.264(Baseline)", K264 -> "4K264", HEVC -> "H.265"
 *   family_anchors    por familia, pontos de ancoragem {w, h, fps, kbps}
 *   family_coefficient multiplicador relativo ao H.264 (MJPEG 8, MPEG-2 2, ...)
 *
 * DECISAO DE DESIGN: 15 das 16 familias ja tem ancoras proprias, e aplicar o
 * coeficiente sobre elas contaria o fator duas vezes. Entao usamos as ancoras
 * da familia quando existem, e so caimos nas ancoras de H.264 vezes o
 * coeficiente quando a familia nao tem ancora nenhuma (hoje so 'AMV ').
 * O app pode fazer diferente; nao da para saber sem decompilar.
 */

import type { BitrateAnchor, BitrateModel } from "./types";

const H264_FALLBACK_FAMILY = "H.264(Baseline)";

function normalize(key: string): string {
  return key.trim().toUpperCase();
}

/** Resolve o FourCC para a familia, tolerando o padding de espaco ('AV1 '). */
export function familyFor(model: BitrateModel, fourcc: string): string | null {
  const wanted = normalize(fourcc);
  for (const [key, family] of Object.entries(model.fourcc_to_family)) {
    if (normalize(key) === wanted) return family;
  }
  return null;
}

/**
 * 'H.264(Baseline)' -> 'H.264' para poder achar o coeficiente, cujas chaves
 * sao so a familia base ('H.264', 'MPEG-2', 'MJPEG', ...).
 */
function baseFamily(family: string): string {
  return family.replace(/\s*\(.*\)\s*$/, "").trim();
}

function coefficientFor(model: BitrateModel, family: string): number {
  const direct = model.family_coefficient[family];
  if (typeof direct === "number") return direct;
  const base = model.family_coefficient[baseFamily(family)];
  return typeof base === "number" ? base : 1;
}

function anchorsFor(model: BitrateModel, family: string): BitrateAnchor[] | null {
  const direct = model.family_anchors[family];
  if (direct?.length) return direct;
  const base = model.family_anchors[baseFamily(family)];
  return base?.length ? base : null;
}

/** A ancora cuja contagem de pixels esta mais proxima do alvo (em log). */
function nearestAnchor(anchors: BitrateAnchor[], pixels: number): BitrateAnchor {
  let best = anchors[0]!;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    const anchorPixels = anchor.width * anchor.height;
    if (anchorPixels <= 0) continue;
    const distance = Math.abs(Math.log(pixels / anchorPixels));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  }
  return best;
}

export interface BitrateRecommendation {
  videoBitrateKbps: number;
  family: string;
  anchor: BitrateAnchor;
  /** 1 quando as ancoras da propria familia foram usadas */
  coefficient: number;
  usedFallbackAnchors: boolean;
}

export function recommendVideoBitrate(
  model: BitrateModel,
  fourcc: string,
  width: number,
  height: number,
  fps: number,
): BitrateRecommendation | null {
  if (width <= 0 || height <= 0 || fps <= 0) return null;

  const family = familyFor(model, fourcc);
  if (!family) return null;

  let anchors = anchorsFor(model, family);
  let coefficient = 1;
  let usedFallbackAnchors = false;

  if (!anchors) {
    anchors = anchorsFor(model, H264_FALLBACK_FAMILY);
    coefficient = coefficientFor(model, family);
    usedFallbackAnchors = true;
    if (!anchors) return null;
  }

  const pixels = width * height;
  const anchor = nearestAnchor(anchors, pixels);
  const anchorPixels = anchor.width * anchor.height;
  if (anchorPixels <= 0 || anchor.fps <= 0) return null;

  const scaled =
    anchor.video_bitrate_kbps * (pixels / anchorPixels) * (fps / anchor.fps) * coefficient;

  return {
    videoBitrateKbps: Math.max(64, Math.round(scaled)),
    family,
    anchor,
    coefficient,
    usedFallbackAnchors,
  };
}

/** O valor permitido mais proximo; usado para encaixar o recomendado na lista. */
export function nearestAllowed(value: number, allowed: number[] | undefined): number {
  if (!allowed?.length) return value;
  let best = allowed[0]!;
  let bestDistance = Math.abs(value - best);
  for (const candidate of allowed) {
    const distance = Math.abs(value - candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
