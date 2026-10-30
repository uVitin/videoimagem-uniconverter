/** Handlers de IPC: tudo que o renderer pode pedir ao processo principal. */

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { basename, join } from "node:path";

import { availableEncoders, resolveBinaries, type Binaries } from "../engine/binaries";
import { buildCommand, commandToString } from "../engine/command";
import { linkProfile, type PresetDatabase } from "../engine/data";
import { decidePassthrough } from "../engine/passthrough";
import type { ProbeResult } from "../engine/probe";
import { resolvePreset, type UserChoices } from "../engine/resolver";
import { checkAppUpdate, isAppReleaseUrl, updateYtDlp } from "../engine/updates";
import {
  fetchMediaInfo,
  isDownloadQuality,
  locateYtDlp,
  managedYtDlpPath,
  normalizeUrl,
  setManagedYtDlpDir,
  type MediaInfo,
} from "../engine/ytdlp";
import { DownloadManager, type DownloadItem } from "./downloads";
import { ConversionQueue, buildOutputPath, type QueueItem } from "./queue";
import { readPreferences, writePreferences } from "./preferences";
import type {
  AppUpdateInfo,
  BatchSettingsPayload,
  BatchSummary,
  ChoiceOptions,
  DownloadRequestPayload,
  EnvironmentInfo,
  FormatGroup,
  FormatListItem,
  Option,
  Preferences,
  PresetGroup,
  PresetListItem,
  ResolveRequestPayload,
  ResolveResponse,
  UiDownloadItem,
  UiMediaInfo,
  UiQueueItem,
  UiSourceInfo,
  YtDlpInfo,
  YtDlpUpdateInfo,
} from "./ipc-types";

/**
 * Ordem de exibicao das categorias: o que o usuario mais usa primeiro.
 * 7 Video · 1 Devices · 9 Web Sharing · 4 HD &3D · 5 Editing · 8 Audio · 10 Image
 */
const CATEGORY_ORDER = [7, 1, 9, 4, 5, 8, 10, 200];

/**
 * Formatos que existem no Format.pro do UniConverter mas que o ffmpeg nao grava
 * (documentos e vetores, ou containers sem muxer): oferecer seria prometer uma
 * conversao que sempre falha.
 */
const UNSUPPORTED_EXTENSIONS = new Set([
  ".pdf", ".psd", ".svg", ".eps", ".xpm", ".heic", ".swf", ".amv", ".ape",
]);

const MEDIA_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "avi", "wmv", "flv", "webm", "mpg", "mpeg",
  "ts", "m2ts", "mts", "vob", "3gp", "3g2", "ogv", "asf", "mxf", "dv", "f4v",
  "mp3", "aac", "m4a", "wav", "flac", "ogg", "wma", "ac3", "aiff", "ape", "caf",
];

export interface IpcContext {
  db: PresetDatabase;
  window: BrowserWindow;
}

let binaries: Binaries | null = null;
let encoders = new Set<string>();
let queue: ConversionQueue | null = null;
let downloads: DownloadManager | null = null;

// --------------------------------------------------------------------------- //
// conversoes de formato para a UI

function numberOptions(values: number[] | undefined, suffix = ""): Option<number>[] {
  return (values ?? []).map((value) => ({ value, label: `${value}${suffix}` }));
}

function encoderOptions(
  db: PresetDatabase,
  fourccs: string[] | undefined,
  kind: "video" | "audio",
): Option<string>[] {
  return (fourccs ?? []).map((fourcc) => {
    const entry = kind === "video" ? db.codecMap.video[fourcc] : db.codecMap.audio[fourcc];
    const encoder = entry?.encoder ?? "nao suportado";
    const flag = entry?.confidence === "low" ? " ⚠" : "";
    return { value: fourcc, label: `${fourcc} — ${encoder}${flag}` };
  });
}

function resolutionOptions(values: string[] | undefined): Option<string>[] {
  return (values ?? []).map((value) => {
    const [w, h] = value.split("*");
    return { value, label: `${w} × ${h}` };
  });
}

function toUiSource(probe: ProbeResult): UiSourceInfo {
  return { ...probe, fileName: basename(probe.path) };
}

function toUiItem(item: QueueItem): UiQueueItem {
  return {
    id: item.id,
    path: item.path,
    fileName: item.fileName,
    status: item.status,
    source: item.probe ? toUiSource(item.probe) : null,
    ...(item.probeError ? { probeError: item.probeError } : {}),
    ...(item.outputPath ? { outputPath: item.outputPath } : {}),
    ...(item.error ? { error: item.error } : {}),
    ...(item.elapsedSeconds != null ? { elapsedSeconds: item.elapsedSeconds } : {}),
    progress: item.progress ?? null,
  };
}

