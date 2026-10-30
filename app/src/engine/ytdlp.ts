/**
 * Download de videos via yt-dlp.
 *
 * O UniConverter embarca um fork privado do youtube-dl 2020 e o atualiza pelo
 * servidor dele (MediaDownloader.bundle), porque os sites mudam toda semana.
 * Nao repetimos isso: usamos o yt-dlp, que e mantido publicamente e roda como
 * binario separado -- o mesmo modelo do ffmpeg (ver binaries.ts). O usuario
 * instala e atualiza com `brew upgrade yt-dlp`.
 *
 * Este modulo e puro Node (sem Electron) para poder ser testado isoladamente.
 */

import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";

const exec = promisify(execFile);

const SEARCH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"];

export interface YtDlpBinary {
  path: string;
  version: string;
}

export type DownloadQuality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "audio";

export const DOWNLOAD_QUALITIES: readonly DownloadQuality[] = [
  "best", "2160", "1440", "1080", "720", "480", "audio",
];

// --------------------------------------------------------------------------- //
// localizar o binario

function fromEnv(): string | null {
  const value = process.env.VIDEOIMAGEM_YTDLP;
  return value && existsSync(value) ? value : null;
}

async function fromPath(): Promise<string | null> {
  try {
    const { stdout } = await exec("/usr/bin/which", ["yt-dlp"]);
    const found = stdout.trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

function fromSearchDirs(): string | null {
  for (const dir of SEARCH_DIRS) {
    const candidate = join(dir, "yt-dlp");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let cached: YtDlpBinary | null = null;

export async function locateYtDlp(force = false): Promise<YtDlpBinary> {
  if (cached && !force) return cached;

  const path = fromEnv() ?? (await fromPath()) ?? fromSearchDirs();
  if (!path) {
    throw new Error(
      "nao encontrei o yt-dlp. Instale com 'brew install yt-dlp' ou aponte " +
        "VIDEOIMAGEM_YTDLP para o binario.",
    );
  }

  let version = "desconhecida";
  try {
    const { stdout } = await exec(path, ["--version"]);
    version = stdout.trim() || version;
  } catch {
    // versao e informativa; nao impede o uso
  }

  cached = { path, version };
  return cached;
}

// --------------------------------------------------------------------------- //
// entrada do usuario

/**
 * So aceita http(s). O yt-dlp tambem abre file:// e outros esquemas, e a URL
 * vem de um campo de texto -- melhor barrar aqui do que confiar no binario.
 */
export function normalizeUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("isso nao parece uma URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("so aceito enderecos http:// ou https://");
  }
  return url.toString();
}

export function isDownloadQuality(value: unknown): value is DownloadQuality {
  return typeof value === "string" && (DOWNLOAD_QUALITIES as readonly string[]).includes(value);
}

// --------------------------------------------------------------------------- //
// informacoes do video

export interface MediaInfo {
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnail?: string;
  /** alturas de video disponiveis, da maior para a menor */
  heights: number[];
  isLive: boolean;
}

/** A ultima linha "ERROR:" do stderr e o motivo real; o resto e ruido. */
export function lastErrorLine(stderr: string): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const error = [...lines].reverse().find((line) => line.startsWith("ERROR:"));
  return (error ?? lines[lines.length - 1] ?? "falha desconhecida").replace(/^ERROR:\s*/, "");
}

export function parseMediaInfo(json: string): MediaInfo {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const formats = Array.isArray(raw.formats) ? (raw.formats as Record<string, unknown>[]) : [];

  const heights = [
    ...new Set(
      formats
        .map((format) => format.height)
        .filter((h): h is number => typeof h === "number" && h > 0),
    ),
  ].sort((a, b) => b - a);

  const info: MediaInfo = {
    title: typeof raw.title === "string" && raw.title ? raw.title : "sem titulo",
    heights,
    isLive: raw.is_live === true,
  };
  if (typeof raw.uploader === "string") info.uploader = raw.uploader;
  if (typeof raw.duration === "number") info.durationSeconds = raw.duration;
  if (typeof raw.thumbnail === "string") info.thumbnail = raw.thumbnail;
  return info;
}

export async function fetchMediaInfo(ytdlpPath: string, url: string): Promise<MediaInfo> {
  try {
    const { stdout } = await exec(
      ytdlpPath,
      ["-J", "--no-playlist", "--no-warnings", "--", url],
      { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 },
    );
    return parseMediaInfo(stdout);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new Error(stderr ? lastErrorLine(stderr) : (error as Error).message);
  }
}

// --------------------------------------------------------------------------- //
// comando

/**
 * Seletor de formato. 'bv*+ba/b' junta o melhor video com o melhor audio e cai
 * no melhor arquivo unico quando o site nao separa as trilhas.
 */
export function formatSelector(quality: DownloadQuality): string {
  if (quality === "audio") return "ba[ext=m4a]/ba/b";
  if (quality === "best") return "bv*+ba/b";
  return `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`;
}

export interface DownloadOptions {
  url: string;
  outputDir: string;
  quality: DownloadQuality;
  /** o yt-dlp precisa do ffmpeg para juntar video+audio e extrair audio */
  ffmpegPath?: string;
}

const PROGRESS_MARK = "VIPROG";
const PATH_MARK = "VIPATH";

export function buildDownloadArgs(options: DownloadOptions): string[] {
  const args = [
    "--no-playlist",
    "--newline",
    "--no-colors",
    "--quiet",
    "--progress",
    "--no-simulate",
    // prefere a maior resolucao e, dentro dela, h264/aac: abre em qualquer editor
    "-S", "res,vcodec:h264,acodec:m4a",
    "-f", formatSelector(options.quality),
    "-P", options.outputDir,
    "-o", "%(title).150B [%(id)s].%(ext)s",
    "--progress-template",
    `download:${PROGRESS_MARK}|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|` +
      `%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s`,
    "--print", `after_move:${PATH_MARK}|%(filepath)s`,
  ];

  if (options.quality === "audio") {
    // 'best' preserva o codec original em vez de recodificar
    args.push("-x", "--audio-format", "best");
  } else {
    args.push("--merge-output-format", "mp4");
  }

  if (options.ffmpegPath) args.push("--ffmpeg-location", dirname(options.ffmpegPath));

  // '--' evita que uma URL comecando com '-' seja lida como opcao
  args.push("--", options.url);
  return args;
}

// --------------------------------------------------------------------------- //
// saida

export interface DownloadProgress {
  /** 0..1 da trilha atual; null quando o tamanho e desconhecido */
  fraction: number | null;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  /** 'bv*+ba' baixa video e audio separados: e o id da trilha em andamento */
  formatId?: string;
}

function numberOrUndefined(text: string | undefined): number | undefined {
  if (text == null || text === "" || text === "NA" || text === "None") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function parseProgressLine(line: string): DownloadProgress | null {
  if (!line.startsWith(`${PROGRESS_MARK}|`)) return null;
  const [, downloaded, total, estimate, speed, eta, formatId] = line.trim().split("|");

  const downloadedBytes = numberOrUndefined(downloaded) ?? 0;
  const totalBytes = numberOrUndefined(total) ?? numberOrUndefined(estimate);

  const progress: DownloadProgress = {
    fraction:
      totalBytes && totalBytes > 0 ? Math.min(1, Math.max(0, downloadedBytes / totalBytes)) : null,
    downloadedBytes,
  };
  if (totalBytes !== undefined) progress.totalBytes = totalBytes;
  const speedValue = numberOrUndefined(speed);
  if (speedValue !== undefined) progress.speedBytesPerSec = speedValue;
  const etaValue = numberOrUndefined(eta);
  if (etaValue !== undefined) progress.etaSeconds = etaValue;
  if (formatId && formatId !== "NA") progress.formatId = formatId;
  return progress;
}

export function parsePathLine(line: string): string | null {
  const prefix = `${PATH_MARK}|`;
  return line.startsWith(prefix) ? line.slice(prefix.length).trim() || null : null;
}

// --------------------------------------------------------------------------- //
// execucao

export interface DownloadRunOptions extends DownloadOptions {
  ytdlpPath: string;
  onProgress?: (progress: DownloadProgress) => void;
  onLogLine?: (line: string) => void;
}

export interface DownloadResult {
  code: number | null;
  /** caminho final, depois de juntar as trilhas; null se nao chegou la */
  outputPath: string | null;
  stderr: string;
  canceled: boolean;
  elapsedSeconds: number;
}

export class DownloadRun {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private canceled = false;
  readonly promise: Promise<DownloadResult>;

  constructor(private readonly options: DownloadRunOptions) {
    this.promise = this.start();
  }

  /** SIGTERM: o yt-dlp deixa o .part no disco e retoma dali se baixarem de novo. */
  cancel(): void {
    if (this.child && !this.canceled) {
      this.canceled = true;
      this.child.kill("SIGTERM");
    }
  }

  private start(): Promise<DownloadResult> {
    const started = Date.now();

    return new Promise<DownloadResult>((resolve, reject) => {
      const child = spawn(this.options.ytdlpPath, buildDownloadArgs(this.options), {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      let stderr = "";
      let stdoutBuffer = "";
      let outputPath: string | null = null;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const progress = parseProgressLine(line);
          if (progress) {
            this.options.onProgress?.(progress);
            continue;
          }
          const path = parsePathLine(line);
          if (path) outputPath = path;
          else if (line.trim()) this.options.onLogLine?.(line.trimEnd());
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        if (this.options.onLogLine) {
          for (const line of chunk.split("\n")) {
            if (line.trim()) this.options.onLogLine(line.trimEnd());
          }
        }
        if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
      });

      child.on("error", (error) => reject(error));

      child.on("close", (code) => {
        resolve({
          code,
          outputPath,
          stderr,
          canceled: this.canceled,
          elapsedSeconds: (Date.now() - started) / 1000,
        });
      });
    });
  }
}

export function runDownload(options: DownloadRunOptions): DownloadRun {
  return new DownloadRun(options);
}
