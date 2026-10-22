/**
 * Localiza o ffmpeg e o ffprobe.
 *
 * Nao embarcamos os binarios: o ffmpeg com x264/x265 e GPL, e embarcar
 * obrigaria o app todo a ser GPL. O UniConverter contorna isso chamando um
 * ffmpeg separado (o build publico 'tessus'). Fazemos o mesmo: o usuario
 * instala (`brew install ffmpeg`) e nos encontramos.
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
  const found = fromEnv(name) ?? (await fromPath(name)) ?? fromSearchDirs(name);
  if (found) return found;
  throw new Error(
    `nao encontrei o ${name}. Instale com 'brew install ffmpeg' ou aponte ` +
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