/** Analises recentes: a janela de opcoes analisa e o 'Baixar' reaproveita. */
const ANALYSIS_TTL_MS = 10 * 60 * 1000;
const analyses = new Map<string, { info: MediaInfo; at: number }>();

function cachedAnalysis(url: string): MediaInfo | undefined {
  const hit = analyses.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ANALYSIS_TTL_MS) {
    analyses.delete(url);
    return undefined;
  }
  return hit.info;
}

function toUiMediaInfo(url: string, info: MediaInfo): UiMediaInfo {
  return {
    url,
    title: info.title,
    videoOptions: info.videoOptions,
    subtitles: info.subtitles,
    isLive: info.isLive,
    ...(info.uploader ? { uploader: info.uploader } : {}),
    ...(info.durationSeconds != null ? { durationSeconds: info.durationSeconds } : {}),
    ...(info.thumbnail ? { thumbnail: info.thumbnail } : {}),
    ...(info.audioSizeBytes != null ? { audioSizeBytes: info.audioSizeBytes } : {}),
    ...(info.audioBitrateKbps != null ? { audioBitrateKbps: info.audioBitrateKbps } : {}),
  };
}

function toUiDownload(item: DownloadItem): UiDownloadItem {
  return {
    id: item.id,
    url: item.url,
    title: item.title ?? null,
    quality: item.quality,
    status: item.status,
    ...(item.outputPath ? { outputPath: item.outputPath } : {}),
    ...(item.error ? { error: item.error } : {}),
    ...(item.elapsedSeconds != null ? { elapsedSeconds: item.elapsedSeconds } : {}),
    progress: item.progress ?? null,
  };
}

function buildFormatGroups(db: PresetDatabase): FormatGroup[] {
  const categoryTitles = new Map(db.categories.map((c) => [c.id, c.title]));

  const presetCounts = new Map<number, number>();
  for (const profile of db.profiles) {
    const formatId = linkProfile(db, profile).format?.id;
    if (formatId != null) presetCounts.set(formatId, (presetCounts.get(formatId) ?? 0) + 1);
  }

  const buckets = new Map<number, FormatListItem[]>();
  for (const format of db.formats) {
    if (UNSUPPORTED_EXTENSIONS.has(format.extension.toLowerCase())) continue;
    const item: FormatListItem = {
      formatId: format.id,
      title: format.title,
      extension: format.extension,
      categoryId: format.category_id,
      categoryTitle: categoryTitles.get(format.category_id) ?? `Categoria ${format.category_id}`,
      presetCount: presetCounts.get(format.id) ?? 0,
    };
    const bucket = buckets.get(format.category_id);
    if (bucket) bucket.push(item);
    else buckets.set(format.category_id, [item]);
  }

  return [...buckets.entries()]
    .map(([categoryId, items]) => ({
      categoryId,
      categoryTitle: categoryTitles.get(categoryId) ?? `Categoria ${categoryId}`,
      items: items.sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
    }))
    .sort((a, b) => {
      const rankA = CATEGORY_ORDER.indexOf(a.categoryId);
      const rankB = CATEGORY_ORDER.indexOf(b.categoryId);
      return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB);
    });
}

function buildPresetGroups(db: PresetDatabase): PresetGroup[] {
  const categoryTitles = new Map(db.categories.map((c) => [c.id, c.title]));
  const buckets = new Map<number, PresetListItem[]>();

  for (const profile of db.profiles) {
    const link = linkProfile(db, profile);
    // sem formato ligado sao todos presets de dispositivo (ver linkProfile)
    const categoryId = link.format?.category_id ?? 1;

    const item: PresetListItem = {
      profileId: profile.id,
      formatId: link.format?.id ?? null,
      title: profile.title,
      container: link.container,
      videoEncoder: profile.video_encoder ?? null,
      audioEncoder: profile.audio_encoder ?? null,
      resolutionLabel: profile.resolution
        ? `${profile.resolution.width}×${profile.resolution.height}`
        : null,
      linkPath: link.path,
    };

    const bucket = buckets.get(categoryId);
    if (bucket) bucket.push(item);
    else buckets.set(categoryId, [item]);
  }

  return [...buckets.entries()]
    .map(([categoryId, items]) => ({
      categoryId,
      categoryTitle: categoryTitles.get(categoryId) ?? `Categoria ${categoryId}`,
      items: items.sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
    }))
    .sort((a, b) => {
      const rankA = CATEGORY_ORDER.indexOf(a.categoryId);
      const rankB = CATEGORY_ORDER.indexOf(b.categoryId);
      if (rankA !== rankB) {
        return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB);
      }
      return a.categoryTitle.localeCompare(b.categoryTitle, "pt-BR");
    });
}

