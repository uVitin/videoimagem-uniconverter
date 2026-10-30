/**
 * Destinos de conversao em dois passos, como o seletor do Premiere:
 *   1. Formato (MP4, MOV, MKV, MP3...) -- o container, so um por extensao
 *   2. Predefinicao -- "Igual a origem" primeiro, depois as variantes do
 *      formato (4K, HEVC, YouTube...) e os dispositivos compativeis
 *
 * O banco do UniConverter tem 174 "formatos" e 469 presets misturados (dois
 * "MP4", "MOV (2)", dezenas de celulares). Aqui eles viram uma arvore simples.
 */

import { linkProfile, type PresetDatabase } from "./data";
import type { Format } from "./types";

/** Formatos que existem no Format.pro do UniConverter mas que o ffmpeg nao grava. */
export const UNSUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".psd", ".svg", ".eps", ".xpm", ".heic", ".swf", ".amv", ".ape",
]);

export type TargetKind = "video" | "audio" | "image";

export interface TargetPreset {
  /** "match" | "f:<formatId>" | "p:<profileId>" -- estavel entre execucoes */
  id: string;
  label: string;
  group: string;
  formatId: number | null;
  profileId: number | null;
  /** "Igual a origem": tamanho, taxa e bitrate vem do arquivo */
  matchSource: boolean;
  /** ex. "1920×1080" */
  detail: string | null;
}

export interface TargetContainer {
  /** extensao em minusculas, com ponto: ".mp4" */
  key: string;
  title: string;
  kind: TargetKind;
  /** o formato "puro" desse container */
  primaryFormatId: number;
  presets: TargetPreset[];
}

export interface TargetGroup {
  kind: TargetKind;
  label: string;
  containers: TargetContainer[];
}

const KIND_LABEL: Record<TargetKind, string> = { video: "Vídeo", audio: "Áudio", image: "Imagem" };

const NICE_TITLE: Record<string, string> = {
  ".webm": "WebM", ".divx": "DivX", ".mpg": "MPEG", ".ogv": "OGV", ".m2ts": "M2TS",
};

/** Categorias do banco -> rotulo da lista de predefinicoes. */
const GROUP_LABEL: Record<number, string> = {
  7: "Variações do formato",
  9: "Redes e web",
  4: "HD e 3D",
  5: "Edição profissional",
  1: "Dispositivos",
  10: "Imagem",
  8: "Áudio",
  200: "Personalizados",
};
const GROUP_ORDER = ["Recomendado", "Redes e web", "HD e 3D", "Edição profissional",
  "Variações do formato", "Dispositivos", "Imagem", "Áudio", "Personalizados"];

const VIDEO_GROUPS = new Set([9, 4, 5, 1]);
function groupFor(kind: TargetKind, categoryId: number): string {
  return kind === "video" && VIDEO_GROUPS.has(categoryId)
    ? GROUP_LABEL[categoryId]!
    : "Variações do formato";
}

function kindOf(format: Format): TargetKind {
  if (format.category_id === 8) return "audio";
  if (format.category_id === 10) return "image";
  return "video";
}

function normalizeExt(extension: string): string {
  return extension.trim().toLowerCase();
}

function groupRank(label: string): number {
  const index = GROUP_ORDER.indexOf(label);
  return index < 0 ? GROUP_ORDER.length : index;
}

/** O formato "puro" da extensao: mesmo nome da extensao, da categoria Video, menor id. */
function pickPrimary(candidates: Format[], ext: string): Format {
  const bare = ext.replace(".", "");
  const score = (f: Format): number =>
    (f.title.trim().toLowerCase() === bare ? 0 : 10) +
    (f.category_id === 7 ? 0 : 5) +
    f.id / 1000;
  return [...candidates].sort((a, b) => score(a) - score(b))[0]!;
}

function resolutionLabel(format: Format): string | null {
  const [w, h] = (format.resolution?.default ?? "").split("*");
  return w && h ? `${w}×${h}` : null;
}

