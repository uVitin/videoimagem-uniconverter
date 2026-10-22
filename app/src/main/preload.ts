/**
 * Ponte entre o renderer (sem acesso a Node) e o processo principal.
 * So o que esta aqui fica visivel para a pagina.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  BatchSettingsPayload,
  BatchSummary,
  EnvironmentInfo,
  ItemLogEvent,
  ItemProgressEvent,
  Preferences,
  PresetGroup,
  ResolveRequestPayload,
  ResolveResponse,
  UiQueueItem,
} from "./ipc-types";

const api = {
  getEnvironment: (): Promise<EnvironmentInfo> => ipcRenderer.invoke("env:info"),
  readPreferences: (): Promise<Preferences> => ipcRenderer.invoke("prefs:read"),
  writePreferences: (patch: Partial<Preferences>): Promise<Preferences> =>
    ipcRenderer.invoke("prefs:write", patch),

  listPresets: (): Promise<PresetGroup[]> => ipcRenderer.invoke("presets:list"),
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
};

contextBridge.exposeInMainWorld("api", api);

export type VideoimagemApi = typeof api;
