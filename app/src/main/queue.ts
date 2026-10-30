/**
 * Fila de conversao.
 *
 * Mora no processo principal para ser a unica fonte de verdade: se o renderer
 * recarregar, a fila continua. Processa UM ffmpeg por vez de proposito -- o
 * ffmpeg ja usa todos os nucleos, rodar dois em paralelo so deixa os dois
 * lentos e disputa I/O.
 *
 * Cada item e resolvido contra os PROPRIOS metadados na hora de converter, nao
 * contra o arquivo que estava em foco na tela. E o que faz "igual a origem" e
 * o passthrough funcionarem numa fila de arquivos heterogeneos.
 */

import { basename, dirname, extname, join } from "node:path";
import { existsSync } from "node:fs";

import { buildCommand } from "../engine/command";
import type { PresetDatabase } from "../engine/data";
import { decidePassthrough } from "../engine/passthrough";
import { probeFile, type ProbeResult } from "../engine/probe";
import { resolvePreset, type UserChoices } from "../engine/resolver";
import { runConversion, type ConversionRun, type Progress } from "../engine/runner";

export type QueueStatus = "pending" | "running" | "done" | "failed" | "canceled";

export interface QueueItem {
  id: string;
  path: string;
  fileName: string;
  status: QueueStatus;
  probe?: ProbeResult;
  /** por que o ffprobe nao conseguiu ler o arquivo */
  probeError?: string;
  outputPath?: string;
  error?: string;
  progress?: Progress;
  elapsedSeconds?: number;
}

export interface BatchSettings {
  /** um preset; ou, sem preset ("Personalizado"), so o formato */
  profileId?: number | null;
  formatId?: number | null;
  overrides?: Partial<UserChoices>;
  preferHardware?: boolean;
  fitMode?: "fit" | "fill" | "stretch";
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

export interface QueueEvents {
  onItemChanged(item: QueueItem): void;
  onProgress(itemId: string, progress: Progress): void;
  onLog(itemId: string, line: string): void;
  onBatchDone(summary: BatchSummary): void;
}

export interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  canceled: number;
  elapsedSeconds: number;
}

export interface QueueContext {
  db: PresetDatabase;
  ffmpegPath: string;
  encoders: Set<string>;
}

let idCounter = 0;

export class ConversionQueue {
  private items: QueueItem[] = [];
  private activeRun: ConversionRun | null = null;
  private activeItemId: string | null = null;
  private running = false;
  /** cancelar a fila inteira: para o item atual e nao comeca os proximos */
  private stopRequested = false;

  constructor(
    private readonly context: QueueContext,
    private readonly events: QueueEvents,
  ) {}

  list(): QueueItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Adiciona arquivos, lendo os metadados de cada um. Ignora duplicatas. */
  async add(paths: string[]): Promise<QueueItem[]> {
    const added: QueueItem[] = [];

    for (const path of paths) {
      if (this.items.some((item) => item.path === path)) continue;

      idCounter += 1;
      const item: QueueItem = {
        id: `item-${idCounter}`,
        path,
        fileName: basename(path),
        status: "pending",
      };
      this.items.push(item);
      added.push(item);

      try {
        item.probe = await probeFile(path);
      } catch (error) {
        item.probeError = error instanceof Error ? error.message : String(error);
        item.status = "failed";
        item.error = "o ffprobe nao conseguiu ler este arquivo";
      }
      this.events.onItemChanged({ ...item });
    }

    return added.map((item) => ({ ...item }));
  }

