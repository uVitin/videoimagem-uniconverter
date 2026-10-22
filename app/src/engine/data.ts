/** Carrega o banco de presets de data/ (uma vez, em memoria). */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  BitrateModel,
  Category,
  CodecMap,
  Format,
  FormatIndexEntry,
  PassthroughMap,
  Profile,
} from "./types";

export interface PresetDatabase {
  dataDir: string;
  categories: Category[];
  formats: Format[];
  formatIndex: FormatIndexEntry[];
  profiles: Profile[];
  codecMap: CodecMap;
  bitrateModel: BitrateModel;
  passthrough: PassthroughMap;
  formatsById: Map<number, Format>;
  formatsByTitle: Map<string, Format>;
  profilesById: Map<number, Profile>;
  profilesByFormat: Map<number, Profile[]>;
}

/**
 * Onde procurar data/. VIDEOIMAGEM_DATA_DIR vence; depois os caminhos de dev
 * (dist/engine -> ../../.. ) e o de app empacotado (process.resourcesPath).
 */
function candidateDirs(): string[] {
  const out: string[] = [];
  if (process.env.VIDEOIMAGEM_DATA_DIR) {
    out.push(resolve(process.env.VIDEOIMAGEM_DATA_DIR));
  }
  out.push(resolve(__dirname, "..", "..", "..", "data")); // dist/engine -> app/../data
  out.push(resolve(__dirname, "..", "..", "data")); // app/data
  out.push(resolve(process.cwd(), "data"));
  out.push(resolve(process.cwd(), "..", "data"));
  const packaged = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (packaged) out.push(join(packaged, "data"));
  return out;
}

export function findDataDir(): string {
  for (const dir of candidateDirs()) {
    if (existsSync(join(dir, "formats.json"))) return dir;
  }
  throw new Error(
    "nao encontrei data/formats.json. Rode 'python3 tools/extract_presets.py' na raiz " +
      "do projeto, ou aponte VIDEOIMAGEM_DATA_DIR para o diretorio data/.\n" +
      "Procurei em:\n  " +
      candidateDirs().join("\n  "),
  );
}

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

/** Normaliza o typo 'AudioEncoders' que existe no XML original. */
function normalizeLimits(formats: Format[]): void {
  for (const format of formats) {
    for (const limit of format.limits ?? []) {
      const when = limit.when as Record<string, string | undefined>;
      if (when.AudioEncoders !== undefined && when.AudioEncoder === undefined) {
        when.AudioEncoder = when.AudioEncoders;
        delete when.AudioEncoders;
      }
    }
  }
}

function titleKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

let cached: PresetDatabase | null = null;

export function loadDatabase(dataDir?: string): PresetDatabase {
  if (cached && !dataDir) return cached;

  const dir = dataDir ? resolve(dataDir) : findDataDir();
  const formats = readJson<Format[]>(dir, "formats.json");
  normalizeLimits(formats);

  const profilesFile = readJson<{
    format_index: FormatIndexEntry[];
    profiles: Profile[];
  }>(dir, "profiles.json");

  const db: PresetDatabase = {
    dataDir: dir,
    categories: readJson<Category[]>(dir, "categories.json"),
    formats,
    formatIndex: profilesFile.format_index,
    profiles: profilesFile.profiles,
    codecMap: readJson<CodecMap>(dir, "codec-map.json"),
    bitrateModel: readJson<BitrateModel>(dir, "bitrate-model.json"),
    passthrough: readJson<PassthroughMap>(dir, "passthrough.json"),
    formatsById: new Map(),
    formatsByTitle: new Map(),
    profilesById: new Map(),
    profilesByFormat: new Map(),
  };

  for (const format of db.formats) {
    db.formatsById.set(format.id, format);
    const key = titleKey(format.title);
    if (key && !db.formatsByTitle.has(key)) db.formatsByTitle.set(key, format);
  }
  for (const profile of db.profiles) {
    db.profilesById.set(profile.id, profile);
    const list = db.profilesByFormat.get(profile.format_id);
    if (list) list.push(profile);
    else db.profilesByFormat.set(profile.format_id, [profile]);
  }

  if (!dataDir) cached = db;
  return db;
}

/**
 * Liga um Profile (preset_profiles.pro, 469 entradas) ao seu Format
 * (Format.pro, 174 entradas, onde vivem a extensao, os valores permitidos
 * e os limits).
 *
 * Os dois arquivos sao de GERACOES DIFERENTES do produto e a ligacao e
 * irregular. Medido sobre as 469 entradas:
 *
 *   214  format_id aponta direto para um Format            (caminho A)
 *    65  format_id e uma aba de marca, mas profile.id casa (caminho B)
 *    74  casa pelo titulo da entrada em format_index        (caminho C)
 *     1  casa pelo titulo do proprio profile                (caminho D)
 *   115  nao casa de jeito nenhum                           (caminho E)
 *
 * Os 115 do caminho E sao todos presets de dispositivo agrupados por marca
 * (Huawei, Apple, SamSung, XIAOMI, Google, Sony, TV, Instagram e as
 * plataformas chinesas). O par de encoders deles e previsivel:
 *   93x IPAN+MAAC, 16x M264+MAAC  -> H.264/AAC, container .mp4
 *    4x AMV+ADPV                  -> .amv
 *    2x AVHD+AAC                  -> .m2ts (AVCHD)
 *
 * Para esses usamos CONTAINER_BY_ENCODER. Isso e uma decisao de design nossa,
 * nao um dado extraido do app.
 */

const CONTAINER_BY_ENCODER: Record<string, string> = {
  AMV: ".amv",
  AVHD: ".m2ts",
};

/** Container de ultimo recurso quando nada mais identifica o formato. */
const FALLBACK_CONTAINER = ".mp4";

export type LinkPath = "format_id" | "profile_id" | "index_title" | "profile_title" | "encoder_fallback";

export interface ProfileLink {
  profile: Profile;
  /** undefined no caminho 'encoder_fallback': nao ha tabela de capacidades */
  format?: Format;
  /** com ponto, ex. ".mp4" */
  container: string;
  path: LinkPath;
}

export function linkProfile(db: PresetDatabase, profile: Profile): ProfileLink {
  const byId = db.formatsById.get(profile.format_id);
  if (byId) return { profile, format: byId, container: byId.extension, path: "format_id" };

  const bySelfId = db.formatsById.get(profile.id);
  if (bySelfId) {
    return { profile, format: bySelfId, container: bySelfId.extension, path: "profile_id" };
  }

  const indexed = db.formatIndex.find((f) => f.id === profile.format_id);
  const byIndexTitle = indexed ? findFormatByTitle(db, indexed.title) : undefined;
  if (byIndexTitle) {
    return {
      profile,
      format: byIndexTitle,
      container: byIndexTitle.extension,
      path: "index_title",
    };
  }

  const byOwnTitle = findFormatByTitle(db, profile.title);
  if (byOwnTitle) {
    return { profile, format: byOwnTitle, container: byOwnTitle.extension, path: "profile_title" };
  }

  const container =
    (profile.video_encoder && CONTAINER_BY_ENCODER[profile.video_encoder]) ?? FALLBACK_CONTAINER;
  return { profile, container, path: "encoder_fallback" };
}

function findFormatByTitle(db: PresetDatabase, title: string | undefined): Format | undefined {
  const key = titleKey(title);
  return key ? db.formatsByTitle.get(key) : undefined;
}
