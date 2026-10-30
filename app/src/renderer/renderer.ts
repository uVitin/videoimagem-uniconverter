/**
 * Renderer. Roda sem acesso a Node: tudo passa por window.api (ver preload).
 *
 * Por isso os tipos sao declarados aqui em vez de importados do engine --
 * esse arquivo precisa compilar para um script classico, sem require().
 */

type Severity = "info" | "adjusted" | "warning";
type QueueStatus = "pending" | "running" | "done" | "failed" | "canceled";
type FitMode = "fit" | "fill" | "stretch";

interface Option<T> { value: T; label: string; }

interface PresetListItem {
  profileId: number;
  formatId: number | null;
  title: string;
  container: string;
  videoEncoder: string | null;
  audioEncoder: string | null;
  resolutionLabel: string | null;
  linkPath: string;
}

interface FormatListItem {
  formatId: number;
  title: string;
  extension: string;
  categoryId: number;
  categoryTitle: string;
  presetCount: number;
}

interface FormatGroup { categoryId: number; categoryTitle: string; items: FormatListItem[]; }

interface PresetGroup { categoryId: number; categoryTitle: string; items: PresetListItem[]; }

interface ChoiceOptions {
  videoEncoders: Option<string>[];
  audioEncoders: Option<string>[];
  resolutions: Option<string>[];
  frameRates: Option<number>[];
  videoBitrates: Option<number>[];
  audioBitrates: Option<number>[];
  sampleRates: Option<number>[];
  channels: Option<number>[];
}

interface UiChoices {
  videoEncoder: string | null;
  audioEncoder: string | null;
  resolution: string | null;
  frameRate: number | null;
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
}

interface UiNote { field: string; severity: Severity; message: string; }
interface UiPassthrough { video: boolean; audio: boolean; videoReason: string; audioReason: string; }

interface UiSourceInfo {
  path: string;
  fileName: string;
  width?: number;
  height?: number;
  frameRate?: number;
  durationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioSampleRateHz?: number;
  audioChannels?: number;
  sizeBytes?: number;
  totalBitrateKbps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

interface UiProgress {
  fraction: number | null;
  outTimeSeconds: number;
  speed?: string;
  fps?: number;
  etaSeconds?: number | null;
  totalSizeBytes?: number;
}

interface UiQueueItem {
  id: string;
  path: string;
  fileName: string;
  status: QueueStatus;
  source: UiSourceInfo | null;
  probeError?: string;
  outputPath?: string;
  error?: string;
  elapsedSeconds?: number;
  progress?: UiProgress | null;
}

interface ResolveResponse {
  profileTitle: string | null;
  formatTitle: string | null;
  container: string;
  linkPath: string;
  choices: UiChoices;
  options: ChoiceOptions;
  notes: UiNote[];
  passthrough: UiPassthrough | null;
  appliedLimitCount: number;
  commandPreview: string;
  warnings: string[];
  outputPath: string;
}

interface ResolveRequestPayload {
  profileId: number | null;
  formatId?: number | null;
  overrides?: Partial<UiChoices>;
  itemId?: string | null;
  preferHardware?: boolean;
  fitMode?: FitMode;
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

interface BatchSettingsPayload {
  profileId: number | null;
  formatId?: number | null;
  overrides?: Partial<UiChoices>;
  preferHardware?: boolean;
  fitMode?: FitMode;
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  canceled: number;
  elapsedSeconds: number;
}

/** "best", "audio" ou a altura maxima em pixels ("1080") */
type DownloadQuality = string;
type AudioFormat = "mp3" | "original";
type DownloadStatus = "pending" | "analyzing" | "running" | "done" | "failed" | "canceled";

interface UiDownloadProgress {
  fraction: number | null;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  formatId?: string;
}

interface UiDownloadItem {
  id: string;
  url: string;
  title: string | null;
  quality: DownloadQuality;
  status: DownloadStatus;
  outputPath?: string;
  error?: string;
  elapsedSeconds?: number;
  progress: UiDownloadProgress | null;
}

interface UiVideoOption { height: number; sizeBytes?: number; }
interface UiSubtitleOption { code: string; name: string; auto: boolean; }

interface UiMediaInfo {
  url: string;
  title: string;
  uploader?: string;
  durationSeconds?: number;
  videoOptions: UiVideoOption[];
  audioSizeBytes?: number;
  audioBitrateKbps?: number;
  subtitles: UiSubtitleOption[];
  isLive: boolean;
}

interface AppUpdateInfo { available: boolean; current: string; latest?: string; url?: string; notes?: string; error?: string; }
interface YtDlpUpdateInfo { updated: boolean; from: string; to: string; }
interface YtDlpInfo { available: boolean; path?: string; version?: string; hint?: string; }

interface Preferences {
  lastProfileId: number | null;
  lastFormatId: number | null;
  outputDir: string | null;
  preferHardware: boolean;
  allowPassthrough: boolean;
  fitMode: FitMode;
  clearFinishedOnDone: boolean;
  downloadDir: string | null;
  downloadQuality: DownloadQuality;
  sendDownloadsToQueue: boolean;
  skipDownloadDialog: boolean;
  downloadAudioFormat: AudioFormat;
  downloadThumbnail: boolean;
  downloadSubtitles: boolean;
}

interface EnvironmentInfo {
  appVersion: string;
  ffmpeg: string;
  ffprobe: string;
  version: string;
  dataDir: string;
  encoderCount: number;
  hasVideoToolbox: boolean;
}

interface VideoimagemApi {
  getEnvironment(): Promise<EnvironmentInfo>;
  readPreferences(): Promise<Preferences>;
  writePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  listPresets(): Promise<PresetGroup[]>;
  listFormats(): Promise<FormatGroup[]>;
  resolvePreset(payload: ResolveRequestPayload): Promise<ResolveResponse>;
  listQueue(): Promise<UiQueueItem[]>;
  addFilesDialog(): Promise<UiQueueItem[]>;
  addPaths(paths: string[]): Promise<UiQueueItem[]>;
  removeItem(id: string): Promise<UiQueueItem[]>;
  clearQueue(): Promise<UiQueueItem[]>;
  clearFinished(): Promise<UiQueueItem[]>;
  startQueue(settings: BatchSettingsPayload): Promise<void>;
  cancelItem(id: string): Promise<boolean>;
  cancelAll(): Promise<void>;
  getPathForFile(file: File): string;
  checkAppUpdate(): Promise<AppUpdateInfo>;
  openUpdatePage(url: string): Promise<void>;
  updateYtDlp(): Promise<YtDlpUpdateInfo>;
  onYtDlpUpdated(handler: (result: YtDlpUpdateInfo) => void): void;
  getYtDlp(): Promise<YtDlpInfo>;
  listDownloads(): Promise<UiDownloadItem[]>;
  analyzeDownload(url: string): Promise<UiMediaInfo>;
  addDownload(payload: {
    url: string;
    quality: DownloadQuality;
    addToConversionQueue: boolean;
    audioFormat?: AudioFormat;
    thumbnail?: boolean;
    subtitleLang?: string | null;
  }): Promise<UiDownloadItem[]>;
  cancelDownload(id: string): Promise<boolean>;
  cancelAllDownloads(): Promise<void>;
  removeDownload(id: string): Promise<UiDownloadItem[]>;
  clearFinishedDownloads(): Promise<UiDownloadItem[]>;
  getDownloadDir(): Promise<string>;
  pickOutputDir(): Promise<string | null>;
  reveal(path: string): Promise<void>;
  onItemChanged(handler: (item: UiQueueItem) => void): void;
  onItemProgress(handler: (event: { itemId: string; progress: UiProgress }) => void): void;
  onItemLog(handler: (event: { itemId: string; line: string }) => void): void;
  onBatchDone(handler: (summary: BatchSummary) => void): void;
  onQueueRefresh(handler: () => void): void;
  onDownloadChanged(handler: (item: UiDownloadItem) => void): void;
  onDownloadProgress(handler: (event: { itemId: string; progress: UiDownloadProgress }) => void): void;
  onDownloadLog(handler: (event: { itemId: string; line: string }) => void): void;
}

declare const api: VideoimagemApi;

// --------------------------------------------------------------------------- //

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`elemento #${id} nao existe`);
  return found as T;
};

