/**
 * Ponte entre o renderer (sem acesso a Node) e o processo principal.
 * So o que esta aqui fica visivel para a pagina.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppUpdateInfo,
  BatchSettingsPayload,
  BatchSummary,
  DownloadProgressEvent,
  DownloadRequestPayload,
  EnvironmentInfo,
  FormatGroup,
  ItemLogEvent,
  ItemProgressEvent,
  Preferences,
  PresetGroup,
  TargetGroup,
  ResolveRequestPayload,
  ResolveResponse,
  UiDownloadItem,
  UiMediaInfo,
  UiQueueItem,
  YtDlpInfo,
  YtDlpUpdateInfo,
} from "./ipc-types";

const api = {
  getEnvironment: (): Promise<EnvironmentInfo> => ipcRenderer.invoke("env:info"),
  readPreferences: (): Promise<Preferences> => ipcRenderer.invoke("prefs:read"),
  writePreferences: (patch: Partial<Preferences>): Promise<Preferences> =>
    ipcRenderer.invoke("prefs:write", patch),

  listPresets: (): Promise<PresetGroup[]> => ipcRenderer.invoke("presets:list"),
  listTargets: (): Promise<TargetGroup[]> => ipcRenderer.invoke("targets:list"),
  listFormats: (): Promise<FormatGroup[]> => ipcRenderer.invoke("formats:list"),
  resolvePreset: (payload: ResolveRequestPayload): Promise<ResolveResponse> =>
    ipcRenderer.invoke("preset:resolve", payload),

  listQueue: (): Promise<UiQueueItem[]> => ipcRenderer.invoke("queue:list"),
  addFilesDialog: (): Promise<UiQueueItem[]> => ipcRenderer.invoke("queue:add-dialog"),
  addPaths: (paths: string[]): Promise<UiQueueItem[]> =>
    ipcRenderer.invoke("queue:add-paths", paths),
  removeItem: (id: string): Promise<UiQueueItem[]> => ipcRenderer.invoke("queue:remove", id),
  clearQueue: (): Promise<UiQueueItem[]> => ipcRenderer.invoke("queue:clear"),
  clearFinished: (): Promise<UiQueueItem[]> => ipcRenderer.invoke("queue:clear-finished"),
  startQueue: (settings: BatchSettingsPayload): Promise<void> =>
    ipcRenderer.invoke("queue:start", settings),
  cancelItem: (id: string): Promise<boolean> => ipcRenderer.invoke("queue:cancel-item", id),
  cancelAll: (): Promise<void> => ipcRenderer.invoke("queue:cancel-all"),

  /**
   * Caminho real de um arquivo arrastado. A partir do Electron 32 `File.path`
   * nao existe mais; webUtils.getPathForFile e o substituto, e so funciona
   * aqui no preload.
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  checkAppUpdate: (): Promise<AppUpdateInfo> => ipcRenderer.invoke("update:check"),
  openUpdatePage: (url: string): Promise<void> => ipcRenderer.invoke("update:open", url),
  updateYtDlp: (): Promise<YtDlpUpdateInfo> => ipcRenderer.invoke("ytdlp:update"),
  onYtDlpUpdated: (handler: (result: YtDlpUpdateInfo) => void): void => {
    ipcRenderer.on("ytdlp:updated", (_event, payload: YtDlpUpdateInfo) => handler(payload));
  },

  getYtDlp: (): Promise<YtDlpInfo> => ipcRenderer.invoke("ytdlp:info"),
  listDownloads: (): Promise<UiDownloadItem[]> => ipcRenderer.invoke("download:list"),
  analyzeDownload: (url: string): Promise<UiMediaInfo> =>
    ipcRenderer.invoke("download:analyze", url),
  addDownload: (payload: DownloadRequestPayload): Promise<UiDownloadItem[]> =>
    ipcRenderer.invoke("download:add", payload),
  cancelDownload: (id: string): Promise<boolean> => ipcRenderer.invoke("download:cancel", id),
  cancelAllDownloads: (): Promise<void> => ipcRenderer.invoke("download:cancel-all"),
  removeDownload: (id: string): Promise<UiDownloadItem[]> =>
    ipcRenderer.invoke("download:remove", id),
  clearFinishedDownloads: (): Promise<UiDownloadItem[]> =>
    ipcRenderer.invoke("download:clear-finished"),
  getDownloadDir: (): Promise<string> => ipcRenderer.invoke("download:default-dir"),

  pickOutputDir: (): Promise<string | null> => ipcRenderer.invoke("dir:pick"),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke("shell:reveal", path),

  onItemChanged: (handler: (item: UiQueueItem) => void): void => {
    ipcRenderer.on("queue:item", (_event, payload: UiQueueItem) => handler(payload));
  },
  onItemProgress: (handler: (event: ItemProgressEvent) => void): void => {
    ipcRenderer.on("queue:progress", (_event, payload: ItemProgressEvent) => handler(payload));
  },
  onItemLog: (handler: (event: ItemLogEvent) => void): void => {
    ipcRenderer.on("queue:log", (_event, payload: ItemLogEvent) => handler(payload));
  },
  onBatchDone: (handler: (summary: BatchSummary) => void): void => {
    ipcRenderer.on("queue:batch-done", (_event, payload: BatchSummary) => handler(payload));
  },
  /** a fila ganhou itens por fora (ex. download concluido enviado para conversao) */
  onQueueRefresh: (handler: () => void): void => {
    ipcRenderer.on("queue:refresh", () => handler());
  },
  onDownloadChanged: (handler: (item: UiDownloadItem) => void): void => {
    ipcRenderer.on("download:item", (_event, payload: UiDownloadItem) => handler(payload));
  },
  onDownloadProgress: (handler: (event: DownloadProgressEvent) => void): void => {
    ipcRenderer.on("download:progress", (_event, payload: DownloadProgressEvent) =>
      handler(payload),
    );
  },
  onDownloadLog: (handler: (event: ItemLogEvent) => void): void => {
    ipcRenderer.on("download:log", (_event, payload: ItemLogEvent) => handler(payload));
  },
};

contextBridge.exposeInMainWorld("api", api);

export type VideoimagemApi = typeof api;
