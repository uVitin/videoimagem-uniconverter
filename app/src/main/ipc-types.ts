/** Contrato entre o processo principal e o renderer. Compartilhado pelos dois. */

export interface PresetListItem {
  profileId: number;
  /** formato (Format.pro) a que o preset pertence; null = preset de dispositivo sem tabela */
  formatId: number | null;
  title: string;
  container: string;
  videoEncoder: string | null;
  audioEncoder: string | null;
  resolutionLabel: string | null;
  /** 'encoder_fallback' = sem tabela de capacidades */
  linkPath: string;
}

/** Um formato de saida (o "Formato" do seletor): container + capacidades. */
export interface FormatListItem {
  formatId: number;
  title: string;
  /** com ponto: ".mp4" */
  extension: string;
  categoryId: number;
  categoryTitle: string;
  /** quantos presets de dispositivo/plataforma apontam para este formato */
  presetCount: number;
}

export interface FormatGroup {
  categoryId: number;
  categoryTitle: string;
  items: FormatListItem[];
}

export interface PresetGroup {
  categoryId: number;
  categoryTitle: string;
  items: PresetListItem[];
}

export interface Option<T> {
  value: T;
  label: string;
}

export interface ChoiceOptions {
  videoEncoders: Option<string>[];
  audioEncoders: Option<string>[];
  resolutions: Option<string>[];
  frameRates: Option<number>[];
  videoBitrates: Option<number>[];
  audioBitrates: Option<number>[];
  sampleRates: Option<number>[];
  channels: Option<number>[];
}

export interface UiChoices {
  videoEncoder: string | null;
  audioEncoder: string | null;
  resolution: string | null;
  frameRate: number | null;
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
}

export interface UiNote {
  field: string;
  severity: "info" | "adjusted" | "warning";
  message: string;
}

export interface UiPassthrough {
  video: boolean;
  audio: boolean;
  videoReason: string;
  audioReason: string;
}

export interface UiSourceInfo {
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

export interface ResolveResponse {
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

export interface ResolveRequestPayload {
  /** null = "Personalizado": parte dos padroes do formato, sem preset */
  profileId: number | null;
  /** obrigatorio quando profileId e null */
  formatId?: number | null;
  overrides?: Partial<UiChoices>;
  /** item da fila contra o qual fazer a previa; null = previa generica */
  itemId?: string | null;
  preferHardware?: boolean;
  fitMode?: "fit" | "fill" | "stretch";
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

export type QueueStatus = "pending" | "running" | "done" | "failed" | "canceled";

export interface UiQueueItem {
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

export interface UiProgress {
  fraction: number | null;
  outTimeSeconds: number;
  speed?: string;
  fps?: number;
  etaSeconds?: number | null;
  totalSizeBytes?: number;
}

export interface ItemProgressEvent {
  itemId: string;
  progress: UiProgress;
}

export interface ItemLogEvent {
  itemId: string;
  line: string;
}

export interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  canceled: number;
  elapsedSeconds: number;
}

export interface BatchSettingsPayload {
  profileId: number | null;
  formatId?: number | null;
  overrides?: Partial<UiChoices>;
  preferHardware?: boolean;
  fitMode?: "fit" | "fill" | "stretch";
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

export interface Preferences {
  lastProfileId: number | null;
  lastFormatId: number | null;
  outputDir: string | null;
  preferHardware: boolean;
  allowPassthrough: boolean;
  fitMode: "fit" | "fill" | "stretch";
  clearFinishedOnDone: boolean;
  /** onde salvar os downloads; null = pasta Downloads do sistema */
  downloadDir: string | null;
  downloadQuality: DownloadQuality;
  sendDownloadsToQueue: boolean;
  /** pular a janela de opcoes e baixar com as escolhas anteriores */
  skipDownloadDialog: boolean;
  downloadAudioFormat: AudioFormat;
  downloadThumbnail: boolean;
  downloadSubtitles: boolean;
}

/** "best", "audio" ou a altura maxima em pixels, como "1080" */
export type DownloadQuality = "best" | "audio" | `${number}`;

export type DownloadStatus = "pending" | "analyzing" | "running" | "done" | "failed" | "canceled";

export interface UiDownloadProgress {
  fraction: number | null;
  downloadedBytes: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  formatId?: string;
}

export interface UiDownloadItem {
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

export type AudioFormat = "mp3" | "original";

export interface UiVideoOption {
  height: number;
  sizeBytes?: number;
}

export interface UiSubtitleOption {
  code: string;
  name: string;
  auto: boolean;
}

/** o que a janela de opcoes de download mostra, depois de analisar o link */
export interface UiMediaInfo {
  url: string;
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnail?: string;
  videoOptions: UiVideoOption[];
  audioSizeBytes?: number;
  audioBitrateKbps?: number;
  subtitles: UiSubtitleOption[];
  isLive: boolean;
}

export interface DownloadRequestPayload {
  url: string;
  quality: DownloadQuality;
  addToConversionQueue: boolean;
  audioFormat?: AudioFormat;
  thumbnail?: boolean;
  subtitleLang?: string | null;
}

export interface DownloadProgressEvent {
  itemId: string;
  progress: UiDownloadProgress;
}

/** ausente quando o yt-dlp nao esta instalado */
export interface YtDlpInfo {
  available: boolean;
  path?: string;
  version?: string;
  /** o que fazer para resolver, quando indisponivel */
  hint?: string;
}

export interface AppUpdateInfo {
  available: boolean;
  current: string;
  latest?: string;
  url?: string;
  notes?: string;
  /** falha ao consultar (sem internet etc.); nao e erro para o usuario */
  error?: string;
}

export interface YtDlpUpdateInfo {
  updated: boolean;
  from: string;
  to: string;
}

export interface EnvironmentInfo {
  appVersion: string;
  ffmpeg: string;
  ffprobe: string;
  version: string;
  dataDir: string;
  encoderCount: number;
  hasVideoToolbox: boolean;
}
