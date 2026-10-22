/** Contrato entre o processo principal e o renderer. Compartilhado pelos dois. */

export interface PresetListItem {
  profileId: number;
  title: string;
  container: string;
  videoEncoder: string | null;
  audioEncoder: string | null;
  resolutionLabel: string | null;
  /** 'encoder_fallback' = sem tabela de capacidades */
  linkPath: string;
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
  profileId: number;
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
  profileId: number;
  overrides?: Partial<UiChoices>;
  preferHardware?: boolean;
  fitMode?: "fit" | "fill" | "stretch";
  allowPassthrough?: boolean;
  outputDir?: string | null;
}

export interface Preferences {
  lastProfileId: number | null;
  outputDir: string | null;
  preferHardware: boolean;
  allowPassthrough: boolean;
  fitMode: "fit" | "fill" | "stretch";
  clearFinishedOnDone: boolean;
}

export interface EnvironmentInfo {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  dataDir: string;
  encoderCount: number;
  hasVideoToolbox: boolean;
}