const dom = {
  env: el("env"),
  formatSelect: el<HTMLSelectElement>("format-select"),
  presetSelect: el<HTMLSelectElement>("preset-select"),
  exportHint: el("export-hint"),
  navConverter: el<HTMLButtonElement>("nav-converter"),
  navDownloader: el<HTMLButtonElement>("nav-downloader"),
  navBadge: el("nav-download-badge"),
  viewConverter: el("view-converter"),
  viewDownloader: el("view-downloader"),
  dropzone: el("dropzone"),
  dropzoneEmpty: el("dropzone-empty"),
  queue: el<HTMLUListElement>("queue"),
  addFiles: el<HTMLButtonElement>("add-files"),
  clearFinished: el<HTMLButtonElement>("clear-finished"),
  clearQueue: el<HTMLButtonElement>("clear-queue"),
  settings: el("settings"),
  targetTitle: el("target-title"),
  preferHardware: el<HTMLInputElement>("prefer-hardware"),
  allowPassthrough: el<HTMLInputElement>("allow-passthrough"),
  clearOnDone: el<HTMLInputElement>("clear-on-done"),
  fitMode: el<HTMLSelectElement>("fitMode"),
  notes: el("notes"),
  commandPreview: el("command-preview"),
  outputPath: el("output-path"),
  pickDir: el<HTMLButtonElement>("pick-dir"),
  resetDir: el<HTMLButtonElement>("reset-dir"),
  convert: el<HTMLButtonElement>("convert"),
  cancelAll: el<HTMLButtonElement>("cancel-all"),
  progress: el("progress"),
  progressFill: el("progress-fill"),
  progressText: el("progress-text"),
  logBox: el<HTMLDetailsElement>("log-box"),
  log: el("log"),
  ytdlpMissing: el("ytdlp-missing"),
  ytdlpUpdate: el<HTMLButtonElement>("ytdlp-update"),
  aboutDialog: el<HTMLDialogElement>("about-dialog"),
  aboutVersion: el("about-version"),
  aboutDetail: el("about-detail"),
  aboutStatus: el("about-status"),
  aboutCheck: el<HTMLButtonElement>("about-check"),
  updateBanner: el("update-banner"),
  updateTitle: el("update-title"),
  updateSub: el("update-sub"),
  updateOpen: el<HTMLButtonElement>("update-open"),
  updateDismiss: el<HTMLButtonElement>("update-dismiss"),
  downloadForm: el<HTMLFormElement>("download-form"),
  downloadUrl: el<HTMLInputElement>("download-url"),
  downloadEmpty: el("download-empty"),
  downloadEmptyTitle: el("download-empty-title"),
  downloadEmptyHint: el("download-empty-hint"),
  tabActive: el<HTMLButtonElement>("dl-tab-active"),
  tabDone: el<HTMLButtonElement>("dl-tab-done"),
  countActive: el("dl-count-active"),
  countDone: el("dl-count-done"),
  downloadCancelAll: el<HTMLButtonElement>("download-cancel-all"),
  downloadAsk: el<HTMLInputElement>("download-ask"),
  dialog: el<HTMLDialogElement>("download-dialog"),
  ddTitle: el("dd-title"),
  ddMeta: el("dd-meta"),
  ddVideo: el("dd-video"),
  ddAudio: el("dd-audio"),
  ddThumbnail: el<HTMLInputElement>("dd-thumbnail"),
  ddSubsOn: el<HTMLInputElement>("dd-subs-on"),
  ddSubsLang: el<HTMLSelectElement>("dd-subs-lang"),
  ddSubs: el("dd-subs"),
  ddSubsNone: el("dd-subs-none"),
  ddRemember: el<HTMLInputElement>("dd-remember"),
  ddGo: el<HTMLButtonElement>("dd-go"),
  ddCancel: el<HTMLButtonElement>("dd-cancel"),
  ddClose: el<HTMLButtonElement>("dd-close"),
  downloadGo: el<HTMLButtonElement>("download-go"),
  downloadToQueue: el<HTMLInputElement>("download-to-queue"),
  downloadDir: el("download-dir"),
  downloadPickDir: el<HTMLButtonElement>("download-pick-dir"),
  downloadClear: el<HTMLButtonElement>("download-clear"),
  downloadList: el<HTMLUListElement>("download-list"),
};

const CHOICE_FIELDS = [
  "videoEncoder", "audioEncoder", "resolution", "frameRate",
  "videoBitrateKbps", "audioBitrateKbps", "sampleRateHz", "channels",
] as const;

type ChoiceField = (typeof CHOICE_FIELDS)[number];

const OPTION_KEY: Record<ChoiceField, keyof ChoiceOptions> = {
  videoEncoder: "videoEncoders",
  audioEncoder: "audioEncoders",
  resolution: "resolutions",
  frameRate: "frameRates",
  videoBitrateKbps: "videoBitrates",
  audioBitrateKbps: "audioBitrates",
  sampleRateHz: "sampleRates",
  channels: "channels",
};

const NUMERIC_FIELDS = new Set<ChoiceField>([
  "frameRate", "videoBitrateKbps", "audioBitrateKbps", "sampleRateHz", "channels",
]);

const STATUS_LABEL: Record<QueueStatus, string> = {
  pending: "na fila",
  running: "convertendo",
  done: "pronto",
  failed: "falhou",
  canceled: "cancelado",
};

// --------------------------------------------------------------------------- //

interface State {
  groups: PresetGroup[];
  formatGroups: FormatGroup[];
  /** formato escolhido; DEVICES_FORMAT = so presets de dispositivos sem formato */
  selectedFormatId: number | null;
  /** null = "Personalizado": padroes do formato, sem preset */
  selectedPresetId: number | null;
  items: UiQueueItem[];
  /** item cujos metadados alimentam a previa dos ajustes */
  focusedItemId: string | null;
  outputDir: string | null;
  /** so o que o usuario mexeu explicitamente; o resto o resolvedor decide */
  overrides: Partial<UiChoices>;
  resolved: ResolveResponse | null;
  running: boolean;
  clearFinishedOnDone: boolean;
}

const state: State = {
  groups: [],
  formatGroups: [],
  selectedFormatId: null,
  selectedPresetId: null,
  items: [],
  focusedItemId: null,
  outputDir: null,
  overrides: {},
  resolved: null,
  running: false,
  clearFinishedOnDone: false,
};

/** Refs dos elementos de progresso de cada linha, para nao redesenhar a lista. */
const progressRefs = new Map<string, { fill: HTMLElement; text: HTMLElement }>();

