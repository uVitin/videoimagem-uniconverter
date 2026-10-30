/**
 * Resolvedor de preset: transforma "preset escolhido + mexidas do usuario" em
 * uma configuracao de encode que o formato aceita.
 *
 * Nao e um passe unico. Escolher o encoder muda os bitrates permitidos, e
 * escolher a resolucao muda os framerates permitidos -- entao o resolvedor
 * roda em ponto fixo: reavalia as restricoes, encaixa cada campo, e repete
 * ate nada mais mudar.
 */

import { nearestAllowed, recommendVideoBitrate } from "./bitrate";
import { linkProfile, type LinkPath, type PresetDatabase } from "./data";
import {
  canonicalResolution,
  effectiveConstraints,
  formatResolution,
  parseResolution,
  type Constraints,
  type Selection,
} from "./limits";
import type { Format, Limit, Profile, ValueSet } from "./types";

const MAX_PASSES = 6;

/** Formatos de tamanho fixo (TV/DVD/celular antigo): ali "igual a origem" nao vale. */
const FIXED_SIZE_EXTENSIONS = new Set([".mpg", ".vob", ".dv", ".3gp", ".3g2", ".swf", ".amv"]);

export interface UserChoices {
  /** FourCC; null = sem video (so audio) */
  videoEncoder: string | null;
  audioEncoder: string | null;
  /** "1920*1080"; null = igual a origem */
  resolution: string | null;
  /** null = igual a origem */
  frameRate: number | null;
  /** null = calcular pelo modelo de bitrate */
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
}

