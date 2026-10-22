/** Ciclo de vida do app e da janela. A logica de IPC fica em ipc.ts. */

import { BrowserWindow, app, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadDatabase, type PresetDatabase } from "../engine/data";
import { registerIpc, shutdownQueue } from "./ipc";

let db: PresetDatabase;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verificacao automatica da interface: VIDEOIMAGEM_SMOKE=<arquivo.png> abre o
 * app, salva uma captura da janela e sai. VIDEOIMAGEM_SMOKE_EVAL roda um
 * trecho de JS antes da captura, para deixar a tela num estado especifico.
 */
function installSmokeCapture(window: BrowserWindow): void {
  const smokePath = process.env.VIDEOIMAGEM_SMOKE;
  if (!smokePath) return;

  window.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      const setup = process.env.VIDEOIMAGEM_SMOKE_EVAL;
      const delay = Number(process.env.VIDEOIMAGEM_SMOKE_DELAY ?? "1200");
      const prepared = setup
        ? window.webContents.executeJavaScript(setup, true).then(() => wait(delay))
        : Promise.resolve();

      void prepared
        .then(() => window.webContents.capturePage())
        .then((image: Electron.NativeImage) => writeFile(smokePath, image.toPNG()))
        .then(() => app.exit(0))
        .catch((error: unknown) => {
          console.error("smoke falhou:", error);
          app.exit(1);
        });
    }, 2500); // tempo para ffmpeg -encoders e a lista de presets chegarem
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 960,
    minHeight: 680,
    title: "Videoimagem UniConverter",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#16181d",
    // so mostra quando a pagina estiver pronta, para nao piscar branco
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    dialog.showErrorBox("Falha ao carregar a interface", `${description} (${code})\n${url}`);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    dialog.showErrorBox("A interface travou", details.reason);
  });

  installSmokeCapture(window);
  void window.loadFile(join(__dirname, "..", "renderer", "index.html"));

  return window;
}

// --------------------------------------------------------------------------- //

app.whenReady().then(
  () => {
    try {
      db = loadDatabase();
    } catch (error) {
      dialog.showErrorBox(
        "Banco de presets nao encontrado",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
      return;
    }

    registerIpc({ db, window: createWindow() });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        registerIpc({ db, window: createWindow() });
      }
    });
  },
  (error: unknown) => {
    dialog.showErrorBox("Falha ao iniciar", String(error));
    app.quit();
  },
);

app.on("before-quit", () => shutdownQueue());

app.on("window-all-closed", () => {
  shutdownQueue();
  if (process.platform !== "darwin") app.quit();
});
