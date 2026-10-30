/**
 * Download de videos via yt-dlp.
 *
 * O UniConverter embarca um fork privado do youtube-dl 2020 e o atualiza pelo
 * servidor dele (MediaDownloader.bundle), porque os sites mudam toda semana.
 * Nao repetimos isso: usamos o yt-dlp, que e mantido publicamente e roda como
 * binario separado -- o mesmo modelo do ffmpeg (ver binaries.ts). O usuario
 * instala, ou usa o que vem no app (que se atualiza sozinho, ver updates.ts).
 *
 * Este modulo e puro Node (sem Electron) para poder ser testado isoladamente.
 */

import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";

import { compareVersions } from "./updates";

const exec = promisify(execFile);

const SEARCH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"];

export interface YtDlpBinary {
  path: string;
  version: string;
}

/** "best", "audio" ou a altura maxima em pixels, como "1080" */
export type DownloadQuality = "best" | "audio" | `${number}`;

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

/**
 * Copia que viaja dentro do app (Contents/Resources/bin/yt-dlp). E o ultimo
 * recurso: quem ja tem yt-dlp proprio instalado (e, portanto, mantido) usa o dele.
 */
export function bundledYtDlpPath(resourcesPath: string | undefined): string | null {
  if (!resourcesPath) return null;
  const candidate = join(resourcesPath, "bin", "yt-dlp");
  return existsSync(candidate) ? candidate : null;
}

let cached: YtDlpBinary | null = null;
let managedDir: string | null = null;

/** Pasta onde o app guarda o yt-dlp que ele mesmo atualizou (userData/bin). */
export function setManagedYtDlpDir(dir: string | null): void {
  managedDir = dir;
}

export function managedYtDlpPath(): string | null {
  return managedDir ? join(managedDir, "yt-dlp") : null;
}

