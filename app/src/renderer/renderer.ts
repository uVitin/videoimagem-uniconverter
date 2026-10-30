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
  title: string;
  container: string;
  videoEncoder: string | null;
  audioEncoder: string | null;
  resolutionLabel: string | null;
  linkPath: string;
}

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
  profileId: number;
  overrides?: Partial<UiChoices>;
  itemId?: string | null;
  preferHardware?: boolean;
  fitMode?: FitMode;
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

interface BatchSettingsPayload {
  profileId: number;
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

type DownloadQuality = "best" | "2160" | "1440" | "1080" | "720" | "480" | "audio";
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

interface YtDlpInfo { available: boolean; path?: string; version?: string; hint?: string; }

interface Preferences {
  lastProfileId: number | null;
  outputDir: string | null;
  preferHardware: boolean;
  allowPassthrough: boolean;
  fitMode: FitMode;
  clearFinishedOnDone: boolean;
  downloadDir: string | null;
  downloadQuality: DownloadQuality;
  sendDownloadsToQueue: boolean;
}

interface EnvironmentInfo {
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
  getYtDlp(): Promise<YtDlpInfo>;
  listDownloads(): Promise<UiDownloadItem[]>;
  addDownload(payload: { url: string; quality: DownloadQuality; addToConversionQueue: boolean }): Promise<UiDownloadItem[]>;
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
  search: el<HTMLInputElement>("preset-search"),
  presetList: el("preset-list"),
  presetCount: el("preset-count"),
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
  downloadForm: el<HTMLFormElement>("download-form"),
  downloadUrl: el<HTMLInputElement>("download-url"),
  downloadQuality: el<HTMLSelectElement>("download-quality"),
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
  filter: string;
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
  filter: "",
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
// presets

function matchesFilter(item: PresetListItem, filter: string): boolean {
  if (!filter) return true;
  const haystack = [
    item.title, item.container, item.videoEncoder ?? "",
    item.audioEncoder ?? "", item.resolutionLabel ?? "",
  ].join(" ").toLowerCase();
  return filter.toLowerCase().split(/\s+/).filter(Boolean)
    .every((term) => haystack.includes(term));
}

function renderPresets(): void {
  dom.presetList.textContent = "";
  let shown = 0;

  for (const group of state.groups) {
    const items = group.items.filter((item) => matchesFilter(item, state.filter));
    if (items.length === 0) continue;

    const title = document.createElement("div");
    title.className = "preset-group-title";
    title.textContent = `${group.categoryTitle} · ${items.length}`;
    dom.presetList.append(title);

    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-item";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(item.profileId === state.selectedPresetId));
      button.dataset.presetId = String(item.profileId);

      const name = document.createElement("span");
      name.className = "preset-name";
      name.textContent = item.title;

      const meta = document.createElement("span");
      meta.className = "preset-meta";
      meta.textContent = [
        item.container.replace(".", "").toUpperCase(),
        item.videoEncoder,
        item.resolutionLabel,
      ].filter(Boolean).join(" · ");

      button.append(name, meta);
      button.addEventListener("click", () => void selectPreset(item.profileId));
      dom.presetList.append(button);
      shown += 1;
    }
  }

