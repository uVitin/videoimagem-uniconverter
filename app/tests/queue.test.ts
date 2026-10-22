/**
 * Testes da fila. Converte de verdade; pula tudo se nao houver ffmpeg.
 *
 * ConversionQueue nao importa nada do Electron de proposito -- e justamente
 * isso que permite testa-la aqui, sem subir uma janela.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { availableEncoders, resolveBinaries, type Binaries } from "../src/engine/binaries";
import { loadDatabase, type PresetDatabase } from "../src/engine/data";
import { probeFile } from "../src/engine/probe";
import {
  ConversionQueue,
  buildOutputPath,
  type BatchSettings,
  type QueueItem,
} from "../src/main/queue";

const run = promisify(execFile);

let db: PresetDatabase;
let binaries: Binaries | null = null;
let encoders = new Set<string>();
let workDir = "";
let mp4Id = 0;

/** Caminhos das amostras, cada uma com uma resolucao diferente. */
const samples: Record<string, string> = {};

async function makeSample(name: string, size: string, seconds: number): Promise<string> {
  const path = join(workDir, `${name}.mp4`);
  await run(binaries!.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc=size=${size}:rate=25:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-shortest", path,
  ]);
  return path;
}

before(async () => {
  db = loadDatabase();
  mp4Id = db.formats.find((f) => f.title === "MP4")!.id;
  try {
    binaries = await resolveBinaries();
    encoders = await availableEncoders(binaries.ffmpeg);
  } catch {
    binaries = null;
    return;
  }

  workDir = await mkdtemp(join(tmpdir(), "videoimagem-queue-"));
  samples.pequeno = await makeSample("pequeno", "320x240", 2);
  samples.medio = await makeSample("medio", "640x480", 2);
  samples.quebrado = join(workDir, "quebrado.mp4");
  await writeFile(samples.quebrado, "isto nao e um video");
});

after(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

function skip(): string | null {
  return binaries ? null : "ffmpeg nao esta instalado neste sistema";
}

/** Fila sem efeitos colaterais, guardando os eventos para inspecao. */
function makeQueue(): { queue: ConversionQueue; changes: QueueItem[]; logs: string[] } {
  const changes: QueueItem[] = [];
  const logs: string[] = [];
  const queue = new ConversionQueue(
    { db, ffmpegPath: binaries!.ffmpeg, encoders },
    {
      onItemChanged: (item) => changes.push(item),
      onProgress: () => {},
      onLog: (_id, line) => logs.push(line),
      onBatchDone: () => {},
    },
  );
  return { queue, changes, logs };
}

/** Preset que usa a resolucao de cada arquivo em vez de uma fixa. */
function sameAsSourceSettings(): BatchSettings {
  const profile = db.profiles.find((p) => p.title === "MP4-SD 480P")!;
  return {
    profileId: profile.id,
    overrides: { resolution: null, videoBitrateKbps: null },
    allowPassthrough: false,
    outputDir: null,
  };
}

// --------------------------------------------------------------------------- //

describe("nome do arquivo de saida", () => {
  it("nunca sobrescreve um arquivo existente", async (t) => {
    if (skip()) return t.skip(skip()!);
    const first = buildOutputPath(samples.pequeno!, ".mp4", workDir);
    await writeFile(first, "ocupado");
    const second = buildOutputPath(samples.pequeno!, ".mp4", workDir);
    assert.notEqual(first, second);
    assert.match(second, /-videoimagem-2\.mp4$/);
    await rm(first, { force: true });
  });
});

describe("gerenciamento da fila", () => {
  it("adiciona arquivos e le os metadados de cada um", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.pequeno!, samples.medio!]);

    const items = queue.list();
    assert.equal(items.length, 2);
    assert.equal(items[0]!.probe?.width, 320);
    assert.equal(items[1]!.probe?.width, 640);
    assert.ok(items.every((item) => item.status === "pending"));
  });

  it("ignora o mesmo arquivo adicionado duas vezes", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.pequeno!]);
    await queue.add([samples.pequeno!, samples.medio!]);
    assert.equal(queue.list().length, 2);
  });

  it("marca como falha o arquivo que o ffprobe nao le, sem derrubar a fila", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.quebrado!, samples.pequeno!]);

    const items = queue.list();
    assert.equal(items[0]!.status, "failed");
    assert.ok(items[0]!.probeError, "deveria guardar o motivo");
    assert.equal(items[1]!.status, "pending", "o arquivo bom continua na fila");
  });

  it("remover tira da lista", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.pequeno!, samples.medio!]);
    const target = queue.list()[0]!;
    assert.equal(queue.remove(target.id), true);
    assert.equal(queue.list().length, 1);
    assert.equal(queue.remove("nao-existe"), false);
  });

  it("limpar concluidos preserva o que ainda falta", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.quebrado!, samples.pequeno!]);
    queue.clearFinished();

    const items = queue.list();
    assert.equal(items.length, 1);
    assert.equal(items[0]!.status, "pending");
  });
});

