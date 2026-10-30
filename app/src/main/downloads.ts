/**
 * Fila de downloads.
 *
 * Mesmo desenho da ConversionQueue: mora no processo principal, nao importa
 * nada do Electron (por isso e testavel) e emite eventos em vez de conhecer a
 * janela. Diferente da conversao, download e limitado por rede e nao por CPU,
 * entao rodam ate `concurrency` ao mesmo tempo.
 */

import {
  fetchMediaInfo,
  type AudioFormat,
  lastErrorLine,
  normalizeUrl,
  runDownload,
  type DownloadProgress,
  type DownloadQuality,
  type DownloadRun,
  type MediaInfo,
} from "../engine/ytdlp";

export type DownloadStatus = "pending" | "analyzing" | "running" | "done" | "failed" | "canceled";

export interface DownloadItem {
  id: string;
  url: string;
  quality: DownloadQuality;
  outputDir: string;
  audioFormat?: AudioFormat;
  thumbnail: boolean;
  subtitleLang: string | null;
  /** o titulo real so e conhecido depois da analise */
  title?: string;
  info?: MediaInfo;
  status: DownloadStatus;
  outputPath?: string;
  error?: string;
  progress?: DownloadProgress;
  /** mandar o arquivo para a fila de conversao quando terminar */
  addToConversionQueue: boolean;
  elapsedSeconds?: number;
}

export interface DownloadEvents {
  onItemChanged(item: DownloadItem): void;
  onProgress(itemId: string, progress: DownloadProgress): void;
  onLog(itemId: string, line: string): void;
  /** chamado uma vez por download concluido, com o arquivo final */
  onItemDone(item: DownloadItem): void;
}

export interface DownloadContext {
  ytdlpPath: string;
  ffmpegPath?: string;
  concurrency?: number;
}

export interface AddDownloadRequest {
  url: string;
  quality: DownloadQuality;
  outputDir: string;
  addToConversionQueue?: boolean;
  audioFormat?: AudioFormat;
  thumbnail?: boolean;
  subtitleLang?: string | null;
  /** analise ja feita pela interface; evita analisar o mesmo link duas vezes */
  info?: MediaInfo;
}

let idCounter = 0;

export class DownloadManager {
  private items: DownloadItem[] = [];
  private runs = new Map<string, DownloadRun>();
  /** itens cancelados durante a analise, que ainda nao tem processo para matar */
  private canceledIds = new Set<string>();

  constructor(
    private readonly context: DownloadContext,
    private readonly events: DownloadEvents,
  ) {}

  list(): DownloadItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  /** Valida a URL e enfileira. Lanca se a URL for invalida. */
  add(request: AddDownloadRequest): DownloadItem {
    const url = normalizeUrl(request.url);

    // clicar duas vezes em "Baixar" nao deve baixar duas vezes
    const duplicate = this.items.find(
      (item) =>
        item.url === url &&
        item.quality === request.quality &&
        (item.status === "pending" || item.status === "analyzing" || item.status === "running"),
    );
    if (duplicate) return { ...duplicate };

    idCounter += 1;
    const item: DownloadItem = {
      id: `dl-${idCounter}`,
      url,
      quality: request.quality,
      outputDir: request.outputDir,
      status: "pending",
      addToConversionQueue: request.addToConversionQueue === true,
      thumbnail: request.thumbnail === true,
      subtitleLang: request.subtitleLang ?? null,
      ...(request.audioFormat ? { audioFormat: request.audioFormat } : {}),
      ...(request.info ? { info: request.info, title: request.info.title } : {}),
    };
    this.items.push(item);
    this.events.onItemChanged({ ...item });
    this.pump();
    return { ...item };
  }

  cancelItem(id: string): boolean {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) return false;

    if (item.status === "pending") {
      this.finish(item, "canceled");
      return true;
    }
    if (item.status === "analyzing") {
      this.canceledIds.add(id);
      return true;
    }
    const run = this.runs.get(id);
    if (item.status === "running" && run) {
      run.cancel();
      return true;
    }
    return false;
  }

  cancelAll(): void {
    for (const item of [...this.items]) this.cancelItem(item.id);
  }

  remove(id: string): boolean {
    this.cancelItem(id);
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  clearFinished(): void {
    this.items = this.items.filter(
      (item) =>
        item.status === "pending" || item.status === "analyzing" || item.status === "running",
    );
  }

  // ------------------------------------------------------------------------- //

  private activeCount(): number {
    return this.items.filter((item) => item.status === "analyzing" || item.status === "running")
      .length;
  }

  /** Comeca quantos itens pendentes couberem no limite de paralelismo. */
  private pump(): void {
    const limit = this.context.concurrency ?? 2;
    for (const item of this.items) {
      if (this.activeCount() >= limit) return;
      if (item.status === "pending") void this.process(item);
    }
  }

  private change(item: DownloadItem, patch: Partial<DownloadItem>): void {
    Object.assign(item, patch);
    this.events.onItemChanged({ ...item });
  }

  private finish(item: DownloadItem, status: "done" | "failed" | "canceled", extra = {}): void {
    this.canceledIds.delete(item.id);
    this.runs.delete(item.id);
    this.change(item, { status, ...extra });
    if (status === "done") this.events.onItemDone({ ...item });
    this.pump();
  }

  private async process(item: DownloadItem): Promise<void> {
    // 1) analisar: valida a URL de verdade e descobre o titulo antes de baixar
    this.change(item, { status: "analyzing" });
    let info: MediaInfo;
    if (item.info) {
      info = item.info;
    } else {
      try {
        info = await fetchMediaInfo(this.context.ytdlpPath, item.url);
      } catch (error) {
        this.finish(item, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    if (this.canceledIds.has(item.id)) {
      this.finish(item, "canceled");
      return;
    }
    if (info.isLive) {
      this.finish(item, "failed", { error: "transmissao ao vivo nao e suportada" });
      return;
    }

    // 2) baixar
    this.change(item, { status: "running", title: info.title, info });
    const run = runDownload({
      ytdlpPath: this.context.ytdlpPath,
      url: item.url,
      outputDir: item.outputDir,
      quality: item.quality,
      thumbnail: item.thumbnail,
      subtitleLang: item.subtitleLang,
      ...(item.audioFormat ? { audioFormat: item.audioFormat } : {}),
      ...(this.context.ffmpegPath ? { ffmpegPath: this.context.ffmpegPath } : {}),
      onProgress: (progress) => {
        item.progress = progress;
        this.events.onProgress(item.id, progress);
      },
      onLogLine: (line) => this.events.onLog(item.id, line),
    });
    this.runs.set(item.id, run);

    try {
      const result = await run.promise;
      if (result.canceled) {
        this.finish(item, "canceled", { elapsedSeconds: result.elapsedSeconds });
      } else if (result.code === 0 && result.outputPath) {
        this.finish(item, "done", {
          outputPath: result.outputPath,
          elapsedSeconds: result.elapsedSeconds,
        });
      } else {
        const reason =
          result.code === 0
            ? "o yt-dlp terminou sem informar o arquivo gerado"
            : lastErrorLine(result.stderr);
        this.finish(item, "failed", { error: reason, elapsedSeconds: result.elapsedSeconds });
      }
    } catch (error) {
      this.finish(item, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
