/**
 * Teste de ponta a ponta: gera um video, converte com o engine e inspeciona o
 * resultado. Precisa de ffmpeg instalado; se nao houver, os testes sao pulados
 * em vez de falhar.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";

import { availableEncoders, resolveBinaries, type Binaries } from "../src/engine/binaries";
import { buildCommand } from "../src/engine/command";
import { loadDatabase, type PresetDatabase } from "../src/engine/data";
import { decidePassthrough } from "../src/engine/passthrough";
import { probeFile } from "../src/engine/probe";
import { resolvePreset } from "../src/engine/resolver";
import { runConversion } from "../src/engine/runner";
import type { Progress } from "../src/engine/runner";

const run = promisify(execFile);

let db: PresetDatabase;
let binaries: Binaries | null = null;
let encoders = new Set<string>();
let workDir = "";
let samplePath = "";

const SAMPLE_SECONDS = 3;

before(async () => {
  db = loadDatabase();
  try {
    binaries = await resolveBinaries();
    encoders = await availableEncoders(binaries.ffmpeg);
  } catch {
    binaries = null;
    return;
  }

  workDir = await mkdtemp(join(tmpdir(), "videoimagem-test-"));
  samplePath = join(workDir, "amostra.mp4");

  // 640x480@25 H.264 + AAC: o bastante para exercitar escala, reencode e copy
  await run(binaries.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc=size=640x480:rate=25:duration=${SAMPLE_SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${SAMPLE_SECONDS}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-shortest", samplePath,
  ]);
});

after(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

function skipIfNoFfmpeg(): string | null {
  return binaries ? null : "ffmpeg nao esta instalado neste sistema";
}

// --------------------------------------------------------------------------- //

describe("conversao de ponta a ponta", () => {
  it("le os metadados da amostra que acabamos de gerar", async (t) => {
    const reason = skipIfNoFfmpeg();
    if (reason) return t.skip(reason);

    const probe = await probeFile(samplePath);
    assert.equal(probe.width, 640);
    assert.equal(probe.height, 480);
    assert.equal(probe.frameRate, 25);
    assert.equal(probe.videoCodec, "h264");
    assert.equal(probe.audioCodec, "aac");
    assert.equal(probe.audioChannels, 2);
    assert.ok(probe.durationSeconds && probe.durationSeconds > SAMPLE_SECONDS - 0.5);
  });

  it("reencoda para 1280x720 e o arquivo sai com a resolucao pedida", async (t) => {
    const reason = skipIfNoFfmpeg();
    if (reason) return t.skip(reason);

    const source = await probeFile(samplePath);
    const mp4 = db.formats.find((f) => f.title === "MP4")!;
    const resolved = resolvePreset(db, {
      formatId: mp4.id,
      overrides: {
        videoEncoder: "M264",
        audioEncoder: "MAAC",
        resolution: "1280*720",
        frameRate: 25,
        audioBitrateKbps: 128,
        sampleRateHz: 44100,
        channels: 2,
      },
      source,
    });

    const outputPath = join(workDir, "saida-720p.mp4");
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: samplePath,
      outputPath,
      // tamanho exato pedido: o padrao ("sem barras") deixaria o quadro menor
      fitMode: "bars",
      availableEncoders: encoders,
    });
    assert.equal(built.videoEncoder, "libx264");

    const progressSamples: Progress[] = [];
    const result = await runConversion({
      ffmpegPath: binaries!.ffmpeg,
      args: built.args,
      durationSeconds: source.durationSeconds ?? SAMPLE_SECONDS,
      onProgress: (progress) => progressSamples.push(progress),
    }).promise;

    assert.equal(result.code, 0, `ffmpeg falhou:\n${result.stderr.slice(-800)}`);

    const output = await probeFile(outputPath);
    assert.equal(output.width, 1280);
    assert.equal(output.height, 720);
    assert.equal(output.videoCodec, "h264");
    assert.equal(output.audioCodec, "aac");

    assert.ok(progressSamples.length > 0, "o parser de -progress nao viu nada");
    const last = progressSamples.at(-1)!;
    assert.ok(last.outTimeSeconds > 0, "out_time nao avancou");
    assert.ok(
      last.fraction != null && last.fraction > 0.5,
      `a fracao final deveria estar perto de 1, veio ${last.fraction}`,
    );
  });

  it("o passthrough copia os streams e e muito mais rapido que reencodar", async (t) => {
    const reason = skipIfNoFfmpeg();
    if (reason) return t.skip(reason);

    const source = await probeFile(samplePath);
    const mp4 = db.formats.find((f) => f.title === "MP4")!;
    const resolved = resolvePreset(db, {
      formatId: mp4.id,
      overrides: {
        videoEncoder: "M264",
        audioEncoder: "MAAC",
        resolution: "640*480",
        frameRate: 25,
        sampleRateHz: 44100,
        channels: 2,
      },
      source,
    });

    const decision = decidePassthrough(db.passthrough, ".mp4", resolved.choices, source);
    assert.equal(decision.video, true, decision.videoReason);
    assert.equal(decision.audio, true, decision.audioReason);

    const outputPath = join(workDir, "saida-copy.mp4");
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: samplePath,
      outputPath,
      passthrough: decision,
      source,
      availableEncoders: encoders,
    });
    assert.ok(built.args.join(" ").includes("-c:v copy"));

    const result = await runConversion({
      ffmpegPath: binaries!.ffmpeg,
      args: built.args,
      durationSeconds: source.durationSeconds ?? SAMPLE_SECONDS,
    }).promise;

    assert.equal(result.code, 0, `ffmpeg falhou:\n${result.stderr.slice(-800)}`);

    const output = await probeFile(outputPath);
    assert.equal(output.width, 640);
    assert.equal(output.height, 480);
    assert.equal(output.videoCodec, "h264");

    const original = await stat(samplePath);
    const copied = await stat(outputPath);
    // remux nao reencoda: o tamanho fica na mesma ordem de grandeza
    assert.ok(
      copied.size > original.size * 0.8 && copied.size < original.size * 1.3,
      `copy deveria preservar o tamanho: ${original.size} -> ${copied.size}`,
    );
  });

  it("extrai so o audio quando o preset nao tem video", async (t) => {
    const reason = skipIfNoFfmpeg();
    if (reason) return t.skip(reason);

    const source = await probeFile(samplePath);
    const mp3 = db.formats.find((f) => f.title === "MP3");
    assert.ok(mp3, "esperava o formato MP3 no banco");

    const resolved = resolvePreset(db, {
      formatId: mp3.id,
      overrides: { videoEncoder: null, audioBitrateKbps: 192, sampleRateHz: 44100, channels: 2 },
      source,
    });

    const outputPath = join(workDir, "saida.mp3");
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: samplePath,
      outputPath,
      availableEncoders: encoders,
    });
    assert.ok(built.args.includes("-vn"), "sem video, o comando precisa de -vn");

    const result = await runConversion({ ffmpegPath: binaries!.ffmpeg, args: built.args }).promise;
    assert.equal(result.code, 0, `ffmpeg falhou:\n${result.stderr.slice(-800)}`);

    const output = await probeFile(outputPath);
    assert.equal(output.hasVideo, false);
    assert.equal(output.hasAudio, true);
    assert.equal(output.audioCodec, "mp3");
  });

  it("cancelar encerra o ffmpeg e marca o resultado como cancelado", async (t) => {
    const reason = skipIfNoFfmpeg();
    if (reason) return t.skip(reason);

    // um alvo pesado o bastante para dar tempo de cancelar
    const outputPath = join(workDir, "saida-cancelada.mp4");
    const args = [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=120",
      "-c:v", "libx264", "-preset", "veryslow",
      "-progress", "pipe:1", "-nostats",
      outputPath,
    ];

    const execution = runConversion({ ffmpegPath: binaries!.ffmpeg, args, durationSeconds: 120 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    execution.cancel();

    const result = await execution.promise;
    assert.equal(result.canceled, true);
    assert.notEqual(result.code, 0, "cancelado nao deveria sair com codigo 0");
    assert.ok(result.elapsedSeconds < 30, "deveria ter parado logo");
  });
});
