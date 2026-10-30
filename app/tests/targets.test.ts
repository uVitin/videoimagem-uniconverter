/**
 * Formato -> predefinicao em dois passos, "igual a origem" e video vertical
 * (o caso que gerava barras pretas: 1080x1920 virava 640x480 com tarja).
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { availableEncoders, resolveBinaries, type Binaries } from "../src/engine/binaries";
import { buildCommand } from "../src/engine/command";
import { loadDatabase, type PresetDatabase } from "../src/engine/data";
import { displayDimensions } from "../src/engine/probe";
import { resolvePreset } from "../src/engine/resolver";
import { buildTargets } from "../src/engine/targets";
import { ConversionQueue, type QueueItem } from "../src/main/queue";

const run = promisify(execFile);

let db: PresetDatabase;
let binaries: Binaries | null = null;
let encoders = new Set<string>();
let workDir = "";
let vertical = "";
let landscape = "";

before(async () => {
  db = loadDatabase();
  try {
    binaries = await resolveBinaries();
    encoders = await availableEncoders(binaries.ffmpeg);
  } catch {
    binaries = null;
    return;
  }
  workDir = await mkdtemp(join(tmpdir(), "vi-targets-"));
  const make = async (path: string, size: string) =>
    run(binaries!.ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=size=${size}:rate=25:duration=1`,
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", path,
    ]);
  vertical = join(workDir, "vertical.mp4");
  landscape = join(workDir, "paisagem.mp4");
  await make(vertical, "540x960");
  await make(landscape, "640x360");
});

after(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

describe("lista de destinos", () => {
  const groups = () => buildTargets(db);
  const containers = () => groups().flatMap((g) => g.containers);

  it("um formato por extensao, com MP4, MOV e MKV no topo dos videos", () => {
    const keys = containers().map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(groups()[0]!.containers.slice(0, 3).map((c) => c.key), [".mp4", ".mov", ".mkv"]);
    assert.deepEqual(groups().map((g) => g.kind), ["video", "audio", "image"]);
  });

  it("sem duplicados do tipo 'MP4 (2)' e com 'Igual a origem' sempre primeiro nos videos", () => {
    const mp4 = containers().find((c) => c.key === ".mp4")!;
    assert.equal(mp4.presets[0]!.id, "match");
    assert.equal(mp4.presets[0]!.matchSource, true);
    assert.equal(mp4.presets.filter((p) => p.label.toLowerCase() === "mp4").length, 0);
    const audio = containers().find((c) => c.key === ".mp3")!;
    assert.equal(audio.presets[0]!.matchSource, false);
  });

  it("dispositivos aparecem como predefinicoes do MP4", () => {
    const mp4 = containers().find((c) => c.key === ".mp4")!;
    assert.ok(mp4.presets.some((p) => p.group === "Dispositivos"));
  });

  it("toda predefinicao oferecida resolve", () => {
    for (const container of containers()) {
      for (const preset of container.presets) {
        const request =
          preset.profileId != null ? { profileId: preset.profileId } : { formatId: preset.formatId! };
        assert.doesNotThrow(
          () => resolvePreset(db, { ...request, ...(preset.matchSource ? { matchSource: true } : {}) }),
          `${container.key} / ${preset.label}`,
        );
      }
    }
  });
});

describe("igual a origem", () => {
  const mp4 = () => db.formats.find((f) => f.title === "MP4" && f.extension === ".mp4")!;

  it("video vertical continua vertical, sem cair em 640x480", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      matchSource: true,
      source: { width: 1080, height: 1920, frameRate: 29.97 },
    });
    assert.equal(resolved.choices.resolution, "1080*1920");
    assert.equal(resolved.choices.frameRate, 29.97);
    assert.ok((resolved.choices.videoBitrateKbps ?? 0) > 0, "bitrate calculado pelo tamanho");
  });

  it("sem arquivo escolhido, deixa resolucao e taxa em aberto", () => {
    const resolved = resolvePreset(db, { formatId: mp4().id, matchSource: true });
    assert.equal(resolved.choices.resolution, null);
    assert.equal(resolved.choices.frameRate, null);
  });

  it("o que o usuario fixa vale mais que a origem", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      matchSource: true,
      overrides: { resolution: "1280*720" },
      source: { width: 1080, height: 1920, frameRate: 30 },
    });
    assert.equal(resolved.choices.resolution, "1280*720");
  });

  it("formatos de tamanho fixo (DVD/3GP) nao viram 'igual a origem'", () => {
    const vob = db.formats.find((f) => f.extension.toLowerCase() === ".vob")!;
    const resolved = resolvePreset(db, {
      formatId: vob.id,
      matchSource: true,
      source: { width: 1080, height: 1920, frameRate: 30 },
    });
    assert.notEqual(resolved.choices.resolution, "1080*1920");
  });

  it("nao escala quando o tamanho ja e o da origem", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      matchSource: true,
      source: { width: 1080, height: 1920, frameRate: 30 },
    });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.mp4",
      outputPath: "/tmp/b.mp4",
      source: { path: "/tmp/a.mp4", containerFormats: [], hasVideo: true, hasAudio: true, width: 1080, height: 1920 },
    });
    assert.ok(!built.args.includes("-vf"));
  });
});

describe("video vertical em preset horizontal", () => {
  it("vira o quadro do preset em vez de encher de barras", () => {
    const youtube = db.profiles.find(
      (p) => p.resolution?.width === 1920 && p.resolution?.height === 1080,
    )!;
    const resolved = resolvePreset(db, {
      profileId: youtube.id,
      source: { width: 1080, height: 1920, frameRate: 30 },
    });
    assert.equal(resolved.choices.resolution, "1080*1920");
    assert.ok(resolved.notes.some((n) => n.field === "resolution" && /vertical/.test(n.message)));
  });

  it("video horizontal no mesmo preset nao muda", () => {
    const profile = db.profiles.find((p) => p.resolution?.width === 1920 && p.resolution?.height === 1080)!;
    const resolved = resolvePreset(db, {
      profileId: profile.id,
      source: { width: 1280, height: 720, frameRate: 30 },
    });
    assert.equal(resolved.choices.resolution, "1920*1080");
  });
});

describe("rotacao do celular", () => {
  it("troca largura e altura com rotacao de 90 graus", () => {
    assert.deepEqual(displayDimensions({ width: 1920, height: 1080, tags: { rotate: "90" } }), {
      width: 1080, height: 1920,
    });
    assert.deepEqual(
      displayDimensions({ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }),
      { width: 1080, height: 1920 },
    );
    assert.deepEqual(displayDimensions({ width: 1920, height: 1080, tags: { rotate: "180" } }), {
      width: 1920, height: 1080,
    });
  });
});

async function convert(
  input: string,
  target: { formatId?: number; profileId?: number; matchSource?: boolean },
  fitMode: "contain" | "bars" = "contain",
): Promise<{ item: QueueItem; width: number; height: number }> {
  const queue = new ConversionQueue(
    { db, ffmpegPath: binaries!.ffmpeg, encoders },
    { onItemChanged: () => {}, onProgress: () => {}, onLog: () => {}, onBatchDone: () => {} },
  );
  await queue.add([input]);
  await queue.start({
    profileId: target.profileId ?? null,
    formatId: target.formatId ?? null,
    ...(target.matchSource ? { matchSource: true } : {}),
    outputDir: workDir,
    allowPassthrough: false,
    fitMode,
  });
  const item = queue.list()[0]!;
  assert.equal(item.status, "done", item.error);
  const { stdout } = await run(binaries!.ffprobe, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0",
    item.outputPath!,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { item, width: width!, height: height! };
}

describe("conversao real de video vertical", () => {
  it("MP4 igual a origem mantem 540x960, sem barras", async (t) => {
    if (!binaries || !encoders.has("libx264")) return t.skip("sem ffmpeg/libx264");
    const mp4 = db.formats.find((f) => f.title === "MP4" && f.extension === ".mp4")!;
    const { width, height } = await convert(vertical, { formatId: mp4.id, matchSource: true });
    assert.deepEqual([width, height], [540, 960]);
  });

  it("preset 1920x1080 num video vertical sai vertical, sem tarja", async (t) => {
    if (!binaries || !encoders.has("libx264")) return t.skip("sem ffmpeg/libx264");
    const preset = db.profiles.find(
      (p) => p.resolution?.width === 1920 && p.resolution?.height === 1080 && p.video_encoder === "M264",
    );
    if (!preset) return t.skip("sem preset 1080p H264");
    const { width, height } = await convert(vertical, { profileId: preset.id });
    assert.ok(height > width, `esperava vertical, saiu ${width}x${height}`);
    assert.equal(Math.round((width / height) * 100), Math.round((540 / 960) * 100));
  });

  it("modo 'com barras' continua disponivel", async (t) => {
    if (!binaries || !encoders.has("libx264")) return t.skip("sem ffmpeg/libx264");
    const mp4 = db.formats.find((f) => f.title === "MP4" && f.extension === ".mp4")!;
    const { width, height } = await convert(landscape, { formatId: mp4.id }, "bars");
    assert.ok(width > 0 && height > 0);
  });
});