describe("execucao do lote", () => {
  it("converte tudo que esta pendente e resume o resultado", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.pequeno!, samples.medio!]);

    const summary = await queue.start({
      profileId: db.profiles.find((p) => p.title === "MP4-SD 480P")!.id,
      allowPassthrough: false,
      outputDir: workDir,
    });

    assert.equal(summary.total, 2);
    assert.equal(summary.done, 2, "ambos deveriam converter");
    assert.equal(summary.failed, 0);
    assert.ok(queue.list().every((item) => item.status === "done"));
  });

  it("cada item usa os PROPRIOS metadados, nao os do primeiro", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.pequeno!, samples.medio!]);

    const summary = await queue.start({ ...sameAsSourceSettings(), outputDir: workDir });
    assert.equal(summary.done, 2, "ambos deveriam converter");

    const items = queue.list();
    const saidaPequeno = await probeFile(items[0]!.outputPath!);
    const saidaMedio = await probeFile(items[1]!.outputPath!);

    // se a fila usasse a resolucao do item em foco para todos, as duas saidas
    // teriam o mesmo tamanho -- e esse o bug que este teste existe para pegar
    assert.deepEqual(
      [saidaPequeno.width, saidaPequeno.height],
      [320, 240],
      "o primeiro deveria manter 320x240",
    );
    assert.deepEqual(
      [saidaMedio.width, saidaMedio.height],
      [640, 480],
      "o segundo deveria manter 640x480",
    );
  });

  it("um arquivo ilegivel nao impede os outros de converterem", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.quebrado!, samples.pequeno!]);

    const summary = await queue.start({
      profileId: db.profiles.find((p) => p.title === "MP4-SD 480P")!.id,
      allowPassthrough: false,
      outputDir: workDir,
    });

    // o quebrado ja estava 'failed' pelo probe, entao nem entra na contagem
    assert.equal(summary.done, 1);
    const items = queue.list();
    assert.equal(items.find((i) => i.path === samples.quebrado)!.status, "failed");
    assert.equal(items.find((i) => i.path === samples.pequeno)!.status, "done");
  });

  it("start em fila ja rodando nao dispara um segundo lote", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();
    await queue.add([samples.pequeno!, samples.medio!]);

    const settings: BatchSettings = {
      profileId: db.profiles.find((p) => p.title === "MP4-SD 480P")!.id,
      allowPassthrough: false,
      outputDir: workDir,
    };

    const first = queue.start(settings);
    const second = await queue.start(settings); // deve voltar vazio na hora
    assert.equal(second.total, 0);

    const summary = await first;
    assert.equal(summary.done, 2);
  });

  it("cancelar tudo para o item atual e marca os seguintes como cancelados", async (t) => {
    if (skip()) return t.skip(skip()!);
    const { queue } = makeQueue();

    // um alvo pesado para dar tempo de cancelar no meio
    const pesado = await makeSample("pesado", "1920x1080", 60);
    await queue.add([pesado, samples.pequeno!, samples.medio!]);

    const settings: BatchSettings = {
      profileId: db.profiles.find((p) => p.title === "MP4-HD 1080P")!.id,
      allowPassthrough: false,
      outputDir: workDir,
    };

    const execution = queue.start(settings);
    await new Promise((resolve) => setTimeout(resolve, 900));
    queue.cancelAll();

    const summary = await execution;
    assert.equal(summary.done, 0, "nada deveria ter concluido");
    assert.equal(summary.canceled, 3, "o atual e os dois seguintes");
    assert.ok(queue.list().every((item) => item.status === "canceled"));
    assert.ok(summary.elapsedSeconds < 30, "deveria ter parado logo");
  });
});