/** O que sabemos do arquivo de entrada, para resolver "igual a origem". */
export interface SourceInfo {
  width?: number;
  height?: number;
  frameRate?: number;
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export type NoteSeverity = "info" | "adjusted" | "warning";

export interface Note {
  field: string;
  severity: NoteSeverity;
  message: string;
}

export interface ResolveRequest {
  /** um dos 469 presets */
  profileId?: number;
  /** ou direto um dos 174 formatos */
  formatId?: number;
  overrides?: Partial<UserChoices>;
  source?: SourceInfo;
  /**
   * "Igual a origem": so com um formato (sem preset). Resolucao, taxa de quadros
   * e bitrate vem do proprio arquivo em vez dos padroes do formato (640x480...),
   * e a resolucao nao e encaixada na lista do formato -- video vertical continua
   * vertical.
   */
  matchSource?: boolean;
}

export interface ResolvedPreset {
  profile?: Profile;
  format?: Format;
  /** com ponto, ex. ".mp4" */
  container: string;
  linkPath: LinkPath;
  choices: UserChoices;
  /** conjuntos efetivos, para a UI saber o que oferecer */
  constraints: Constraints;
  /** quais limits casaram, para poder explicar a decisao */
  appliedLimits: Limit[];
  notes: Note[];
}

// --------------------------------------------------------------------------- //

function allowedOf<T>(valueSet: ValueSet<T> | undefined): T[] | undefined {
  return valueSet?.allowed?.length ? valueSet.allowed : undefined;
}

function includesString(allowed: string[] | undefined, value: string): boolean {
  if (!allowed) return false;
  const wanted = value.trim().toLowerCase();
  return allowed.some((candidate) => candidate.trim().toLowerCase() === wanted);
}

function includesNumber(allowed: number[] | undefined, value: number): boolean {
  if (!allowed) return false;
  return allowed.some((candidate) => Math.abs(candidate - value) < 0.01);
}

/** Resolucao permitida com a contagem de pixels mais proxima do alvo. */
function nearestAllowedResolution(target: string, allowed: string[]): string {
  const wanted = parseResolution(target);
  if (!wanted) return allowed[0]!;
  const targetPixels = wanted.width * wanted.height;
  let best = allowed[0]!;
  let bestDistance = Infinity;
  for (const candidate of allowed) {
    const parsed = parseResolution(candidate);
    if (!parsed) continue;
    const distance = Math.abs(parsed.width * parsed.height - targetPixels);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

// --------------------------------------------------------------------------- //

function seedFromProfile(profile: Profile | undefined, format: Format | undefined): UserChoices {
  const resolution =
    profile?.resolution
      ? formatResolution(profile.resolution.width, profile.resolution.height)
      : canonicalResolution(format?.resolution?.default ?? null);

  return {
    videoEncoder: profile?.video_encoder ?? format?.video_encoders?.default ?? null,
    audioEncoder: profile?.audio_encoder ?? format?.audio_encoders?.default ?? null,
    resolution,
    frameRate: profile?.frame_rate ?? format?.frame_rate?.default ?? null,
    videoBitrateKbps: profile?.video_bitrate_kbps ?? format?.video_bitrate_kbps?.default ?? null,
    audioBitrateKbps: profile?.audio_bitrate_kbps ?? format?.audio_bitrate_kbps?.default ?? null,
    sampleRateHz: profile?.sample_rate_hz ?? format?.sample_rate_hz?.default ?? null,
    channels: profile?.channels ?? format?.channels?.default ?? null,
  };
}

function selectionOf(choices: UserChoices): Selection {
  return {
    videoEncoder: choices.videoEncoder,
    audioEncoder: choices.audioEncoder,
    resolution: choices.resolution,
    frameRate: choices.frameRate,
    sampleRateHz: choices.sampleRateHz,
    channels: choices.channels,
  };
}

/**
 * Encaixa um campo de texto (encoder) no conjunto permitido.
 * Devolve o valor final e, se mudou, a nota explicando.
 */
function snapString(
  field: keyof UserChoices,
  current: string | null,
  valueSet: ValueSet<string> | undefined,
  pinnedByUser: boolean,
  notes: Note[],
): string | null {
  const allowed = allowedOf(valueSet);
  if (!allowed) return current; // sem tabela de capacidades: aceita como esta
  if (current && includesString(allowed, current)) return current;

  const replacement = valueSet?.default ?? allowed[0]!;
  if (current) {
    notes.push({
      field,
      severity: pinnedByUser ? "warning" : "adjusted",
      message: `'${current}' nao e aceito aqui; usando '${replacement}'. Aceitos: ${allowed.join(", ")}`,
    });
  }
  return replacement;
}

function snapNumber(
  field: keyof UserChoices,
  current: number | null,
  valueSet: ValueSet<number> | undefined,
  pinnedByUser: boolean,
  notes: Note[],
  keepNull = false,
): number | null {
  const allowed = allowedOf(valueSet);
  if (!allowed) return current;
  if (current != null && includesNumber(allowed, current)) return current;

  if (current == null) return keepNull ? null : (valueSet?.default ?? allowed[0]!);

  const replacement = nearestAllowed(current, allowed);
  notes.push({
    field,
    severity: pinnedByUser ? "warning" : "adjusted",
    message: `${current} nao e aceito aqui; usando o mais proximo, ${replacement}`,
  });
  return replacement;
}

function snapResolution(
  current: string | null,
  valueSet: ValueSet<string> | undefined,
  pinnedByUser: boolean,
  notes: Note[],
): string | null {
  const allowed = allowedOf(valueSet);
  if (!allowed || current == null) return current;
  if (includesString(allowed, current)) return current;

  const replacement = nearestAllowedResolution(current, allowed);
  notes.push({
    field: "resolution",
    severity: pinnedByUser ? "warning" : "adjusted",
    message: `${current} nao e aceito aqui; usando ${replacement}`,
  });
  return replacement;
}

/** Acumula notas evitando repetir a mesma mensagem para o mesmo campo. */
function pushUnique(target: Note[], incoming: Note[]): void {
  for (const note of incoming) {
    const duplicate = target.some(
      (existing) =>
        existing.field === note.field &&
        existing.severity === note.severity &&
        existing.message === note.message,
    );
    if (!duplicate) target.push(note);
  }
}

// --------------------------------------------------------------------------- //

export function resolvePreset(db: PresetDatabase, request: ResolveRequest): ResolvedPreset {
  const profile = request.profileId != null ? db.profilesById.get(request.profileId) : undefined;
  if (request.profileId != null && !profile) {
    throw new Error(`preset ${request.profileId} nao existe`);
  }

  let format: Format | undefined;
  let container: string;
  let linkPath: LinkPath;

  if (profile) {
    const link = linkProfile(db, profile);
    format = link.format;
    container = link.container;
    linkPath = link.path;
  } else if (request.formatId != null) {
    format = db.formatsById.get(request.formatId);
    if (!format) throw new Error(`formato ${request.formatId} nao existe`);
    container = format.extension;
    linkPath = "format_id";
  } else {
    throw new Error("informe profileId ou formatId");
  }

  const notes: Note[] = [];
  if (linkPath === "encoder_fallback") {
    notes.push({
      field: "container",
      severity: "info",
      message:
        `este preset nao tem tabela de capacidades em Format.pro; o container ` +
        `'${container}' foi inferido pelo encoder (${profile?.video_encoder ?? "?"})`,
    });
  }

  const overrides = request.overrides ?? {};
  const pinned = new Set(Object.keys(overrides) as Array<keyof UserChoices>);
  const choices: UserChoices = { ...seedFromProfile(profile, format), ...overrides };

  const matchSource =
    request.matchSource === true && !profile && !FIXED_SIZE_EXTENSIONS.has(container.toLowerCase());
  if (matchSource) {
    // o que o usuario nao fixou vem do arquivo, nao dos padroes do formato
    if (!pinned.has("resolution")) choices.resolution = null;
    if (!pinned.has("frameRate")) choices.frameRate = null;
    if (!pinned.has("videoBitrateKbps")) choices.videoBitrateKbps = null;
  }

  // "igual a origem": preenche com o que o ffprobe achou
  const source = request.source;
  if (choices.resolution == null && source?.width && source?.height) {
    choices.resolution = formatResolution(source.width, source.height);
  }
  if (choices.frameRate == null && source?.frameRate) {
    choices.frameRate = source.frameRate;
  }

  let constraints: Constraints = {};
  let appliedLimits: Limit[] = [];

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (!format) break;
    const evaluated = effectiveConstraints(format, selectionOf(choices));
    constraints = evaluated.constraints;
    appliedLimits = evaluated.applied;

    const before = JSON.stringify(choices);
    const passNotes: Note[] = [];

    // ordem importa: os encoders e a resolucao sao condicoes dos limits,
    // entao precisam estar resolvidos antes dos campos que eles restringem.
    choices.videoEncoder = snapString(
      "videoEncoder", choices.videoEncoder, constraints.video_encoders,
      pinned.has("videoEncoder"), passNotes,
    );
    choices.audioEncoder = snapString(
      "audioEncoder", choices.audioEncoder, constraints.audio_encoders,
      pinned.has("audioEncoder"), passNotes,
    );
    if (!(matchSource && !pinned.has("resolution"))) {
      choices.resolution = snapResolution(
        choices.resolution, constraints.resolution, pinned.has("resolution"), passNotes,
      );
    }
    choices.frameRate = snapNumber(
      "frameRate", choices.frameRate, constraints.frame_rate,
      pinned.has("frameRate"), passNotes, matchSource && !pinned.has("frameRate"),
    );
    choices.sampleRateHz = snapNumber(
      "sampleRateHz", choices.sampleRateHz, constraints.sample_rate_hz,
      pinned.has("sampleRateHz"), passNotes,
    );
    choices.channels = snapNumber(
      "channels", choices.channels, constraints.channels,
      pinned.has("channels"), passNotes,
    );
    choices.audioBitrateKbps = snapNumber(
      "audioBitrateKbps", choices.audioBitrateKbps, constraints.audio_bitrate_kbps,
      pinned.has("audioBitrateKbps"), passNotes,
    );
    choices.videoBitrateKbps = snapNumber(
      "videoBitrateKbps", choices.videoBitrateKbps, constraints.video_bitrate_kbps,
      pinned.has("videoBitrateKbps"), passNotes, matchSource && !pinned.has("videoBitrateKbps"),
    );

    // As notas tem de ser acumuladas a cada passagem: justamente a passagem
    // que MUDA um valor e a que produz a explicacao, e ela nao se repete na
    // passagem seguinte (o valor ja esta valido). Guardar so as notas da
    // passagem final perderia todos os ajustes.
    pushUnique(notes, passNotes);

    if (JSON.stringify(choices) === before) break;

    if (pass === MAX_PASSES - 1) {
      notes.push({
        field: "*",
        severity: "warning",
        message:
          `as restricoes nao convergiram em ${MAX_PASSES} passes; ` +
          `a configuracao final pode nao ser otima`,
      });
    }
  }

  // video vertical num preset horizontal (ou o inverso): vira o quadro do preset
  // em vez de encher de barras. So quando o tamanho veio do preset, nao do usuario.
  if (!matchSource && !pinned.has("resolution") && source?.width && source?.height) {
    const target = parseResolution(choices.resolution);
    if (target && target.width !== target.height) {
      const sourcePortrait = source.height > source.width;
      const targetPortrait = target.height > target.width;
      const squarish = Math.abs(source.height - source.width) / Math.max(source.width, source.height) < 0.05;
      if (!squarish && sourcePortrait !== targetPortrait && !targetPortrait) {
        choices.resolution = formatResolution(target.height, target.width);
        notes.push({
          field: "resolution",
          severity: "info",
          message: `video na vertical: usei ${target.height}x${target.width} em vez de ${target.width}x${target.height}, sem barras`,
        });
      }
    }
  }

  // bitrate de video ainda em aberto: calcula pelo modelo e encaixa
  if (choices.videoBitrateKbps == null && choices.videoEncoder) {
    const dimensions = parseResolution(choices.resolution);
    const fps = choices.frameRate ?? 30;
    if (dimensions) {
      const recommendation = recommendVideoBitrate(
        db.bitrateModel, choices.videoEncoder, dimensions.width, dimensions.height, fps,
      );
      if (recommendation) {
        const snapped = nearestAllowed(
          recommendation.videoBitrateKbps,
          allowedOf(constraints.video_bitrate_kbps),
        );
        choices.videoBitrateKbps = snapped;
        notes.push({
          field: "videoBitrateKbps",
          severity: "info",
          message:
            `${snapped} kbps calculado pelo modelo (familia ${recommendation.family}, ` +
            `ancora ${recommendation.anchor.width}x${recommendation.anchor.height}@` +
            `${recommendation.anchor.fps})`,
        });
      }
    }
  }

  return {
    profile,
    format,
    container,
    linkPath,
    choices,
    constraints,
    appliedLimits,
    notes,
  };
}
