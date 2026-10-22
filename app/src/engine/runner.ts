/**
 * Executa o ffmpeg e reporta progresso.
 *
 * O progresso vem de `-progress pipe:1`, que escreve pares key=value em stdout.
 * E muito mais estavel que fazer regex no stderr, que muda entre versoes.
 * O stderr fica guardado para poder mostrar o erro real quando falha.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface Progress {
  /** 0..1; null quando a duracao e desconhecida */
  fraction: number | null;
  outTimeSeconds: number;
  frame?: number;
  fps?: number;
  /** "1.02x" */
  speed?: string;
  bitrateKbps?: number;
  totalSizeBytes?: number;
  etaSeconds?: number | null;
}

export interface RunOptions {
  ffmpegPath: string;
  args: string[];
  /** duracao da origem, para transformar out_time em porcentagem */
  durationSeconds?: number;
  onProgress?: (progress: Progress) => void;
  onLogLine?: (line: string) => void;
}

export interface RunResult {
  code: number | null;
  /** o stderr completo; e onde o ffmpeg explica o que deu errado */
  stderr: string;
  canceled: boolean;
  elapsedSeconds: number;
}

export class ConversionRun {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private canceled = false;
  readonly promise: Promise<RunResult>;

  constructor(private readonly options: RunOptions) {
    this.promise = this.start();
  }

  /** Pede para o ffmpeg terminar. SIGTERM deixa ele fechar o arquivo. */
  cancel(): void {
    if (this.child && !this.canceled) {
      this.canceled = true;
      this.child.kill("SIGTERM");
    }
  }

  private start(): Promise<RunResult> {
    const started = Date.now();

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(this.options.ffmpegPath, this.options.args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;

      let stderr = "";
      let stdoutBuffer = "";
      const fields = new Map<string, string>();

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const separator = line.indexOf("=");
          if (separator <= 0) continue;
          const key = line.slice(0, separator).trim();
          const value = line.slice(separator + 1).trim();
          fields.set(key, value);

          // 'progress' fecha cada bloco de atualizacao
          if (key === "progress") {
            this.emit(fields, started);
            if (value === "end") fields.clear();
          }
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
        // o stderr do ffmpeg pode crescer muito em arquivo problematico
        if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
      });

      child.on("error", (error) => reject(error));

      child.on("close", (code) => {
        resolve({
          code,
          stderr,
          canceled: this.canceled,
          elapsedSeconds: (Date.now() - started) / 1000,
        });
      });
    });
  }

  private emit(fields: Map<string, string>, startedAt: number): void {
    if (!this.options.onProgress) return;

    const outTimeSeconds = readOutTime(fields);
    const duration = this.options.durationSeconds;
    const fraction =
      duration && duration > 0 ? Math.min(1, Math.max(0, outTimeSeconds / duration)) : null;

    const elapsed = (Date.now() - startedAt) / 1000;
    let etaSeconds: number | null = null;
    if (fraction != null && fraction > 0.01 && fraction < 1) {
      etaSeconds = Math.round(elapsed / fraction - elapsed);
    }

    const progress: Progress = { fraction, outTimeSeconds, etaSeconds };

    const frame = Number(fields.get("frame"));
    if (Number.isFinite(frame)) progress.frame = frame;

    const fps = Number(fields.get("fps"));
    if (Number.isFinite(fps) && fps > 0) progress.fps = fps;

    const speed = fields.get("speed");
    if (speed && speed !== "N/A") progress.speed = speed;

    // "2000.1kbits/s"
    const bitrate = fields.get("bitrate");
    if (bitrate && bitrate !== "N/A") {
      const parsed = Number.parseFloat(bitrate);
      if (Number.isFinite(parsed)) progress.bitrateKbps = Math.round(parsed);
    }

    const totalSize = Number(fields.get("total_size"));
    if (Number.isFinite(totalSize) && totalSize > 0) progress.totalSizeBytes = totalSize;

    this.options.onProgress(progress);
  }
}

/**
 * out_time_us esta em microssegundos. Atencao: out_time_ms do ffmpeg tambem
 * esta em MICROssegundos, apesar do nome -- bug historico que nunca corrigiram.
 * Por isso preferimos out_time_us e caimos em out_time (hh:mm:ss.ffffff).
 */
function readOutTime(fields: Map<string, string>): number {
  const micros = Number(fields.get("out_time_us"));
  if (Number.isFinite(micros) && micros >= 0) return micros / 1_000_000;

  const legacy = Number(fields.get("out_time_ms"));
  if (Number.isFinite(legacy) && legacy >= 0) return legacy / 1_000_000;

  const formatted = fields.get("out_time");
  if (formatted) {
    const parts = formatted.split(":").map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    }
  }
  return 0;
}

export function runConversion(options: RunOptions): ConversionRun {
  return new ConversionRun(options);
}
