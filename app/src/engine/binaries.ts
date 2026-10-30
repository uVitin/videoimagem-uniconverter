/**
 * Localiza o ffmpeg e o ffprobe.
 *
 * O ffmpeg com x264/x265 e GPL. Ele roda como processo separado (nao e
 * linkado ao app), entao so acompanha o instalador como binario independente,
 * em `<resources>/bin`. Ordem: variavel de ambiente -> o que vem no app ->
 * PATH -> pastas comuns. Assim o app funciona em maquina limpa e o
 * comportamento e o mesmo em todas; em desenvolvimento (sem pasta bin) usa o
 * ffmpeg instalado (`brew install ffmpeg`).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const SEARCH_DIRS = [
  "/opt/homebrew/bin", // Homebrew em Apple Silicon
  "/usr/local/bin", // Homebrew em Intel
  "/opt/local/bin", // MacPorts
  "/usr/bin",
];

export interface Binaries {
  ffmpeg: string;
  ffprobe: string;
  version: string;
}

function fromEnv(name: "ffmpeg" | "ffprobe"): string | null {
  const key = name === "ffmpeg" ? "VIDEOIMAGEM_FFMPEG" : "VIDEOIMAGEM_FFPROBE";
  const value = process.env[key];
  return value && existsSync(value) ? value : null;
}

/** ffmpeg/ffprobe que acompanham o app instalado (`<resources>/bin`). */
export function bundledBinaryPath(
  resourcesPath: string | undefined,
  name: "ffmpeg" | "ffprobe",
): string | null {
  if (!resourcesPath) return null;
  const candidate = join(resourcesPath, "bin", name);
  return existsSync(candidate) ? candidate : null;
}

async function fromPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await run("/usr/bin/which", [name]);
    const found = stdout.trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

function fromSearchDirs(name: string): string | null {
  for (const dir of SEARCH_DIRS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function locate(name: "ffmpeg" | "ffprobe"): Promise<string> {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const found =
    fromEnv(name) ??
    bundledBinaryPath(resources, name) ??
    (await fromPath(name)) ??
    fromSearchDirs(name);
  if (found) return found;
  throw new Error(
    `nao encontrei o ${name}. Reinstale o app (ele vem junto), instale com 'brew install ffmpeg' ou aponte ` +
      `${name === "ffmpeg" ? "VIDEOIMAGEM_FFMPEG" : "VIDEOIMAGEM_FFPROBE"} para o binario.`,
  );
}

let cached: Binaries | null = null;

export async function resolveBinaries(force = false): Promise<Binaries> {
  if (cached && !force) return cached;

  const ffmpeg = await locate("ffmpeg");
  const ffprobe = await locate("ffprobe");

  let version = "desconhecida";
  try {
    const { stdout } = await run(ffmpeg, ["-version"]);
    version = stdout.split("\n")[0]?.trim() ?? version;
  } catch {
    // versao e informativa; nao impede o uso
  }

  cached = { ffmpeg, ffprobe, version };
  return cached;
}

/** Encoders que este ffmpeg realmente tem (ex. libx265, hevc_videotoolbox). */
export async function availableEncoders(ffmpegPath: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { stdout } = await run(ffmpegPath, ["-hide_banner", "-encoders"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    for (const line of stdout.split("\n")) {
      // formato: " V....D libx264              libx264 H.264 ..."
      const match = /^\s[A-Z.]{6}\s+(\S+)/.exec(line);
      if (match?.[1]) out.add(match[1]);
    }
  } catch {
    // sem a lista, o chamador usa o encoder de software e o ffmpeg reclama se faltar
  }
  return out;
}