export function buildTargets(db: PresetDatabase): TargetGroup[] {
  // 1. um container por extensao (e tipo)
  const byExt = new Map<string, Format[]>();
  for (const format of db.formats) {
    const ext = normalizeExt(format.extension);
    if (UNSUPPORTED_EXTENSIONS.has(ext)) continue;
    const bucket = byExt.get(ext);
    if (bucket) bucket.push(format);
    else byExt.set(ext, [format]);
  }

  const containers = new Map<string, TargetContainer>();
  const membership = new Map<string, Format[]>();

  for (const [ext, formats] of byExt) {
    // a extensao pertence ao video se algum formato de video a usa (.mov tem "Live Photo")
    const kinds = new Set(formats.map(kindOf));
    const kind: TargetKind = kinds.has("video") ? "video" : kinds.has("audio") ? "audio" : "image";
    const members = formats.filter((f) => kindOf(f) === kind);
    const primary = pickPrimary(members, ext);

    containers.set(ext, {
      key: ext,
      title: NICE_TITLE[ext] ?? ext.replace(".", "").toUpperCase(),
      kind,
      primaryFormatId: primary.id,
      presets: [
        {
          id: "match",
          label: kind === "video" ? "Igual à origem (recomendado)" : "Padrão do formato",
          group: "Recomendado",
          formatId: primary.id,
          profileId: null,
          matchSource: kind === "video",
          detail: null,
        },
      ],
    });
    membership.set(ext, members.filter((f) => f.id !== primary.id));
  }

  // 2. variantes do formato (4K, HEVC, YouTube, aparelhos...)
  for (const [ext, variants] of membership) {
    const container = containers.get(ext)!;
    const seen = new Set<string>([container.title.toLowerCase()]);
    for (const format of variants) {
      const label = format.title.trim();
      if (seen.has(label.toLowerCase())) continue; // "MP4 (2)" e afins
      seen.add(label.toLowerCase());
      container.presets.push({
        id: `f:${format.id}`,
        label,
        group: groupFor(container.kind, format.category_id),
        formatId: format.id,
        profileId: null,
        matchSource: false,
        detail: resolutionLabel(format),
      });
    }
  }

  // 3. presets (469) no container deles; os repetidos do banco original somem
  const seenProfiles = new Set<string>();
  for (const profile of db.profiles) {
    const link = linkProfile(db, profile);
    const container = containers.get(normalizeExt(link.container));
    if (!container) continue;
    if (profile.title.trim().toLowerCase() === container.title.toLowerCase()) continue; // = "Igual a origem"
    const signature = [
      container.key, profile.title.trim().toLowerCase(), link.format?.category_id ?? 1,
      profile.resolution ? `${profile.resolution.width}x${profile.resolution.height}` : "",
      profile.video_encoder ?? "", profile.audio_encoder ?? "", profile.frame_rate ?? "",
      profile.video_bitrate_kbps ?? "", profile.audio_bitrate_kbps ?? "",
    ].join("|");
    if (seenProfiles.has(signature)) continue;
    seenProfiles.add(signature);
    const categoryId = link.format?.category_id ?? 1;
    container.presets.push({
      id: `p:${profile.id}`,
      label: profile.title.trim(),
      group: groupFor(container.kind, categoryId),
      formatId: null,
      profileId: profile.id,
      matchSource: false,
      detail: profile.resolution ? `${profile.resolution.width}×${profile.resolution.height}` : null,
    });
  }

  // ordem: grupos na ordem fixa; dentro do grupo, alfabetica (o "Recomendado" fica no topo)
  for (const container of containers.values()) {
    container.presets.sort(
      (a, b) =>
        groupRank(a.group) - groupRank(b.group) ||
        a.label.localeCompare(b.label, "pt-BR", { numeric: true }),
    );
  }

  const groups: TargetGroup[] = [];
  for (const kind of ["video", "audio", "image"] as TargetKind[]) {
    const items = [...containers.values()]
      .filter((c) => c.kind === kind)
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    if (items.length > 0) groups.push({ kind, label: KIND_LABEL[kind], containers: items });
  }
  // MP4, MOV e MKV sao 90% do uso: sobem para o topo dos videos
  const video = groups.find((g) => g.kind === "video");
  if (video) {
    const top = [".mp4", ".mov", ".mkv"];
    video.containers.sort(
      (a, b) =>
        (top.includes(a.key) ? top.indexOf(a.key) : 99) -
          (top.includes(b.key) ? top.indexOf(b.key) : 99) ||
        a.title.localeCompare(b.title, "pt-BR"),
    );
  }
  return groups;
}