async function versionOf(path: string): Promise<string | null> {
  try {
    const { stdout } = await exec(path, ["--version"], { timeout: 30_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Escolhe o yt-dlp: VIDEOIMAGEM_YTDLP manda; senao vale o MAIS NOVO entre o
 * atualizado pelo app, o do PATH/Homebrew e o que veio no instalador. Assim um
 * yt-dlp velho esquecido no brew nao segura o app atras, e um app novo com
 * yt-dlp embutido mais recente tambem nao e ofuscado por uma copia antiga.
 */
export async function locateYtDlp(force = false): Promise<YtDlpBinary> {
  if (cached && !force) return cached;

  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const fromEnvPath = fromEnv();
  if (fromEnvPath) {
    cached = { path: fromEnvPath, version: (await versionOf(fromEnvPath)) ?? "desconhecida" };
    return cached;
  }

  const managed = managedYtDlpPath();
  const candidates = [
    managed && existsSync(managed) ? managed : null,
    await fromPath(),
    fromSearchDirs(),
    bundledYtDlpPath(resources),
  ].filter((p, i, all): p is string => p !== null && all.indexOf(p) === i);

  if (candidates.length === 0) {
    throw new Error(
      "nao encontrei o yt-dlp. Reinstale o app (ele vem junto), instale com " +
        "'brew install yt-dlp' ou aponte VIDEOIMAGEM_YTDLP para o binario.",
    );
  }

  let best: YtDlpBinary | null = null;
  for (const path of candidates) {
    const version = await versionOf(path);
    if (version === null) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { path, version };
  }
  // nenhum respondeu a --version: ainda assim tenta o primeiro (versao e so informativa)
  cached = best ?? { path: candidates[0]!, version: "desconhecida" };
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
  return typeof value === "string" && (value === "best" || value === "audio" || /^\d{3,4}$/.test(value));
}

// --------------------------------------------------------------------------- //
// informacoes do video

export interface VideoOption {
  height: number;
  /** tamanho estimado do arquivo final (video + melhor audio); ausente se o site nao informa */
  sizeBytes?: number;
}

export interface SubtitleOption {
  /** codigo para --sub-langs, ex. "pt" ou "pt-orig" */
  code: string;
  name: string;
  /** legenda gerada automaticamente, nao feita por pessoas */
  auto: boolean;
}

export interface MediaInfo {
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnail?: string;
  /** alturas de video disponiveis, da maior para a menor */
  heights: number[];
  /** o mesmo, com o tamanho estimado de cada uma */
  videoOptions: VideoOption[];
  audioSizeBytes?: number;
  audioBitrateKbps?: number;
  subtitles: SubtitleOption[];
  isLive: boolean;
}

/** A ultima linha "ERROR:" do stderr e o motivo real; o resto e ruido. */
export function lastErrorLine(stderr: string): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const error = [...lines].reverse().find((line) => line.startsWith("ERROR:"));
  return (error ?? lines[lines.length - 1] ?? "falha desconhecida").replace(/^ERROR:\s*/, "");
}

/**
 * Legendas feitas por pessoas, todas. Das automaticas so a do idioma original:
 * o YouTube lista uma traducao automatica para cada idioma do mundo, e uma
 * lista de 150 itens num seletor nao ajuda ninguem.
 */
function parseSubtitles(raw: Record<string, unknown>): SubtitleOption[] {
  const out: SubtitleOption[] = [];
  const nameOf = (entries: unknown, fallback: string): string => {
    const first = Array.isArray(entries) ? (entries[0] as Record<string, unknown> | undefined) : undefined;
    return typeof first?.name === "string" && first.name ? first.name : fallback;
  };

  const manual = raw.subtitles;
  if (manual && typeof manual === "object") {
    for (const [code, entries] of Object.entries(manual)) {
      if (code === "live_chat") continue;
      out.push({ code, name: nameOf(entries, code), auto: false });
    }
  }

  const auto = raw.automatic_captions;
  const language = typeof raw.language === "string" ? raw.language : null;
  if (auto && typeof auto === "object") {
    for (const [code, entries] of Object.entries(auto)) {
      const original = code.endsWith("-orig") || (language !== null && code === language);
      if (original && !out.some((entry) => entry.code === code || entry.code === language)) {
        out.push({ code, name: nameOf(entries, code), auto: true });
      }
    }
  }
  return out;
}

export function parseMediaInfo(json: string): MediaInfo {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const formats = Array.isArray(raw.formats) ? (raw.formats as Record<string, unknown>[]) : [];

  const sizeOf = (format: Record<string, unknown>): number | undefined => {
    const exact = format.filesize;
    const approx = format.filesize_approx;
    if (typeof exact === "number" && exact > 0) return exact;
    if (typeof approx === "number" && approx > 0) return approx;
    return undefined;
  };

  // melhor audio (so audio): maior bitrate. O arquivo final leva video + audio.
  let bestAudio: Record<string, unknown> | undefined;
  for (const format of formats) {
    if (format.vcodec !== "none" || format.acodec === "none") continue;
    const abr = typeof format.abr === "number" ? format.abr : 0;
    const bestAbr = typeof bestAudio?.abr === "number" ? bestAudio.abr : -1;
    if (abr > bestAbr) bestAudio = format;
  }
  const audioSizeBytes = bestAudio ? sizeOf(bestAudio) : undefined;

  // por altura, o maior arquivo de video; sem vcodec informado conta como video
  const biggestByHeight = new Map<number, number | undefined>();
  for (const format of formats) {
    const height = format.height;
    if (typeof height !== "number" || height <= 0 || format.vcodec === "none") continue;
    const size = sizeOf(format);
    const known = biggestByHeight.get(height);
    biggestByHeight.set(
      height,
      size === undefined ? known : Math.max(known ?? 0, size),
    );
  }

  const videoOptions: VideoOption[] = [...biggestByHeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, size]) => {
      const option: VideoOption = { height };
      if (size !== undefined) option.sizeBytes = size + (audioSizeBytes ?? 0);
      return option;
    });

  const info: MediaInfo = {
    title: typeof raw.title === "string" && raw.title ? raw.title : "sem titulo",
    heights: videoOptions.map((option) => option.height),
    videoOptions,
    subtitles: parseSubtitles(raw),
    isLive: raw.is_live === true,
  };
  if (audioSizeBytes !== undefined) info.audioSizeBytes = audioSizeBytes;
  if (typeof bestAudio?.abr === "number") info.audioBitrateKbps = Math.round(bestAudio.abr);
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
export function formatSelector(quality: DownloadQuality, audioFormat?: AudioFormat): string {
  // para MP3 parte-se da melhor fonte; para manter o original, prefere-se o m4a (aac)
  if (quality === "audio") return audioFormat === "mp3" ? "ba/b" : "ba[ext=m4a]/ba/b";
  if (quality === "best") return "bv*+ba/b";
  return `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`;
}

export type AudioFormat = "mp3" | "original";

const SUB_LANG = /^[A-Za-z0-9_.-]{1,24}$/;

export interface DownloadOptions {
  url: string;
  outputDir: string;
  quality: DownloadQuality;
  /** so vale quando quality === "audio" */
  audioFormat?: AudioFormat;
  /** baixar tambem a miniatura, como .jpg ao lado do video */
  thumbnail?: boolean;
  /** codigo da legenda (ver SubtitleOption.code); baixa como .srt ao lado do video */
  subtitleLang?: string | null;
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
    "-f", formatSelector(options.quality, options.audioFormat),
    "-P", options.outputDir,
    "-o", "%(title).150B [%(id)s].%(ext)s",
    "--progress-template",
    `download:${PROGRESS_MARK}|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|` +
      `%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s`,
    "--print", `after_move:${PATH_MARK}|%(filepath)s`,
  ];

  if (options.quality === "audio") {
    if (options.audioFormat === "mp3") {
      // qualidade 0 = a melhor do LAME (VBR ~245 kbps)
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      // 'best' preserva o codec original em vez de recodificar
      args.push("-x", "--audio-format", "best");
    }
  } else {
    args.push("--merge-output-format", "mp4");
  }

  if (options.thumbnail) args.push("--write-thumbnail", "--convert-thumbnails", "jpg");

  if (options.subtitleLang) {
    if (!SUB_LANG.test(options.subtitleLang)) throw new Error("idioma de legenda invalido");
    args.push(
      "--write-subs", "--write-auto-subs",
      "--sub-langs", options.subtitleLang,
      "--convert-subs", "srt",
    );
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