// --------------------------------------------------------------------------- //
// formatadores

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function describeSource(source: UiSourceInfo | null): string {
  if (!source) return "não foi possível ler";
  return [
    source.width && source.height ? `${source.width}×${source.height}` : null,
    source.frameRate ? `${source.frameRate} fps` : null,
    source.durationSeconds ? formatDuration(source.durationSeconds) : null,
    source.videoCodec,
    source.audioCodec,
    source.sizeBytes ? formatBytes(source.sizeBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // o Electron prefixa o erro de IPC; a parte util vem depois do ultimo ':'
    const parts = error.message.split("Error: ");
    return (parts[parts.length - 1] ?? error.message).trim();
  }
  return String(error);
}

// --------------------------------------------------------------------------- //
// formato e predefinicao (o "Format / Preset" do Premiere)

/** presets de dispositivos que o banco original nao liga a nenhum formato */
const DEVICES_FORMAT = -1;

const CATEGORY_LABEL: Record<number, string> = {
  7: "Vídeo", 8: "Áudio", 5: "Edição", 4: "HD e 3D", 9: "Web",
  10: "Imagem e GIF", 1: "Dispositivos", 200: "Personalizado",
};

function extensionLabel(extension: string): string {
  return extension.replace(".", "").toLowerCase();
}

function formatLabel(item: FormatListItem): string {
  const ext = extensionLabel(item.extension);
  return item.title.toLowerCase() === ext ? `${item.title}` : `${item.title} — .${ext}`;
}

function presetsForFormat(formatId: number | null): PresetListItem[] {
  if (formatId == null) return [];
  const wanted = formatId === DEVICES_FORMAT ? null : formatId;
  const out: PresetListItem[] = [];
  for (const group of state.groups) {
    for (const item of group.items) {
      if (item.formatId === wanted) out.push(item);
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

function hasTarget(): boolean {
  if (state.selectedPresetId != null) return true;
  return state.selectedFormatId != null && state.selectedFormatId !== DEVICES_FORMAT;
}

/** O que a engine precisa saber do alvo: um preset, ou so o formato. */
function targetPayload(): { profileId: number | null; formatId: number | null } {
  return state.selectedPresetId != null
    ? { profileId: state.selectedPresetId, formatId: null }
    : { profileId: null, formatId: state.selectedFormatId };
}

function renderFormatSelect(): void {
  dom.formatSelect.textContent = "";
  const seen = new Map<string, number>();

  for (const group of state.formatGroups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = CATEGORY_LABEL[group.categoryId] ?? group.categoryTitle;

    for (const item of group.items) {
      let label = formatLabel(item);
      // o banco tem formatos de mesmo nome (dois "MP4"): numera para distinguir
      const times = (seen.get(label) ?? 0) + 1;
      seen.set(label, times);
      if (times > 1) label += ` (${times})`;

      const option = document.createElement("option");
      option.value = String(item.formatId);
      option.textContent = label;
      optgroup.append(option);
    }

    // os presets sem formato entram no fim de Dispositivos
    if (group.categoryId === 1 && presetsForFormat(DEVICES_FORMAT).length > 0) {
      const option = document.createElement("option");
      option.value = String(DEVICES_FORMAT);
      option.textContent = "Outros dispositivos";
      optgroup.append(option);
    }
    dom.formatSelect.append(optgroup);
  }

  if (state.selectedFormatId != null) dom.formatSelect.value = String(state.selectedFormatId);
}

function renderPresetSelect(): void {
  dom.presetSelect.textContent = "";
  const presets = presetsForFormat(state.selectedFormatId);
  const deviceOnly = state.selectedFormatId === DEVICES_FORMAT;

  if (!deviceOnly) {
    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = "Personalizado";
    dom.presetSelect.append(custom);
  }

  for (const item of presets) {
    const option = document.createElement("option");
    option.value = String(item.profileId);
    option.textContent = [item.title, item.resolutionLabel].filter(Boolean).join(" · ");
    dom.presetSelect.append(option);
  }

  dom.presetSelect.value = state.selectedPresetId != null ? String(state.selectedPresetId) : "";
  dom.presetSelect.disabled = state.running;

  dom.exportHint.textContent =
    state.selectedPresetId != null
      ? ""
      : deviceOnly
        ? "Escolha o aparelho em Predefinição."
        : presets.length > 0
          ? `${presets.length} predefinições para este formato. Em Personalizado você ajusta tudo abaixo.`
          : "Sem predefinições para este formato: ajuste codec, resolução e bitrate abaixo.";
}

async function selectFormat(formatId: number, presetId: number | null = null): Promise<void> {
  state.selectedFormatId = formatId;
  // nos "Outros dispositivos" nao ha Personalizado: cai no primeiro aparelho
  state.selectedPresetId =
    presetId ?? (formatId === DEVICES_FORMAT ? (presetsForFormat(formatId)[0]?.profileId ?? null) : null);
  state.overrides = {}; // trocar de formato/preset zera o que o usuario tinha mexido

  dom.formatSelect.value = String(formatId);
  renderPresetSelect();
  void api.writePreferences({ lastFormatId: formatId, lastProfileId: state.selectedPresetId });
  await refreshResolved();
}

async function selectPreset(profileId: number | null): Promise<void> {
  state.selectedPresetId = profileId;
  state.overrides = {};
  renderPresetSelect();
  void api.writePreferences({ lastProfileId: profileId });
  await refreshResolved();
}

// --------------------------------------------------------------------------- //
// fila

function statusIcon(status: QueueStatus): string {
  switch (status) {
    case "done": return "✓";
    case "failed": return "!";
    case "canceled": return "–";
    case "running": return "▸";
    default: return "•";
  }
}

function buildQueueRow(item: UiQueueItem): HTMLLIElement {
  const row = document.createElement("li");
  row.className = `queue-item ${item.status}`;
  row.dataset.itemId = item.id;
  if (item.id === state.focusedItemId) row.classList.add("focused");

  // clicar na linha faz a previa dos ajustes usar este arquivo
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    void focusItem(item.id);
  });

  const badge = document.createElement("span");
  badge.className = "queue-status";
  badge.textContent = statusIcon(item.status);
  badge.title = STATUS_LABEL[item.status];

  const body = document.createElement("div");
  body.className = "queue-body";

  const name = document.createElement("div");
  name.className = "queue-name";
  name.textContent = item.fileName;
  name.title = item.path;

  const meta = document.createElement("div");
  meta.className = "queue-meta";

  if (item.status === "failed" && item.error) {
    meta.classList.add("error");
    meta.textContent = item.error.split("\n")[0] ?? item.error;
    meta.title = item.error;
  } else if (item.status === "done" && item.outputPath) {
    meta.textContent = `→ ${item.outputPath.split("/").pop() ?? ""}` +
      (item.elapsedSeconds ? ` · ${formatDuration(item.elapsedSeconds)}` : "");
    meta.title = item.outputPath;
  } else {
    meta.textContent = describeSource(item.source);
  }

  body.append(name, meta);

  if (item.status === "running") {
    const progress = document.createElement("div");
    progress.className = "queue-progress";

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill";
    if (!item.source?.durationSeconds) fill.classList.add("indeterminate");
    bar.append(fill);

    const text = document.createElement("span");
    text.className = "queue-progress-text";
    text.textContent = "iniciando…";

    progress.append(bar, text);
    body.append(progress);
    progressRefs.set(item.id, { fill, text });
  }

  const actions = document.createElement("div");
  actions.className = "queue-actions";

  if (item.status === "done" && item.outputPath) {
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "icon-btn";
    reveal.textContent = "⤴";
    reveal.title = "Mostrar no Finder";
    reveal.addEventListener("click", () => void api.reveal(item.outputPath!));
    actions.append(reveal);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn";
  remove.textContent = "×";
  remove.title = item.status === "running" ? "Cancelar este" : "Tirar da fila";
  remove.addEventListener("click", () => {
    if (item.status === "running") void api.cancelItem(item.id);
    else void refreshQueue(api.removeItem(item.id));
  });
  actions.append(remove);

  row.append(badge, body, actions);
  return row;
}

function renderQueue(): void {
  progressRefs.clear();
  dom.queue.textContent = "";

  const hasItems = state.items.length > 0;
  dom.queue.hidden = !hasItems;
  dom.dropzoneEmpty.hidden = hasItems;
  dom.clearQueue.hidden = !hasItems || state.running;
  dom.clearFinished.hidden =
    state.running || !state.items.some((item) => item.status !== "pending" && item.status !== "running");

  for (const item of state.items) {
    dom.queue.append(buildQueueRow(item));
  }

  updateConvertButton();
}

function pendingCount(): number {
  return state.items.filter((item) => item.status === "pending").length;
}

function updateConvertButton(): void {
  const pending = pendingCount();
  dom.convert.textContent = pending > 1 ? `Converter ${pending} arquivos` : "Converter";
  // durante o lote quem manda e o 'Cancelar tudo'; deixar os dois lado a lado
  // so confunde
  dom.convert.hidden = state.running;
  dom.convert.disabled = pending === 0 || !hasTarget();
}

async function refreshQueue(source: Promise<UiQueueItem[]>): Promise<void> {
  try {
    state.items = await source;
  } catch (error) {
    showNote("warning", "fila", describeError(error));
    return;
  }

  if (!state.items.some((item) => item.id === state.focusedItemId)) {
    state.focusedItemId = state.items[0]?.id ?? null;
  }
  renderQueue();
  await refreshResolved();
}

async function focusItem(id: string): Promise<void> {
  if (state.focusedItemId === id) return;
  state.focusedItemId = id;
  renderQueue();
  await refreshResolved();
}

// --------------------------------------------------------------------------- //
// ajustes

function fillSelect(field: ChoiceField, options: Option<string | number>[], current: unknown): void {
  const select = el<HTMLSelectElement>(field);
  select.textContent = "";

  if (options.length === 0) {
    // sem tabela de capacidades: mostra o valor cru para o usuario saber o que vai
    const option = document.createElement("option");
    option.value = String(current ?? "");
    option.textContent = current == null ? "—" : `${current} (livre)`;
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = state.running;
  for (const entry of options) {
    const option = document.createElement("option");
    option.value = String(entry.value);
    option.textContent = entry.label;
    option.selected = String(entry.value) === String(current);
    select.append(option);
  }
}

const FIELD_LABELS: Record<string, string> = {
  videoEncoder: "Codec de vídeo",
  audioEncoder: "Codec de áudio",
  resolution: "Resolução",
  frameRate: "Taxa de quadros",
  videoBitrateKbps: "Bitrate de vídeo",
  audioBitrateKbps: "Bitrate de áudio",
  sampleRateHz: "Sample rate",
  channels: "Canais",
  container: "Formato",
};

/** Troca o texto de engenheiro das notas do resolver por uma frase para quem usa o app. */
function friendlyNote(field: string, message: string): { label: string; text: string } {
  const label = FIELD_LABELS[field] ?? field;
  const named = /^'(.+)' nao e aceito aqui; usando '(.+)'\./.exec(message);
  if (named) {
    return { label, text: `${named[1]} não é compatível com este formato. Usei ${named[2]}.` };
  }
  const nearest = /^(.+) nao e aceito aqui; usando o mais proximo, (.+)$/.exec(message);
  if (nearest) {
    return { label, text: `${nearest[1]} não é compatível com este formato. Usei o mais próximo: ${nearest[2]}.` };
  }
  const plain = /^(.+) nao e aceito aqui; usando (.+)$/.exec(message);
  if (plain) {
    return { label, text: `${plain[1]} não é compatível com este formato. Usei ${plain[2]}.` };
  }
  return { label, text: message };
}

function showNote(severity: Severity | "ok", rawField: string, rawMessage: string): void {
  const { label: fieldLabel, text: message } = friendlyNote(rawField, rawMessage);
  const field = fieldLabel;
  const div = document.createElement("div");
  div.className = `note ${severity}`;
  const label = document.createElement("span");
  label.className = "note-field";
  label.textContent = field;
  const text = document.createElement("span");
  text.textContent = message;
  div.append(label, text);
  dom.notes.append(div);
}

function renderNotes(resolved: ResolveResponse): void {
  dom.notes.textContent = "";

  if (resolved.passthrough?.video) showNote("ok", "vídeo", resolved.passthrough.videoReason);
  if (resolved.passthrough?.audio) showNote("ok", "áudio", resolved.passthrough.audioReason);
  for (const note of resolved.notes) showNote(note.severity, note.field, note.message);
  for (const warning of resolved.warnings) {
    if (!resolved.notes.some((note) => note.message === warning)) {
      showNote("warning", "ffmpeg", warning);
    }
  }
}

async function refreshResolved(): Promise<void> {
  if (!hasTarget()) {
    dom.settings.hidden = true;
    updateConvertButton();
    return;
  }

  let resolved: ResolveResponse;
  try {
    resolved = await api.resolvePreset({
      ...targetPayload(),
      overrides: state.overrides,
      itemId: state.focusedItemId,
      preferHardware: dom.preferHardware.checked,
      fitMode: dom.fitMode.value as FitMode,
      allowPassthrough: dom.allowPassthrough.checked,
      outputDir: state.outputDir,
    });
  } catch (error) {
    dom.notes.textContent = "";
    showNote("warning", "preset", describeError(error));
    return;
  }

  state.resolved = resolved;
  dom.settings.hidden = false;

  const targetName = resolved.profileTitle ?? resolved.formatTitle;
  const targetExt = resolved.container.replace(".", "").toUpperCase();
  // "MP4 → MP4" nao diz nada: so mostra a extensao quando o nome nao e ela
  dom.targetTitle.textContent =
    targetName && targetName.toUpperCase() !== targetExt ? `${targetName} → ${targetExt}` : targetExt;
  dom.targetTitle.title =
    resolved.appliedLimitCount > 0
      ? `${resolved.appliedLimitCount} restrição(ões) do formato aplicadas`
      : "";

  for (const field of CHOICE_FIELDS) {
    fillSelect(field, resolved.options[OPTION_KEY[field]], resolved.choices[field]);
  }

  renderNotes(resolved);
  dom.commandPreview.textContent = resolved.commandPreview;

  const focused = state.items.find((item) => item.id === state.focusedItemId);
  dom.outputPath.textContent = focused
    ? `Saída: ${resolved.outputPath}`
    : state.outputDir
      ? `Pasta de saída: ${state.outputDir}`
      : "Saída na mesma pasta de cada arquivo";
  dom.resetDir.hidden = state.outputDir == null;

  updateConvertButton();
}

// --------------------------------------------------------------------------- //
// execucao

function setRunning(running: boolean): void {
  state.running = running;
  dom.cancelAll.hidden = !running;
  dom.progress.hidden = !running;
  dom.addFiles.disabled = running;
  dom.pickDir.disabled = running;
  dom.resetDir.disabled = running;
  dom.formatSelect.disabled = running;
  dom.presetSelect.disabled = running;
  for (const field of CHOICE_FIELDS) {
    const select = el<HTMLSelectElement>(field);
    if (!select.disabled || !running) select.disabled = running;
  }
  dom.fitMode.disabled = running;
  dom.preferHardware.disabled = running;
  dom.allowPassthrough.disabled = running;
  dom.clearOnDone.disabled = running;
  updateConvertButton();
}

function updateOverallProgress(): void {
  const total = state.items.length;
  const finished = state.items.filter(
    (item) => item.status === "done" || item.status === "failed" || item.status === "canceled",
  ).length;
  const running = state.items.find((item) => item.status === "running");

  const partial = running?.progress?.fraction ?? 0;
  const fraction = total > 0 ? Math.min(1, (finished + partial) / total) : 0;

  dom.progressFill.style.width = `${Math.round(fraction * 100)}%`;
  dom.progressText.textContent =
    `${finished} de ${total}` + (running ? ` · ${running.fileName}` : "");
}

async function startQueue(): Promise<void> {
  if (!hasTarget() || pendingCount() === 0) return;

  logLines.length = 0;
  dom.log.textContent = "";
  dom.logBox.hidden = false;
  dom.progressFill.style.width = "0%";
  dom.progressText.textContent = "iniciando…";
  setRunning(true);

  try {
    await api.startQueue({
      ...targetPayload(),
      overrides: state.overrides,
      preferHardware: dom.preferHardware.checked,
      fitMode: dom.fitMode.value as FitMode,
      allowPassthrough: dom.allowPassthrough.checked,
      outputDir: state.outputDir,
    });
  } catch (error) {
    setRunning(false);
    showNote("warning", "fila", `não consegui iniciar: ${describeError(error)}`);
  }
}

function onItemChanged(updated: UiQueueItem): void {
  const index = state.items.findIndex((item) => item.id === updated.id);
  if (index >= 0) state.items[index] = updated;
  else state.items.push(updated);

  if (state.focusedItemId == null) state.focusedItemId = updated.id;
  renderQueue();
  if (state.running) updateOverallProgress();
}

function onItemProgress({ itemId, progress }: { itemId: string; progress: UiProgress }): void {
  const item = state.items.find((entry) => entry.id === itemId);
  if (item) item.progress = progress;

  const refs = progressRefs.get(itemId);
  if (refs) {
    if (progress.fraction != null) {
      refs.fill.classList.remove("indeterminate");
      refs.fill.style.width = `${Math.round(progress.fraction * 100)}%`;
    }
    refs.text.textContent = [
      progress.fraction != null
        ? `${Math.round(progress.fraction * 100)}%`
        : formatDuration(progress.outTimeSeconds),
      progress.speed,
      progress.etaSeconds != null ? `faltam ${formatDuration(progress.etaSeconds)}` : null,
      progress.totalSizeBytes ? formatBytes(progress.totalSizeBytes) : null,
    ].filter(Boolean).join(" · ");
  }

  updateOverallProgress();
}

async function onBatchDone(summary: BatchSummary): Promise<void> {
  setRunning(false);
  dom.progressText.textContent = "";

  dom.notes.textContent = "";

  // arquivos que o ffprobe rejeitou nunca chegaram a entrar no lote, entao nao
  // aparecem no resumo -- mas estao na tela em vermelho e precisam ser citados
  const unreadable = state.items.filter((item) => item.probeError).length;

  const parts = [
    summary.done > 0 ? `${summary.done} pronto(s)` : null,
    summary.failed > 0 ? `${summary.failed} com falha` : null,
    summary.canceled > 0 ? `${summary.canceled} cancelado(s)` : null,
  ].filter(Boolean);

  const problems = summary.failed > 0 || unreadable > 0;
  const severity = problems ? "warning" : summary.done > 0 ? "ok" : "adjusted";

  const message =
    `${parts.join(", ") || "nada a converter"} em ${formatDuration(summary.elapsedSeconds)}` +
    (unreadable > 0 ? ` · ${unreadable} arquivo(s) que não pude ler` : "");
  showNote(severity, "lote", message);

  if (problems) dom.logBox.open = true;
  if (state.clearFinishedOnDone && summary.failed === 0) {
    await refreshQueue(api.clearFinished());
  } else {
    renderQueue();
  }
}

/**
 * O log so guarda as ultimas LOG_MAX_LINES linhas. Um lote de dezenas de
 * arquivos geraria megabytes de texto no DOM, e o que interessa quando algo
 * falha esta sempre no fim.
 */
const LOG_MAX_LINES = 500;
const logLines: string[] = [];

function appendLog(line: string): void {
  logLines.push(line);
  if (logLines.length > LOG_MAX_LINES) {
    logLines.splice(0, logLines.length - LOG_MAX_LINES);
  }
  dom.log.textContent = logLines.join("\n");
  dom.log.scrollTop = dom.log.scrollHeight;
}

// --------------------------------------------------------------------------- //
// navegacao

type ViewName = "converter" | "downloader";

function showView(name: ViewName): void {
  dom.viewConverter.hidden = name !== "converter";
  dom.viewDownloader.hidden = name !== "downloader";
  dom.navConverter.classList.toggle("active", name === "converter");
  dom.navDownloader.classList.toggle("active", name === "downloader");
  if (name === "downloader") dom.downloadUrl.focus();
}

// --------------------------------------------------------------------------- //
// downloader

const DOWNLOAD_STATUS_LABEL: Record<DownloadStatus, string> = {
  pending: "na fila",
  analyzing: "analisando",
  running: "baixando",
  done: "pronto",
  failed: "falhou",
  canceled: "cancelado",
};

function qualityLabel(quality: DownloadQuality): string {
  if (quality === "best") return "melhor qualidade";
  if (quality === "audio") return "só áudio";
  return `até ${quality}p`;
}

let downloads: UiDownloadItem[] = [];
let downloadTab: "active" | "done" = "active";
const downloadRefs = new Map<string, { fill: HTMLElement; text: HTMLElement }>();
/** ids de trilha vistos por download: 'video+audio' baixa duas e a barra recomeca */
const downloadStreams = new Map<string, string[]>();

/** Ultimas escolhas, que a janela de opcoes oferece como padrao. */
const downloadChoices = {
  quality: "best" as DownloadQuality,
  audioFormat: "mp3" as AudioFormat,
  thumbnail: false,
  subtitles: false,
  /** false = baixa direto com as escolhas anteriores, sem abrir a janela */
  askFirst: true,
};

function isActiveDownload(item: UiDownloadItem): boolean {
  return item.status === "pending" || item.status === "analyzing" || item.status === "running";
}

function downloadStatusIcon(status: DownloadStatus): string {
  switch (status) {
    case "done": return "✓";
    case "failed": return "!";
    case "canceled": return "–";
    case "running": case "analyzing": return "▸";
    default: return "•";
  }
}

function describeDownloadProgress(item: UiDownloadItem, progress: UiDownloadProgress): string {
  const parts: string[] = [];
  if (progress.fraction != null) parts.push(`${Math.round(progress.fraction * 100)}%`);
  else parts.push(formatBytes(progress.downloadedBytes));

  const streams = downloadStreams.get(item.id) ?? [];
  if (streams.length > 1) parts.push(`faixa ${streams.length}`);
  if (progress.speedBytesPerSec) parts.push(`${formatBytes(progress.speedBytesPerSec)}/s`);
  if (progress.etaSeconds != null) parts.push(`faltam ${formatDuration(progress.etaSeconds)}`);
  return parts.join(" · ");
}

function buildDownloadRow(item: UiDownloadItem): HTMLLIElement {
  const row = document.createElement("li");
  row.className = `queue-item ${item.status}`;
  row.dataset.downloadId = item.id;

  const badge = document.createElement("span");
  badge.className = "queue-status";
  badge.textContent = downloadStatusIcon(item.status);
  badge.title = DOWNLOAD_STATUS_LABEL[item.status];

  const body = document.createElement("div");
  body.className = "queue-body";

  const name = document.createElement("div");
  name.className = "queue-name";
  name.textContent = item.title ?? item.url;
  name.title = item.url;

  const meta = document.createElement("div");
  meta.className = "queue-meta";
  if (item.status === "failed" && item.error) {
    meta.classList.add("error");
    meta.textContent = item.error.split("\n")[0] ?? item.error;
    meta.title = item.error;
  } else if (item.status === "done" && item.outputPath) {
    meta.textContent = `→ ${item.outputPath.split("/").pop() ?? ""}` +
      (item.elapsedSeconds ? ` · ${formatDuration(item.elapsedSeconds)}` : "");
    meta.title = item.outputPath;
  } else {
    meta.textContent = `${qualityLabel(item.quality)} · ${DOWNLOAD_STATUS_LABEL[item.status]}`;
  }
  body.append(name, meta);

  if (item.status === "running" || item.status === "analyzing") {
    const progress = document.createElement("div");
    progress.className = "queue-progress";

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "fill";
    if (item.progress?.fraction == null) fill.classList.add("indeterminate");
    bar.append(fill);

    const text = document.createElement("span");
    text.className = "queue-progress-text";
    text.textContent = item.status === "analyzing" ? "analisando o link…" : "iniciando…";

    progress.append(bar, text);
    body.append(progress);
    const refs = { fill, text };
    downloadRefs.set(item.id, refs);
    // a lista e redesenhada a cada mudanca; sem isto a barra voltava a zero
    if (item.status === "running" && item.progress) applyDownloadProgress(item, item.progress, refs);
  }

  const actions = document.createElement("div");
  actions.className = "queue-actions";

  if (item.status === "done" && item.outputPath) {
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "icon-btn";
    reveal.textContent = "⤴";
    reveal.title = "Mostrar no Finder";
    reveal.addEventListener("click", () => void api.reveal(item.outputPath!));
    actions.append(reveal);
  }

  const active = isActiveDownload(item);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-btn";
  remove.textContent = "×";
  remove.title = active ? "Cancelar" : "Tirar da lista";
  remove.addEventListener("click", () => {
    if (active) void api.cancelDownload(item.id);
    else void refreshDownloads(api.removeDownload(item.id));
  });
  actions.append(remove);

  row.append(badge, body, actions);
  return row;
}

function setDownloadTab(tab: "active" | "done"): void {
  downloadTab = tab;
  renderDownloads();
}

function renderDownloads(): void {
  downloadRefs.clear();
  dom.downloadList.textContent = "";

  const active = downloads.filter(isActiveDownload);
  const finished = downloads.filter((item) => !isActiveDownload(item));
  const shown = downloadTab === "active" ? active : finished;

  dom.countActive.textContent = active.length > 0 ? `(${active.length})` : "";
  dom.countDone.textContent = finished.length > 0 ? `(${finished.length})` : "";
  dom.navBadge.hidden = active.length === 0;
  dom.navBadge.textContent = String(active.length);

  for (const [button, tab] of [[dom.tabActive, "active"], [dom.tabDone, "done"]] as const) {
    button.classList.toggle("active", downloadTab === tab);
    button.setAttribute("aria-selected", String(downloadTab === tab));
  }

  dom.downloadList.hidden = shown.length === 0;
  dom.downloadEmpty.hidden = shown.length > 0;
  if (downloadTab === "active") {
    dom.downloadEmptyTitle.textContent = "Nenhum download em andamento";
    dom.downloadEmptyHint.textContent = "Cole o link de um vídeo acima para começar.";
  } else {
    dom.downloadEmptyTitle.textContent = "Nada concluído ainda";
    dom.downloadEmptyHint.textContent = "Os downloads terminados aparecem aqui.";
  }

  dom.downloadCancelAll.hidden = downloadTab !== "active" || active.length === 0;
  dom.downloadClear.hidden = downloadTab !== "done" || finished.length === 0;

  for (const item of shown) dom.downloadList.append(buildDownloadRow(item));
}

async function refreshDownloads(source: Promise<UiDownloadItem[]>): Promise<void> {
  try {
    downloads = await source;
    renderDownloads();
  } catch (error) {
    setDownloadMessage(describeError(error));
  }
}

function onDownloadChanged(updated: UiDownloadItem): void {
  const index = downloads.findIndex((item) => item.id === updated.id);
  if (index >= 0) downloads[index] = updated;
  else downloads.push(updated);
  renderDownloads();
}

function onDownloadProgress({ itemId, progress }: { itemId: string; progress: UiDownloadProgress }): void {
  const item = downloads.find((entry) => entry.id === itemId);
  if (!item) return;
  item.progress = progress;

  if (progress.formatId) {
    const seen = downloadStreams.get(itemId) ?? [];
    if (!seen.includes(progress.formatId)) seen.push(progress.formatId);
    downloadStreams.set(itemId, seen);
  }

  const refs = downloadRefs.get(itemId);
  if (refs) applyDownloadProgress(item, progress, refs);
}

function applyDownloadProgress(
  item: UiDownloadItem,
  progress: UiDownloadProgress,
  refs: { fill: HTMLElement; text: HTMLElement },
): void {
  refs.fill.classList.toggle("indeterminate", progress.fraction == null);
  if (progress.fraction != null) refs.fill.style.width = `${(progress.fraction * 100).toFixed(1)}%`;
  refs.text.textContent = describeDownloadProgress(item, progress);
}

/** Mensagem no topo do downloader: erro de link, ou yt-dlp ausente. */
function setDownloadMessage(text: string | null): void {
  dom.ytdlpMissing.hidden = !text;
  dom.ytdlpMissing.textContent = "";
  if (text) showNoteIn(dom.ytdlpMissing, "warning", "download", text);
}

function showNoteIn(container: HTMLElement, severity: Severity, field: string, message: string): void {
  const div = document.createElement("div");
  div.className = `note ${severity}`;
  const label = document.createElement("span");
  label.className = "note-field";
  label.textContent = field;
  const text = document.createElement("span");
  text.textContent = message;
  div.append(label, text);
  container.append(div);
}

// --- janela de opcoes -------------------------------------------------------

let dialogInfo: UiMediaInfo | null = null;

/** MB decimal, como o YouTube e a referencia mostram (119,9 MB), nao MiB. */
function sizeLabel(bytes: number | undefined, approximate = false): string {
  if (!bytes) return "—";
  const mb = bytes / 1_000_000;
  const text = mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  return approximate ? `~${text}` : text;
}

function addOptionRow(
  container: HTMLElement,
  value: string,
  columns: [string, string, string],
  checked: boolean,
): void {
  const row = document.createElement("label");
  row.className = "dd-option";

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "dd-quality";
  radio.value = value;
  radio.checked = checked;

  const [format, detail, size] = columns;
  const formatCell = document.createElement("span");
  formatCell.textContent = format;
  const detailCell = document.createElement("span");
  detailCell.textContent = detail;
  const sizeCell = document.createElement("span");
  sizeCell.className = "dd-size";
  sizeCell.textContent = size;

  row.append(radio, formatCell, detailCell, sizeCell);
  container.append(row);
}

/** Qual linha vem marcada: a escolha anterior, ou a maior resolucao. */
function defaultChoice(info: UiMediaInfo): string {
  const saved = downloadChoices.quality;
  if (saved === "audio") return `audio:${downloadChoices.audioFormat}`;
  if (info.videoOptions.length === 0) return "best";

  const wanted = saved === "best" ? Infinity : Number(saved);
  const fits = info.videoOptions.find((option) => option.height <= wanted);
  return String((fits ?? info.videoOptions[info.videoOptions.length - 1]!).height);
}

function openDownloadDialog(info: UiMediaInfo): void {
  dialogInfo = info;
  dom.ddTitle.textContent = info.title;
  dom.ddTitle.title = info.title;
  dom.ddMeta.textContent = [
    info.uploader,
    info.durationSeconds ? formatDuration(info.durationSeconds) : null,
  ].filter(Boolean).join(" · ");

  const chosen = defaultChoice(info);

  dom.ddVideo.textContent = "";
  if (info.videoOptions.length === 0) {
    addOptionRow(dom.ddVideo, "best", ["MP4", "melhor qualidade", "—"], chosen === "best");
  }
  for (const option of info.videoOptions) {
    addOptionRow(
      dom.ddVideo,
      String(option.height),
      ["MP4", `${option.height}p`, sizeLabel(option.sizeBytes, true)],
      chosen === String(option.height),
    );
  }

  dom.ddAudio.textContent = "";
  const abr = info.audioBitrateKbps ? `${info.audioBitrateKbps} kbps` : "original";
  addOptionRow(dom.ddAudio, "audio:mp3", ["MP3", "alta qualidade", sizeLabel(info.audioSizeBytes, true)], chosen === "audio:mp3");
  addOptionRow(dom.ddAudio, "audio:original", ["Original", abr, sizeLabel(info.audioSizeBytes, true)], chosen === "audio:original");

  dom.ddThumbnail.checked = downloadChoices.thumbnail;

  const hasSubs = info.subtitles.length > 0;
  dom.ddSubs.hidden = !hasSubs;
  dom.ddSubsNone.hidden = hasSubs;
  dom.ddSubsLang.textContent = "";
  for (const sub of info.subtitles) {
    const option = document.createElement("option");
    option.value = sub.code;
    option.textContent = sub.auto ? `${sub.name} (automática)` : sub.name;
    dom.ddSubsLang.append(option);
  }
  // preferencia de idioma: portugues, depois ingles, senao o primeiro da lista
  const preferred =
    info.subtitles.find((sub) => sub.code.startsWith("pt")) ??
    info.subtitles.find((sub) => sub.code.startsWith("en"));
  if (preferred) dom.ddSubsLang.value = preferred.code;
  dom.ddSubsOn.checked = hasSubs && downloadChoices.subtitles;

  dom.ddRemember.checked = false;
  dom.dialog.showModal();
}

function closeDownloadDialog(): void {
  dialogInfo = null;
  if (dom.dialog.open) dom.dialog.close();
}

async function addDownloadNow(
  url: string,
  choices: { quality: DownloadQuality; audioFormat: AudioFormat; thumbnail: boolean; subtitleLang: string | null },
): Promise<void> {
  try {
    downloads = await api.addDownload({
      url,
      quality: choices.quality,
      audioFormat: choices.audioFormat,
      thumbnail: choices.thumbnail,
      subtitleLang: choices.subtitleLang,
      addToConversionQueue: dom.downloadToQueue.checked,
    });
    dom.downloadUrl.value = "";
    setDownloadMessage(null);
    setDownloadTab("active");
  } catch (error) {
    setDownloadMessage(describeError(error));
  }
}

async function confirmDownloadDialog(): Promise<void> {
  const info = dialogInfo;
  if (!info) return;

  const picked = dom.dialog.querySelector<HTMLInputElement>('input[name="dd-quality"]:checked');
  const value = picked?.value ?? "best";
  const isAudio = value.startsWith("audio:");

  const choices = {
    quality: isAudio ? "audio" : value,
    audioFormat: (isAudio ? value.slice("audio:".length) : downloadChoices.audioFormat) as AudioFormat,
    thumbnail: dom.ddThumbnail.checked,
    subtitleLang:
      info.subtitles.length > 0 && dom.ddSubsOn.checked ? dom.ddSubsLang.value : null,
  };

  downloadChoices.quality = choices.quality;
  downloadChoices.audioFormat = choices.audioFormat;
  downloadChoices.thumbnail = choices.thumbnail;
  downloadChoices.subtitles = choices.subtitleLang != null;
  if (dom.ddRemember.checked) downloadChoices.askFirst = false;
  dom.downloadAsk.checked = downloadChoices.askFirst;

  void api.writePreferences({
    downloadQuality: choices.quality,
    downloadAudioFormat: choices.audioFormat,
    downloadThumbnail: choices.thumbnail,
    downloadSubtitles: choices.subtitleLang != null,
    skipDownloadDialog: !downloadChoices.askFirst,
  });

  closeDownloadDialog();
  await addDownloadNow(info.url, choices);
}

async function submitDownload(): Promise<void> {
  const url = dom.downloadUrl.value.trim();
  if (!url) return;
  setDownloadMessage(null);

  // sem janela: usa as escolhas anteriores (legenda precisa da janela: o
  // idioma so se sabe depois de analisar o link)
  if (!downloadChoices.askFirst) {
    await addDownloadNow(url, {
      quality: downloadChoices.quality,
      audioFormat: downloadChoices.audioFormat,
      thumbnail: downloadChoices.thumbnail,
      subtitleLang: null,
    });
    return;
  }

  dom.downloadGo.disabled = true;
  dom.downloadGo.textContent = "Analisando…";
  try {
    const info = await api.analyzeDownload(url);
    if (info.isLive) setDownloadMessage("transmissão ao vivo não é suportada");
    else openDownloadDialog(info);
  } catch (error) {
    setDownloadMessage(describeError(error));
  } finally {
    dom.downloadGo.disabled = false;
    dom.downloadGo.textContent = "Adicionar";
  }
}

function showYtDlpVersion(version: string | undefined): void {
  dom.ytdlpUpdate.textContent = `yt-dlp ${version ?? ""}`.trim();
}

async function checkYtDlpUpdate(): Promise<void> {
  dom.ytdlpUpdate.disabled = true;
  dom.ytdlpUpdate.textContent = "Verificando…";
  try {
    const result = await api.updateYtDlp();
    showYtDlpVersion(result.to);
    dom.ytdlpUpdate.title = result.updated
      ? `Atualizado de ${result.from} para ${result.to}`
      : "Você já tem o yt-dlp mais novo";
    if (!result.updated) dom.ytdlpUpdate.textContent = `yt-dlp ${result.to} ✓`;
  } catch (error) {
    dom.ytdlpUpdate.textContent = "Falhou — tentar de novo";
    dom.ytdlpUpdate.title = describeError(error);
  } finally {
    dom.ytdlpUpdate.disabled = false;
  }
}

async function checkAppUpdate(): Promise<void> {
  const info = await api.checkAppUpdate();
  if (!info.available || !info.url) return; // sem internet ou sem versao nova: silencio
  dom.updateTitle.textContent = `Versão ${info.latest} disponível`;
  dom.updateSub.textContent = `Você está na ${info.current}.`;
  dom.updateOpen.onclick = () => void api.openUpdatePage(info.url!);
  dom.updateBanner.hidden = false;
}

async function initDownloads(): Promise<void> {
  const ytdlp = await api.getYtDlp();
  if (!ytdlp.available) {
    // sem o yt-dlp o resto do app funciona igual; so o download fica indisponivel
    setDownloadMessage("yt-dlp não encontrado. Instale com: brew install yt-dlp  (depois reabra o app).");
    dom.downloadUrl.disabled = true;
    dom.downloadGo.disabled = true;
    return;
  }
  dom.downloadGo.title = `yt-dlp ${ytdlp.version ?? ""}`.trim();
  showYtDlpVersion(ytdlp.version);
  dom.downloadDir.textContent = await api.getDownloadDir();
  await refreshDownloads(api.listDownloads());
}

// --------------------------------------------------------------------------- //

function wireEvents(): void {
  dom.env.addEventListener("click", () => {
    dom.aboutStatus.textContent = "";
    dom.aboutDialog.showModal();
  });
  for (const id of ["about-close", "about-ok"]) {
    el(id).addEventListener("click", () => dom.aboutDialog.close());
  }
  let aboutUpdateUrl: string | null = null;
  dom.aboutCheck.addEventListener("click", async () => {
    if (aboutUpdateUrl) {
      void api.openUpdatePage(aboutUpdateUrl);
      return;
    }
    dom.aboutCheck.disabled = true;
    dom.aboutStatus.textContent = "Procurando…";
    try {
      const info = await api.checkAppUpdate();
      if (info.error) dom.aboutStatus.textContent = "Não consegui verificar agora (sem internet?).";
      else if (info.available && info.url) {
        dom.aboutStatus.textContent = `Versão ${info.latest} disponível.`;
        dom.aboutCheck.textContent = "Baixar";
        aboutUpdateUrl = info.url;
      } else dom.aboutStatus.textContent = "Você está na versão mais nova. ✓";
    } finally {
      dom.aboutCheck.disabled = false;
    }
  });
  dom.ytdlpUpdate.addEventListener("click", () => void checkYtDlpUpdate());
  dom.updateDismiss.addEventListener("click", () => {
    dom.updateBanner.hidden = true;
  });
  api.onYtDlpUpdated((result) => {
    showYtDlpVersion(result.to);
    dom.ytdlpUpdate.title = `Atualizado sozinho de ${result.from} para ${result.to}`;
  });

  dom.navConverter.addEventListener("click", () => showView("converter"));
  dom.navDownloader.addEventListener("click", () => showView("downloader"));

  dom.formatSelect.addEventListener("change", () => {
    void selectFormat(Number(dom.formatSelect.value));
  });
  dom.presetSelect.addEventListener("change", () => {
    const value = dom.presetSelect.value;
    void selectPreset(value === "" ? null : Number(value));
  });

  dom.addFiles.addEventListener("click", () => void refreshQueue(api.addFilesDialog()));
  dom.clearQueue.addEventListener("click", () => void refreshQueue(api.clearQueue()));
  dom.clearFinished.addEventListener("click", () => void refreshQueue(api.clearFinished()));

  dom.pickDir.addEventListener("click", async () => {
    const dir = await api.pickOutputDir();
    if (dir) {
      state.outputDir = dir;
      void api.writePreferences({ outputDir: dir });
      await refreshResolved();
    }
  });

  dom.resetDir.addEventListener("click", async () => {
    state.outputDir = null;
    void api.writePreferences({ outputDir: null });
    await refreshResolved();
  });

  for (const field of CHOICE_FIELDS) {
    el<HTMLSelectElement>(field).addEventListener("change", async (event) => {
      const raw = (event.target as HTMLSelectElement).value;
      (state.overrides as Record<string, unknown>)[field] =
        NUMERIC_FIELDS.has(field) ? Number(raw) : raw;
      await refreshResolved();
    });
  }

  dom.preferHardware.addEventListener("change", () => {
    void api.writePreferences({ preferHardware: dom.preferHardware.checked });
    void refreshResolved();
  });
  dom.allowPassthrough.addEventListener("change", () => {
    void api.writePreferences({ allowPassthrough: dom.allowPassthrough.checked });
    void refreshResolved();
  });
  dom.clearOnDone.addEventListener("change", () => {
    state.clearFinishedOnDone = dom.clearOnDone.checked;
    void api.writePreferences({ clearFinishedOnDone: dom.clearOnDone.checked });
  });

  dom.fitMode.addEventListener("change", () => {
    void api.writePreferences({ fitMode: dom.fitMode.value as FitMode });
    void refreshResolved();
  });

  dom.convert.addEventListener("click", () => void startQueue());
  dom.cancelAll.addEventListener("click", () => void api.cancelAll());

  // arrastar e soltar (varios arquivos de uma vez)
  for (const type of ["dragenter", "dragover"]) {
    dom.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dom.dropzone.classList.add("over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    dom.dropzone.addEventListener(type, () => dom.dropzone.classList.remove("over"));
  }
  dom.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = (event as DragEvent).dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Electron 32+ removeu File.path; o caminho vem do preload via webUtils
    const paths = Array.from(files)
      .map((file) => api.getPathForFile(file))
      .filter(Boolean);

    if (paths.length > 0) void refreshQueue(api.addPaths(paths));
    else showNote("warning", "arquivo", "não consegui obter o caminho dos arquivos arrastados");
  });

  dom.downloadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitDownload();
  });
  dom.tabActive.addEventListener("click", () => setDownloadTab("active"));
  dom.tabDone.addEventListener("click", () => setDownloadTab("done"));

  dom.downloadToQueue.addEventListener("change", () => {
    void api.writePreferences({ sendDownloadsToQueue: dom.downloadToQueue.checked });
  });
  dom.downloadAsk.addEventListener("change", () => {
    downloadChoices.askFirst = dom.downloadAsk.checked;
    void api.writePreferences({ skipDownloadDialog: !dom.downloadAsk.checked });
  });
  dom.downloadPickDir.addEventListener("click", async () => {
    const dir = await api.pickOutputDir();
    if (dir) {
      await api.writePreferences({ downloadDir: dir });
      dom.downloadDir.textContent = dir;
    }
  });
  dom.downloadClear.addEventListener("click", () => void refreshDownloads(api.clearFinishedDownloads()));
  dom.downloadCancelAll.addEventListener("click", () => void api.cancelAllDownloads());

  dom.ddGo.addEventListener("click", () => void confirmDownloadDialog());
  dom.ddCancel.addEventListener("click", closeDownloadDialog);
  dom.ddClose.addEventListener("click", closeDownloadDialog);
  dom.dialog.addEventListener("close", () => { dialogInfo = null; });

  api.onDownloadChanged(onDownloadChanged);
  api.onDownloadProgress(onDownloadProgress);
  api.onQueueRefresh(() => void refreshQueue(api.listQueue()));

  api.onItemChanged(onItemChanged);
  api.onItemProgress(onItemProgress);
  api.onBatchDone((summary) => void onBatchDone(summary));
  api.onItemLog(({ itemId, line }) => {
    const item = state.items.find((entry) => entry.id === itemId);
    const prefix = item && state.items.length > 1 ? `[${item.fileName}] ` : "";
    appendLog(`${prefix}${line}`);
  });
}

async function applyPreferences(): Promise<Preferences | null> {
  let prefs: Preferences;
  try {
    prefs = await api.readPreferences();
  } catch {
    return null; // preferencias sao conveniencia; sem elas o app funciona igual
  }

  dom.preferHardware.checked = prefs.preferHardware;
  dom.allowPassthrough.checked = prefs.allowPassthrough;
  dom.fitMode.value = prefs.fitMode;
  state.outputDir = prefs.outputDir;
  state.clearFinishedOnDone = prefs.clearFinishedOnDone;
  dom.clearOnDone.checked = prefs.clearFinishedOnDone;
  downloadChoices.quality = prefs.downloadQuality;
  downloadChoices.audioFormat = prefs.downloadAudioFormat;
  downloadChoices.thumbnail = prefs.downloadThumbnail;
  downloadChoices.subtitles = prefs.downloadSubtitles;
  downloadChoices.askFirst = !prefs.skipDownloadDialog;
  dom.downloadAsk.checked = downloadChoices.askFirst;
  dom.downloadToQueue.checked = prefs.sendDownloadsToQueue;

  return prefs;
}

/** Volta ao ultimo formato/preset; sem historico, comeca em MP4. */
async function restoreTarget(prefs: Preferences | null): Promise<void> {
  const allFormats = state.formatGroups.flatMap((group) => group.items);
  let formatId: number | null = null;
  let presetId: number | null = null;

  if (prefs?.lastProfileId != null) {
    const preset = state.groups
      .flatMap((group) => group.items)
      .find((item) => item.profileId === prefs.lastProfileId);
    if (preset) {
      presetId = preset.profileId;
      formatId = preset.formatId ?? DEVICES_FORMAT;
    }
  }

  const known = (id: number): boolean =>
    id === DEVICES_FORMAT ? presetsForFormat(DEVICES_FORMAT).length > 0 : allFormats.some((f) => f.formatId === id);

  if (formatId == null && prefs?.lastFormatId != null && known(prefs.lastFormatId)) {
    formatId = prefs.lastFormatId;
  }
  if (formatId == null) {
    formatId = (allFormats.find((f) => f.title === "MP4") ?? allFormats[0])?.formatId ?? null;
  }
  if (formatId != null) await selectFormat(formatId, presetId);
}

async function boot(): Promise<void> {
  wireEvents();

  try {
    const env = await api.getEnvironment();
    dom.env.textContent = `Versão ${env.appVersion}`;
    dom.env.title = "Sobre o app";
    dom.aboutVersion.textContent = `VideoImagem Downloader ${env.appVersion}`;
    dom.aboutDetail.textContent = [
      env.version.replace(/^ffmpeg version /, "ffmpeg ").split("  ")[0],
      `${env.encoderCount} encoders · VideoToolbox ${env.hasVideoToolbox ? "sim" : "não"}`,
    ].join("\n");
    dom.aboutDetail.title = `${env.ffmpeg}\n${env.ffprobe}\ndata: ${env.dataDir}`;
  } catch (error) {
    dom.env.classList.add("error");
    dom.env.textContent = describeError(error);
  }

  try {
    state.groups = await api.listPresets();
    state.formatGroups = await api.listFormats();
    renderFormatSelect();
  } catch (error) {
    showNote("warning", "formatos", describeError(error));
  }

  const prefs = await applyPreferences();
  await restoreTarget(prefs);
  await refreshQueue(api.listQueue());

  try {
    await initDownloads();
  } catch (error) {
    setDownloadMessage(describeError(error));
  }

  void checkAppUpdate().catch(() => {});
}

void boot();