  const total = state.groups.reduce((sum, group) => sum + group.items.length, 0);
  dom.presetCount.textContent = state.filter ? `${shown} de ${total} presets` : `${total} presets`;
}

function scrollSelectedPresetIntoView(): void {
  const selected = dom.presetList.querySelector('[aria-selected="true"]');
  selected?.scrollIntoView({ block: "nearest" });
}

async function selectPreset(profileId: number): Promise<void> {
  state.selectedPresetId = profileId;
  state.overrides = {}; // trocar de preset zera o que o usuario tinha mexido
  renderPresets();
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
  dom.convert.disabled = pending === 0 || state.selectedPresetId == null;
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

function showNote(severity: Severity | "ok", field: string, message: string): void {
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
  if (state.selectedPresetId == null) {
    dom.settings.hidden = true;
    updateConvertButton();
    return;
  }

  let resolved: ResolveResponse;
  try {
    resolved = await api.resolvePreset({
      profileId: state.selectedPresetId,
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

  dom.targetTitle.textContent = [
    resolved.profileTitle,
    resolved.container.replace(".", "").toUpperCase(),
  ].filter(Boolean).join(" → ");
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
  if (state.selectedPresetId == null || pendingCount() === 0) return;

  logLines.length = 0;
  dom.log.textContent = "";
  dom.logBox.hidden = false;
  dom.progressFill.style.width = "0%";
  dom.progressText.textContent = "iniciando…";
  setRunning(true);

  try {
    await api.startQueue({
      profileId: state.selectedPresetId,
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
// downloads

const DOWNLOAD_STATUS_LABEL: Record<DownloadStatus, string> = {
  pending: "na fila",
  analyzing: "analisando",
  running: "baixando",
  done: "pronto",
  failed: "falhou",
  canceled: "cancelado",
};

const QUALITY_LABEL: Record<DownloadQuality, string> = {
  best: "melhor", "2160": "até 4K", "1440": "até 1440p", "1080": "até 1080p",
  "720": "até 720p", "480": "até 480p", audio: "áudio",
};

let downloads: UiDownloadItem[] = [];
const downloadRefs = new Map<string, { fill: HTMLElement; text: HTMLElement }>();
/** ids de trilha vistos por download: 'video+audio' baixa duas e a barra recomeca */
const downloadStreams = new Map<string, string[]>();

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
    meta.textContent = `${QUALITY_LABEL[item.quality]} · ${DOWNLOAD_STATUS_LABEL[item.status]}`;
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
    downloadRefs.set(item.id, { fill, text });
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

  const active = item.status === "running" || item.status === "analyzing" || item.status === "pending";
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

function renderDownloads(): void {
  downloadRefs.clear();
  dom.downloadList.textContent = "";
  dom.downloadList.hidden = downloads.length === 0;
  dom.downloadClear.hidden = !downloads.some(
    (item) => item.status === "done" || item.status === "failed" || item.status === "canceled",
  );
  for (const item of downloads) dom.downloadList.append(buildDownloadRow(item));
}

async function refreshDownloads(source: Promise<UiDownloadItem[]>): Promise<void> {
  try {
    downloads = await source;
    renderDownloads();
  } catch (error) {
    showNote("warning", "download", describeError(error));
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
  if (!refs) return;
  refs.fill.classList.toggle("indeterminate", progress.fraction == null);
  if (progress.fraction != null) refs.fill.style.width = `${(progress.fraction * 100).toFixed(1)}%`;
  refs.text.textContent = describeDownloadProgress(item, progress);
}

async function submitDownload(): Promise<void> {
  const url = dom.downloadUrl.value.trim();
  if (!url) return;
  dom.downloadGo.disabled = true;
  try {
    downloads = await api.addDownload({
      url,
      quality: dom.downloadQuality.value as DownloadQuality,
      addToConversionQueue: dom.downloadToQueue.checked,
    });
    dom.downloadUrl.value = "";
    renderDownloads();
  } catch (error) {
    showNote("warning", "download", describeError(error));
  } finally {
    dom.downloadGo.disabled = false;
  }
}

async function initDownloads(): Promise<void> {
  const ytdlp = await api.getYtDlp();
  if (!ytdlp.available) {
    // sem o yt-dlp o resto do app funciona igual; so o download fica indisponivel
    dom.ytdlpMissing.hidden = false;
    dom.ytdlpMissing.textContent =
      "yt-dlp não encontrado. Instale com: brew install yt-dlp  (depois reabra o app).";
    dom.downloadUrl.disabled = true;
    dom.downloadQuality.disabled = true;
    dom.downloadGo.disabled = true;
    return;
  }
  dom.downloadGo.title = `yt-dlp ${ytdlp.version ?? ""}`.trim();
  dom.downloadDir.textContent = await api.getDownloadDir();
  await refreshDownloads(api.listDownloads());
}

// --------------------------------------------------------------------------- //

function wireEvents(): void {
  dom.search.addEventListener("input", () => {
    state.filter = dom.search.value.trim();
    renderPresets();
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
  dom.downloadQuality.addEventListener("change", () => {
    void api.writePreferences({ downloadQuality: dom.downloadQuality.value as DownloadQuality });
  });
  dom.downloadToQueue.addEventListener("change", () => {
    void api.writePreferences({ sendDownloadsToQueue: dom.downloadToQueue.checked });
  });
  dom.downloadPickDir.addEventListener("click", async () => {
    const dir = await api.pickOutputDir();
    if (dir) {
      await api.writePreferences({ downloadDir: dir });
      dom.downloadDir.textContent = dir;
    }
  });
  dom.downloadClear.addEventListener("click", () => void refreshDownloads(api.clearFinishedDownloads()));

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

async function applyPreferences(): Promise<void> {
  let prefs: Preferences;
  try {
    prefs = await api.readPreferences();
  } catch {
    return; // preferencias sao conveniencia; sem elas o app funciona igual
  }

  dom.preferHardware.checked = prefs.preferHardware;
  dom.allowPassthrough.checked = prefs.allowPassthrough;
  dom.fitMode.value = prefs.fitMode;
  state.outputDir = prefs.outputDir;
  state.clearFinishedOnDone = prefs.clearFinishedOnDone;
  dom.clearOnDone.checked = prefs.clearFinishedOnDone;
  dom.downloadQuality.value = prefs.downloadQuality;
  dom.downloadToQueue.checked = prefs.sendDownloadsToQueue;

  if (prefs.lastProfileId != null) {
    const exists = state.groups.some((group) =>
      group.items.some((item) => item.profileId === prefs.lastProfileId),
    );
    if (exists) {
      state.selectedPresetId = prefs.lastProfileId;
      renderPresets();
      scrollSelectedPresetIntoView();
    }
  }
}

async function boot(): Promise<void> {
  wireEvents();

  try {
    const env = await api.getEnvironment();
    dom.env.textContent = [
      env.version.replace(/^ffmpeg version /, ""),
      `${env.encoderCount} encoders`,
      env.hasVideoToolbox ? "VideoToolbox ✓" : "VideoToolbox ✗",
    ].join("  ·  ");
    dom.env.title = `${env.ffmpeg}\n${env.ffprobe}\ndata: ${env.dataDir}`;
  } catch (error) {
    dom.env.classList.add("error");
    dom.env.textContent = describeError(error);
  }

  try {
    state.groups = await api.listPresets();
    renderPresets();
  } catch (error) {
    showNote("warning", "presets", describeError(error));
  }

  await applyPreferences();
  await refreshQueue(api.listQueue());

  try {
    await initDownloads();
  } catch (error) {
    showNote("warning", "download", describeError(error));
  }
}

void boot();
