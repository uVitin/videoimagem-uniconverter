/**
 * Preferencias que sobrevivem ao fechar o app.
 *
 * Guardadas em userData/preferences.json. Tudo e opcional e tudo tem padrao:
 * um arquivo corrompido ou de uma versao antiga nunca impede o app de abrir.
 */

import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isDownloadQuality, type DownloadQuality } from "../engine/ytdlp";

export interface Preferences {
  lastProfileId: number | null;
  outputDir: string | null;
  preferHardware: boolean;
  allowPassthrough: boolean;
  fitMode: "fit" | "fill" | "stretch";
  /** tirar da lista o que ja converteu, assim que o lote termina */
  clearFinishedOnDone: boolean;
  /** onde salvar os downloads; null = pasta Downloads do sistema */
  downloadDir: string | null;
  downloadQuality: DownloadQuality;
  /** mandar o que baixou direto para a fila de conversao */
  sendDownloadsToQueue: boolean;
}

const DEFAULTS: Preferences = {
  lastProfileId: null,
  outputDir: null,
  preferHardware: false,
  allowPassthrough: true,
  fitMode: "fit",
  clearFinishedOnDone: false,
  downloadDir: null,
  downloadQuality: "best",
  sendDownloadsToQueue: false,
};

const FIT_MODES = new Set(["fit", "fill", "stretch"]);

function filePath(): string {
  return join(app.getPath("userData"), "preferences.json");
}

/** Aceita so o que tem o tipo certo; o resto cai no padrao. */
function sanitize(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULTS };
  const input = raw as Record<string, unknown>;

  return {
    lastProfileId:
      typeof input.lastProfileId === "number" ? input.lastProfileId : DEFAULTS.lastProfileId,
    outputDir: typeof input.outputDir === "string" ? input.outputDir : DEFAULTS.outputDir,
    preferHardware:
      typeof input.preferHardware === "boolean" ? input.preferHardware : DEFAULTS.preferHardware,
    allowPassthrough:
      typeof input.allowPassthrough === "boolean"
        ? input.allowPassthrough
        : DEFAULTS.allowPassthrough,
    fitMode:
      typeof input.fitMode === "string" && FIT_MODES.has(input.fitMode)
        ? (input.fitMode as Preferences["fitMode"])
        : DEFAULTS.fitMode,
    clearFinishedOnDone:
      typeof input.clearFinishedOnDone === "boolean"
        ? input.clearFinishedOnDone
        : DEFAULTS.clearFinishedOnDone,
    downloadDir:
      typeof input.downloadDir === "string" ? input.downloadDir : DEFAULTS.downloadDir,
    downloadQuality: isDownloadQuality(input.downloadQuality)
      ? input.downloadQuality
      : DEFAULTS.downloadQuality,
    sendDownloadsToQueue:
      typeof input.sendDownloadsToQueue === "boolean"
        ? input.sendDownloadsToQueue
        : DEFAULTS.sendDownloadsToQueue,
  };
}

let cached: Preferences | null = null;

export function readPreferences(): Preferences {
  if (cached) return { ...cached };
  try {
    cached = sanitize(JSON.parse(readFileSync(filePath(), "utf8")));
  } catch {
    cached = { ...DEFAULTS }; // primeira execucao, ou arquivo ilegivel
  }
  return { ...cached };
}

export function writePreferences(patch: Partial<Preferences>): Preferences {
  const merged = sanitize({ ...readPreferences(), ...patch });
  cached = merged;
  try {
    writeFileSync(filePath(), JSON.stringify(merged, null, 2), "utf8");
  } catch {
    // disco cheio ou sem permissao: perder preferencia nao justifica travar o app
  }
  return { ...merged };
}