/** Aceita a forma parcial que vem da UI, descartando chaves indefinidas. */
function toEngineOverrides(overrides: Partial<UserChoices> | undefined): Partial<UserChoices> {
  if (!overrides) return {};
  const out: Partial<UserChoices> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

// --------------------------------------------------------------------------- //

function handleResolve(
  db: PresetDatabase,
  payload: ResolveRequestPayload,
  outputDir: string | null,
): ResolveResponse {
  const item = payload.itemId
    ? queue?.list().find((entry) => entry.id === payload.itemId)
    : undefined;
  const source: ProbeResult | undefined = item?.probe;

  if (payload.profileId == null && payload.formatId == null) {
    throw new Error("escolha um formato");
  }

  const resolved = resolvePreset(db, {
    ...(payload.profileId != null
      ? { profileId: payload.profileId }
      : { formatId: payload.formatId as number }),
    overrides: toEngineOverrides(payload.overrides),
    ...(source ? { source } : {}),
  });

  const passthrough =
    payload.allowPassthrough === false
      ? null
      : decidePassthrough(db.passthrough, resolved.container, resolved.choices, source);

  const inputPath = item?.path ?? "/caminho/do/arquivo-de-entrada";
  const outputPath = item
    ? buildOutputPath(item.path, resolved.container, outputDir)
    : `/caminho/da/saida${resolved.container}`;

  const built = buildCommand(db.codecMap, resolved, {
    inputPath,
    outputPath,
    preferHardware: payload.preferHardware === true,
    fitMode: payload.fitMode ?? "fit",
    ...(passthrough ? { passthrough } : {}),
    ...(source ? { source } : {}),
    availableEncoders: encoders,
  });

  const options: ChoiceOptions = {
    videoEncoders: encoderOptions(db, resolved.constraints.video_encoders?.allowed, "video"),
    audioEncoders: encoderOptions(db, resolved.constraints.audio_encoders?.allowed, "audio"),
    resolutions: resolutionOptions(resolved.constraints.resolution?.allowed),
    frameRates: numberOptions(resolved.constraints.frame_rate?.allowed, " fps"),
    videoBitrates: numberOptions(resolved.constraints.video_bitrate_kbps?.allowed, " kbps"),
    audioBitrates: numberOptions(resolved.constraints.audio_bitrate_kbps?.allowed, " kbps"),
    sampleRates: numberOptions(resolved.constraints.sample_rate_hz?.allowed, " Hz"),
    channels: numberOptions(resolved.constraints.channels?.allowed),
  };

  return {
    profileTitle: resolved.profile?.title ?? null,
    formatTitle: resolved.format?.title ?? null,
    container: resolved.container,
    linkPath: resolved.linkPath,
    choices: resolved.choices,
    options,
    notes: resolved.notes,
    passthrough,
    appliedLimitCount: resolved.appliedLimits.length,
    commandPreview: commandToString(binaries?.ffmpeg ?? "ffmpeg", built.args),
    warnings: built.warnings,
    outputPath,
  };
}

// --------------------------------------------------------------------------- //

export function registerIpc({ db, window }: IpcContext): void {
  const send = (channel: string, payload: unknown): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  // yt-dlp atualizado pelo proprio app fica em userData/bin (o do instalador nao se mexe)
  setManagedYtDlpDir(join(app.getPath("userData"), "bin"));

  async function refreshYtDlp(): Promise<YtDlpUpdateInfo> {
    const target = managedYtDlpPath();
    if (!target) throw new Error("pasta de atualizacao indisponivel");
    const current = (await locateYtDlp()).version;
    const result = await updateYtDlp(current, target);
    if (result.updated) await locateYtDlp(true);
    return result;
  }

  async function ensureQueue(): Promise<ConversionQueue> {
    if (queue) return queue;
    const active = await resolveBinaries();
    binaries = active;
    if (encoders.size === 0) encoders = await availableEncoders(active.ffmpeg);

    queue = new ConversionQueue(
      { db, ffmpegPath: active.ffmpeg, encoders },
      {
        onItemChanged: (item) => send("queue:item", toUiItem(item)),
        onProgress: (itemId, progress) => send("queue:progress", { itemId, progress }),
        onLog: (itemId, line) => send("queue:log", { itemId, line }),
        onBatchDone: (summary: BatchSummary) => send("queue:batch-done", summary),
      },
    );
    return queue;
  }

  async function ensureDownloads(): Promise<DownloadManager> {
    if (downloads) return downloads;
    const ytdlp = await locateYtDlp(); // lanca com a dica de instalacao se faltar
    let ffmpegPath: string | undefined;
    try {
      ffmpegPath = (binaries ?? (await resolveBinaries())).ffmpeg;
    } catch {
      // sem ffmpeg o yt-dlp ainda baixa arquivos que ja vem juntos
    }

    downloads = new DownloadManager(
      { ytdlpPath: ytdlp.path, ...(ffmpegPath ? { ffmpegPath } : {}) },
      {
        onItemChanged: (item) => send("download:item", toUiDownload(item)),
        onProgress: (itemId, progress) => send("download:progress", { itemId, progress }),
        onLog: (itemId, line) => send("download:log", { itemId, line }),
        onItemDone: (item) => {
          if (!item.addToConversionQueue || !item.outputPath) return;
          const path = item.outputPath;
          void ensureQueue()
            .then((active) => active.add([path]))
            .then(() => send("queue:refresh", null))
            .catch(() => {
              // o arquivo ja foi baixado; so nao entrou na fila -- o usuario adiciona na mao
            });
        },
      },
    );
    return downloads;
  }

  // --- ambiente e preferencias ---------------------------------------------

  ipcMain.handle("ytdlp:info", async (): Promise<YtDlpInfo> => {
    try {
      const found = await locateYtDlp();
      return { available: true, path: found.path, version: found.version };
    } catch (error) {
      return {
        available: false,
        hint: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("ytdlp:update", (): Promise<YtDlpUpdateInfo> => refreshYtDlp());

  ipcMain.handle("update:check", async (): Promise<AppUpdateInfo> => {
    const current = app.getVersion();
    try {
      const status = await checkAppUpdate(current);
      return { ...status };
    } catch (error) {
      return {
        available: false,
        current,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("update:open", async (_event, url: string): Promise<void> => {
    if (typeof url === "string" && isAppReleaseUrl(url)) await shell.openExternal(url);
  });

  // em segundo plano, sem incomodar: yt-dlp velho e a causa mais comum de "parou de baixar"
  setTimeout(() => {
    refreshYtDlp()
      .then((result) => {
        if (result.updated) send("ytdlp:updated", result);
      })
      .catch(() => {
        // sem internet ou GitHub fora do ar: segue com o yt-dlp que ja tem
      });
  }, 5000);

  ipcMain.handle("env:info", async (): Promise<EnvironmentInfo> => {
    const active = await resolveBinaries();
    binaries = active;
    if (encoders.size === 0) encoders = await availableEncoders(active.ffmpeg);
    return {
      appVersion: app.getVersion(),
      ffmpeg: active.ffmpeg,
      ffprobe: active.ffprobe,
      version: active.version,
      dataDir: db.dataDir,
      encoderCount: encoders.size,
      hasVideoToolbox: encoders.has("h264_videotoolbox"),
    };
  });

  ipcMain.handle("prefs:read", (): Preferences => readPreferences());
  ipcMain.handle("prefs:write", (_event, patch: Partial<Preferences>): Preferences =>
    writePreferences(patch),
  );

  // --- presets --------------------------------------------------------------

  ipcMain.handle("presets:list", (): PresetGroup[] => buildPresetGroups(db));
  ipcMain.handle("formats:list", (): FormatGroup[] => buildFormatGroups(db));

  ipcMain.handle("preset:resolve", (_event, payload: ResolveRequestPayload): ResolveResponse =>
    handleResolve(db, payload, payload.outputDir ?? null),
  );

  // --- fila -----------------------------------------------------------------

  ipcMain.handle("queue:list", async (): Promise<UiQueueItem[]> => {
    const active = await ensureQueue();
    return active.list().map(toUiItem);
  });

  ipcMain.handle("queue:add-paths", async (_event, paths: string[]): Promise<UiQueueItem[]> => {
    const active = await ensureQueue();
    await active.add(paths);
    return active.list().map(toUiItem);
  });

  ipcMain.handle("queue:add-dialog", async (): Promise<UiQueueItem[]> => {
    const active = await ensureQueue();
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"],
      title: "Escolha os arquivos",
      filters: [
        { name: "Mídia", extensions: MEDIA_EXTENSIONS },
        { name: "Todos os arquivos", extensions: ["*"] },
      ],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      await active.add(result.filePaths);
    }
    return active.list().map(toUiItem);
  });

  ipcMain.handle("queue:remove", async (_event, id: string): Promise<UiQueueItem[]> => {
    const active = await ensureQueue();
    active.remove(id);
    return active.list().map(toUiItem);
  });

  ipcMain.handle("queue:clear", async (): Promise<UiQueueItem[]> => {
    const active = await ensureQueue();
    active.clear();
    return active.list().map(toUiItem);
  });

  ipcMain.handle("queue:clear-finished", async (): Promise<UiQueueItem[]> => {
    const active = await ensureQueue();
    active.clearFinished();
    return active.list().map(toUiItem);
  });

  ipcMain.handle("queue:start", async (_event, settings: BatchSettingsPayload): Promise<void> => {
    const active = await ensureQueue();
    // nao esperamos: o progresso chega pelos eventos
    void active.start({
      ...(settings.profileId != null ? { profileId: settings.profileId } : {}),
      ...(settings.formatId != null ? { formatId: settings.formatId } : {}),
      overrides: toEngineOverrides(settings.overrides),
      preferHardware: settings.preferHardware === true,
      fitMode: settings.fitMode ?? "fit",
      allowPassthrough: settings.allowPassthrough !== false,
      outputDir: settings.outputDir ?? null,
    });
  });

  ipcMain.handle("queue:cancel-item", async (_event, id: string): Promise<boolean> => {
    const active = await ensureQueue();
    return active.cancelItem(id);
  });

  ipcMain.handle("queue:cancel-all", async (): Promise<void> => {
    const active = await ensureQueue();
    active.cancelAll();
  });

  // --- downloads ------------------------------------------------------------

  ipcMain.handle("download:list", async (): Promise<UiDownloadItem[]> => {
    // sem yt-dlp nao ha o que listar; a UI ja mostra o aviso de instalacao
    if (!downloads) return [];
    return downloads.list().map(toUiDownload);
  });

  ipcMain.handle("download:analyze", async (_event, rawUrl: string): Promise<UiMediaInfo> => {
    const url = normalizeUrl(rawUrl);
    const ytdlp = await locateYtDlp();
    const info = cachedAnalysis(url) ?? (await fetchMediaInfo(ytdlp.path, url));
    analyses.set(url, { info, at: Date.now() });
    return toUiMediaInfo(url, info);
  });

  ipcMain.handle(
    "download:add",
    async (_event, payload: DownloadRequestPayload): Promise<UiDownloadItem[]> => {
      if (!isDownloadQuality(payload.quality)) throw new Error("qualidade invalida");
      const active = await ensureDownloads();
      const prefs = readPreferences();
      active.add({
        url: payload.url,
        quality: payload.quality,
        outputDir: prefs.downloadDir ?? app.getPath("downloads"),
        addToConversionQueue: payload.addToConversionQueue === true,
        thumbnail: payload.thumbnail === true,
        subtitleLang: typeof payload.subtitleLang === "string" ? payload.subtitleLang : null,
        ...(payload.audioFormat === "mp3" || payload.audioFormat === "original"
          ? { audioFormat: payload.audioFormat }
          : {}),
        ...(() => {
          const known = cachedAnalysis(normalizeUrl(payload.url));
          return known ? { info: known } : {};
        })(),
      });
      return active.list().map(toUiDownload);
    },
  );

  ipcMain.handle("download:cancel", (_event, id: string): boolean => downloads?.cancelItem(id) ?? false);
  ipcMain.handle("download:cancel-all", (): void => downloads?.cancelAll());

  ipcMain.handle("download:remove", (_event, id: string): UiDownloadItem[] => {
    downloads?.remove(id);
    return downloads?.list().map(toUiDownload) ?? [];
  });

  ipcMain.handle("download:clear-finished", (): UiDownloadItem[] => {
    downloads?.clearFinished();
    return downloads?.list().map(toUiDownload) ?? [];
  });

  ipcMain.handle("download:default-dir", (): string => {
    return readPreferences().downloadDir ?? app.getPath("downloads");
  });

  // --- sistema --------------------------------------------------------------

  ipcMain.handle("dir:pick", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "Onde salvar",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("shell:reveal", (_event, path: string): void => {
    shell.showItemInFolder(path);
  });
}

/** Chamado ao fechar o app: nao deixa ffmpeg nem yt-dlp orfaos rodando. */
export function shutdownQueue(): void {
  queue?.cancelAll();
  downloads?.cancelAll();
}