  /** Remove um item. Se estiver convertendo, cancela antes. */
  remove(id: string): boolean {
    if (this.activeItemId === id) this.cancelItem(id);
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  /** Limpa a fila. Mantem o item em conversao, que precisa terminar primeiro. */
  clear(): void {
    this.items = this.items.filter((item) => item.id === this.activeItemId);
  }

  /** Tira da fila os que ja terminaram, deixando so o que falta. */
  clearFinished(): void {
    this.items = this.items.filter(
      (item) => item.status === "pending" || item.status === "running",
    );
  }

  cancelItem(id: string): boolean {
    if (this.activeItemId !== id || !this.activeRun) return false;
    this.activeRun.cancel();
    return true;
  }

  cancelAll(): void {
    this.stopRequested = true;
    this.activeRun?.cancel();
  }

  /**
   * Converte tudo que esta pendente, em sequencia. Chamar de novo enquanto
   * roda nao faz nada -- a fila ja esta trabalhando.
   */
  async start(settings: BatchSettings): Promise<BatchSummary> {
    if (this.running) {
      return { total: 0, done: 0, failed: 0, canceled: 0, elapsedSeconds: 0 };
    }

    this.running = true;
    this.stopRequested = false;
    const started = Date.now();
    const summary: BatchSummary = {
      total: 0,
      done: 0,
      failed: 0,
      canceled: 0,
      elapsedSeconds: 0,
    };

    try {
      for (;;) {
        const next = this.items.find((item) => item.status === "pending");
        if (!next || this.stopRequested) break;

        summary.total += 1;
        const outcome = await this.convertOne(next, settings);
        summary[outcome] += 1;
      }

      // o que sobrou pendente por causa de um cancelamento geral vira cancelado
      if (this.stopRequested) {
        for (const item of this.items) {
          if (item.status === "pending") {
            item.status = "canceled";
            item.error = "cancelado antes de comecar";
            summary.total += 1;
            summary.canceled += 1;
            this.events.onItemChanged({ ...item });
          }
        }
      }
    } finally {
      this.running = false;
      this.activeRun = null;
      this.activeItemId = null;
      summary.elapsedSeconds = (Date.now() - started) / 1000;
      this.events.onBatchDone(summary);
    }

    return summary;
  }

  private async convertOne(
    item: QueueItem,
    settings: BatchSettings,
  ): Promise<"done" | "failed" | "canceled"> {
    item.status = "running";
    item.error = undefined as string | undefined;
    item.progress = undefined as Progress | undefined;
    this.activeItemId = item.id;
    this.events.onItemChanged({ ...item });

    const { db, ffmpegPath, encoders } = this.context;

    let outputPath: string;
    let args: string[];

    try {
      // cada item usa os proprios metadados: duas entradas com resolucoes
      // diferentes tem de resolver diferente
      const source = item.probe;
      const resolved = resolvePreset(db, {
        ...(settings.profileId != null
          ? { profileId: settings.profileId }
          : settings.formatId != null
            ? { formatId: settings.formatId }
            : {}),
        overrides: settings.overrides ?? {},
        ...(source ? { source } : {}),
      });

      const passthrough =
        settings.allowPassthrough === false
          ? undefined
          : decidePassthrough(db.passthrough, resolved.container, resolved.choices, source);

      outputPath = buildOutputPath(item.path, resolved.container, settings.outputDir);

      const built = buildCommand(db.codecMap, resolved, {
        inputPath: item.path,
        outputPath,
        preferHardware: settings.preferHardware === true,
        fitMode: settings.fitMode ?? "fit",
        ...(passthrough ? { passthrough } : {}),
        ...(source ? { source } : {}),
        availableEncoders: encoders,
      });
      args = built.args;
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
      this.activeItemId = null;
      this.events.onItemChanged({ ...item });
      return "failed";
    }

    item.outputPath = outputPath;

    const run = runConversion({
      ffmpegPath,
      args,
      ...(item.probe?.durationSeconds ? { durationSeconds: item.probe.durationSeconds } : {}),
      onProgress: (progress) => {
        item.progress = progress;
        this.events.onProgress(item.id, progress);
      },
      onLogLine: (line) => this.events.onLog(item.id, line),
    });
    this.activeRun = run;

    let outcome: "done" | "failed" | "canceled";
    try {
      const result = await run.promise;
      item.elapsedSeconds = result.elapsedSeconds;

      if (result.canceled) {
        item.status = "canceled";
        item.error = "cancelado";
        outcome = "canceled";
      } else if (result.code === 0) {
        item.status = "done";
        outcome = "done";
      } else {
        item.status = "failed";
        item.error = lastErrorLines(result.stderr);
        outcome = "failed";
      }
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
      outcome = "failed";
    } finally {
      this.activeRun = null;
      this.activeItemId = null;
    }

    this.events.onItemChanged({ ...item });
    return outcome;
  }
}

/** Nome de saida sem sobrescrever nada que ja exista. */
export function buildOutputPath(
  inputPath: string,
  container: string,
  outputDir?: string | null,
): string {
  const dir = outputDir || dirname(inputPath);
  const stem = basename(inputPath, extname(inputPath));

  let candidate = join(dir, `${stem}-videoimagem${container}`);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-videoimagem-${counter}${container}`);
    counter += 1;
  }
  return candidate;
}

/** O erro do ffmpeg costuma estar nas ultimas linhas uteis do stderr. */
export function lastErrorLines(stderr: string, count = 6): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(-count).join("\n");
}
