/**
 * "Qualquer extensao": converter escolhendo so o FORMATO (o "Personalizado" do
 * seletor), sem preset. Garante que todo formato oferecido resolve e que as
 * conversoes mais comuns realmente produzem o arquivo.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { availableEncoders, resolveBinaries, type Binaries } from "../src/engine/binaries";
import { loadDatabase, type PresetDatabase } from "../src/engine/data";
import { resolvePreset } from "../src/engine/resolver";
import { ConversionQueue, type QueueItem } from "../src/main/queue";

const run = promisify(execFile);

let db: PresetDatabase;
let binaries: Binaries | null = null;
let encoders = new Set<string>();
let workDir = "";
let sample = "";

before(async () => {
  db = loadDatabase();
  try {
    binaries = await resolveBinaries();
    encoders = await availableEncoders(binaries.ffmpeg);
  } catch {
    binaries = null;
    return;
  }
  workDir = await mkdtemp(join(tmpdir(), "vi-formats-"));
  sample = join(workDir, "amostra.mp4");
  await run(binaries.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", sample,
  ]);
});

after(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("resolver por formato (sem preset)", () => {
  it("todo formato do banco resolve, com o container do proprio formato", () => {
    for (const format of db.formats) {
      const resolved = resolvePreset(db, { formatId: format.id });
      assert.equal(resolved.container, format.extension, format.title);
      assert.equal(resolved.profile, undefined);
    }
  });

  it("recusa formato inexistente", () => {
    assert.throws(() => resolvePreset(db, { formatId: 999999 }), /nao existe/);
  });
});

/** Converte a amostra para o formato e devolve o item final da fila. */
async function convertTo(formatTitle: string, extension: string): Promise<QueueItem> {
  const format = db.formats.find((f) => f.title === formatTitle && f.extension === extension);
  assert.ok(format, `formato ${formatTitle} ${extension} nao existe no banco`);

  const queue = new ConversionQueue(
    { db, ffmpegPath: binaries!.ffmpeg, encoders },
    { onItemChanged: () => {}, onProgress: () => {}, onLog: () => {}, onBatchDone: () => {} },
  );
  await queue.add([sample]);
  await queue.start({ formatId: format.id, outputDir: workDir, allowPassthrough: false });
  return queue.list()[0]!;
}

describe("conversao real por formato", () => {
  const cases: Array<[string, string, string]> = [
    ["MP4", ".mp4", "libx264"],
    ["MKV", ".mkv", "libx264"],
    ["MOV", ".mov", "libx264"],
    ["MP3", ".mp3", "libmp3lame"],
    ["WAV", ".wav", "pcm_s16le"],
    ["FLAC", ".flac", "flac"],
  ];

  for (const [title, extension, needs] of cases) {
    it(`${title} (${extension})`, async (t) => {
      if (!binaries) return t.skip("sem ffmpeg");
      if (!encoders.has(needs)) return t.skip(`este ffmpeg nao tem ${needs}`);

      const item = await convertTo(title, extension);
      assert.equal(item.status, "done", item.error);
      assert.ok(item.outputPath!.endsWith(extension));
      assert.ok(existsSync(item.outputPath!));
      assert.ok(statSync(item.outputPath!).size > 1000, "arquivo vazio");
    });
  }

  it("formato so de audio nao leva video", async (t) => {
    if (!binaries) return t.skip("sem ffmpeg");
    if (!encoders.has("libmp3lame")) return t.skip("sem libmp3lame");

    const item = await convertTo("MP3", ".mp3");
    const { stdout } = await run("/usr/bin/env", [
      binaries.ffprobe, "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0",
      item.outputPath!,
    ]);
    assert.equal(stdout.trim(), "audio");
  });
});
