import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recommendVideoBitrate } from "../src/engine/bitrate";
import { buildCommand, commandToString } from "../src/engine/command";
import { linkProfile, loadDatabase } from "../src/engine/data";
import { effectiveConstraints, limitMatches, parseResolution } from "../src/engine/limits";
import { decidePassthrough } from "../src/engine/passthrough";
import { resolvePreset } from "../src/engine/resolver";
import type { ProbeResult } from "../src/engine/probe";
import type { Format, Limit } from "../src/engine/types";

const db = loadDatabase();

function formatByTitle(title: string): Format {
  const found = db.formats.find((f) => f.title === title);
  assert.ok(found, `formato '${title}' nao existe`);
  return found;
}

// --------------------------------------------------------------------------- //

describe("integridade do banco extraido", () => {
  it("carrega as 6 colecoes", () => {
    assert.equal(db.categories.length, 8);
    assert.equal(db.formats.length, 174);
    assert.equal(db.profiles.length, 469);
    assert.equal(db.formatIndex.length, 91);
    assert.ok(Object.keys(db.codecMap.video).length >= 56);
    assert.ok(Object.keys(db.passthrough).length === 8);
  });

  it("todo FourCC usado por um preset existe no codec-map", () => {
    const missing = new Set<string>();
    for (const profile of db.profiles) {
      if (profile.video_encoder && !db.codecMap.video[profile.video_encoder]) {
        missing.add(`video:${profile.video_encoder}`);
      }
      if (profile.audio_encoder && !db.codecMap.audio[profile.audio_encoder]) {
        missing.add(`audio:${profile.audio_encoder}`);
      }
    }
    assert.deepEqual([...missing], []);
  });

  it("todo FourCC listado como permitido em um formato existe no codec-map", () => {
    const missing = new Set<string>();
    for (const format of db.formats) {
      for (const fourcc of format.video_encoders?.allowed ?? []) {
        if (!db.codecMap.video[fourcc]) missing.add(`video:${fourcc}`);
      }
      for (const fourcc of format.audio_encoders?.allowed ?? []) {
        if (!db.codecMap.audio[fourcc]) missing.add(`audio:${fourcc}`);
      }
    }
    assert.deepEqual([...missing], []);
  });

  it("todos os 469 presets conseguem um container", () => {
    for (const profile of db.profiles) {
      const link = linkProfile(db, profile);
      assert.match(link.container, /^\.[a-z0-9]+$/i, `preset ${profile.id} (${profile.title})`);
    }
  });
});

// --------------------------------------------------------------------------- //

describe("avaliacao dos limits", () => {
  it("AC-3 em MP4 restringe os canais a 2 ou 6", () => {
    const mp4 = formatByTitle("MP4");
    const semRestricao = effectiveConstraints(mp4, { audioEncoder: "MAAC" });
    const comAC3 = effectiveConstraints(mp4, { audioEncoder: "AC3" });

    assert.deepEqual(semRestricao.constraints.channels?.allowed, [1, 2, 6, 8]);
    assert.deepEqual(comAC3.constraints.channels?.allowed, [2, 6]);
  });

  it("condicao com varias chaves e um E logico", () => {
    const limit: Limit = {
      when: { VideoEncoder: "M264", Resolution: "1920*1080" },
      then: { video_bitrate_kbps: { default: 8000, allowed: [8000] } },
    };
    assert.equal(limitMatches(limit, { videoEncoder: "M264", resolution: "1920*1080" }), true);
    assert.equal(limitMatches(limit, { videoEncoder: "M264", resolution: "1280*720" }), false);
    assert.equal(limitMatches(limit, { videoEncoder: "M264" }), false, "chave ausente nao casa");
  });

  it("o limit mais especifico vence o mais geral", () => {
    const format: Format = {
      id: 9001,
      title: "teste",
      category_id: 7,
      extension: ".mp4",
      fourcc: "TEST",
      video_bitrate_kbps: { default: 2000, allowed: [1000, 2000, 3000] },
      limits: [
        {
          when: { VideoEncoder: "M264", Resolution: "1920*1080" },
          then: { video_bitrate_kbps: { default: 9000, allowed: [9000] } },
        },
        {
          when: { VideoEncoder: "M264" },
          then: { video_bitrate_kbps: { default: 4000, allowed: [4000] } },
        },
      ],
    };
    const result = effectiveConstraints(format, {
      videoEncoder: "M264",
      resolution: "1920*1080",
    });
    assert.deepEqual(result.constraints.video_bitrate_kbps?.allowed, [9000]);
    assert.equal(result.applied.length, 2, "as duas casam; a ordem decide");
  });

  it("aceita 1920x1080 e 1920*1080 como a mesma coisa", () => {
    assert.deepEqual(parseResolution("1920x1080"), { width: 1920, height: 1080 });
    assert.deepEqual(parseResolution("1920*1080"), { width: 1920, height: 1080 });
    assert.equal(parseResolution("sem sentido"), null);
  });
});

// --------------------------------------------------------------------------- //

describe("modelo de bitrate", () => {
  it("H.264 em 1080p30 cai na ancora de 10000 kbps", () => {
    const result = recommendVideoBitrate(db.bitrateModel, "M264", 1920, 1080, 30);
    assert.ok(result);
    assert.equal(result.family, "H.264(Baseline)");
    assert.equal(result.videoBitrateKbps, 10000);
    assert.equal(result.usedFallbackAnchors, false);
  });

  it("escala com os pixels: 720p30 fica entre as ancoras vizinhas", () => {
    const result = recommendVideoBitrate(db.bitrateModel, "M264", 1280, 720, 30);
    assert.ok(result);
    assert.equal(result.videoBitrateKbps, 5000);
  });

  it("o dobro de fps pede o dobro de bitrate", () => {
    const at30 = recommendVideoBitrate(db.bitrateModel, "M264", 1920, 1080, 30);
    const at60 = recommendVideoBitrate(db.bitrateModel, "M264", 1920, 1080, 60);
    assert.ok(at30 && at60);
    assert.equal(at60.videoBitrateKbps, at30.videoBitrateKbps * 2);
  });

  it("HEVC pede menos que H.264 na mesma resolucao", () => {
    const h264 = recommendVideoBitrate(db.bitrateModel, "M264", 1920, 1080, 30);
    const hevc = recommendVideoBitrate(db.bitrateModel, "HEVC", 1920, 1080, 30);
    assert.ok(h264 && hevc);
    assert.ok(hevc.videoBitrateKbps < h264.videoBitrateKbps,
      `hevc=${hevc.videoBitrateKbps} deveria ser menor que h264=${h264.videoBitrateKbps}`);
  });

  it("tolera o padding de espaco no FourCC ('AV1 ' na tabela)", () => {
    assert.ok(recommendVideoBitrate(db.bitrateModel, "VP8", 1280, 720, 30));
  });

  it("FourCC desconhecido devolve null em vez de inventar", () => {
    assert.equal(recommendVideoBitrate(db.bitrateModel, "ZZZZ", 1920, 1080, 30), null);
  });
});

// --------------------------------------------------------------------------- //

describe("resolvedor de preset", () => {
  it("resolve um preset de dispositivo nos defaults dele", () => {
    const htcVive = db.profiles.find((p) => p.title === "HTC Vive");
    assert.ok(htcVive);
    const resolved = resolvePreset(db, { profileId: htcVive.id });

    assert.equal(resolved.container, ".mp4");
    assert.equal(resolved.choices.resolution, "1920*1080");
    assert.equal(resolved.choices.frameRate, 30);
    assert.equal(resolved.choices.audioEncoder, "AAC");
  });

  it("encaixa um valor invalido no mais proximo e avisa", () => {
    const mp4 = formatByTitle("MP4");
    const resolved = resolvePreset(db, {
      formatId: mp4.id,
      overrides: { audioEncoder: "AC3", channels: 8 }, // AC-3 no MP4 aceita so 2 ou 6
    });

    assert.equal(resolved.choices.channels, 6);
    const note = resolved.notes.find((n) => n.field === "channels");
    assert.ok(note, "deveria explicar o ajuste");
    assert.equal(note.severity, "warning", "o usuario fixou o valor, logo e um aviso");
  });

  it("calcula o bitrate quando ninguem pediu um", () => {
    const mp4 = formatByTitle("MP4");
    const resolved = resolvePreset(db, {
      formatId: mp4.id,
      overrides: {
        videoEncoder: "M264",
        resolution: "1920*1080",
        frameRate: 30,
        videoBitrateKbps: null,
      },
    });
    assert.ok(resolved.choices.videoBitrateKbps);
    assert.ok(
      (mp4.video_bitrate_kbps?.allowed ?? []).includes(resolved.choices.videoBitrateKbps),
      "o valor calculado precisa estar na lista de permitidos",
    );
  });

  it("os 469 presets resolvem sem lancar excecao", () => {
    for (const profile of db.profiles) {
      const resolved = resolvePreset(db, { profileId: profile.id });
      assert.ok(resolved.container, `preset ${profile.id}`);
      const naoConvergiu = resolved.notes.find((n) => n.field === "*");
      assert.equal(naoConvergiu, undefined,
        `preset ${profile.id} (${profile.title}) nao convergiu`);
    }
  });

  it("reclama de preset inexistente em vez de devolver lixo", () => {
    assert.throws(() => resolvePreset(db, { profileId: 999999 }), /nao existe/);
  });
});

// --------------------------------------------------------------------------- //

const h264Mp4Source: ProbeResult = {
  path: "/tmp/entrada.mp4",
  containerFormats: ["mov", "mp4"],
  hasVideo: true,
  hasAudio: true,
  width: 1920,
  height: 1080,
  frameRate: 30,
  videoCodec: "h264",
  audioCodec: "aac",
  audioSampleRateHz: 44100,
  audioChannels: 2,
  durationSeconds: 60,
};

describe("decisao de passthrough", () => {
  it("copia H.264/AAC para MP4 quando nada muda", () => {
    const decision = decidePassthrough(
      db.passthrough, ".mp4",
      {
        videoEncoder: "M264", audioEncoder: "MAAC", resolution: "1920*1080",
        frameRate: 30, videoBitrateKbps: 8000, audioBitrateKbps: 192,
        sampleRateHz: 44100, channels: 2,
      },
      h264Mp4Source,
    );
    assert.equal(decision.video, true);
    assert.equal(decision.audio, true);
  });

  it("nao copia quando a resolucao muda", () => {
    const decision = decidePassthrough(
      db.passthrough, ".mp4",
      {
        videoEncoder: "M264", audioEncoder: "MAAC", resolution: "1280*720",
        frameRate: 30, videoBitrateKbps: 5000, audioBitrateKbps: 192,
        sampleRateHz: 44100, channels: 2,
      },
      h264Mp4Source,
    );
    assert.equal(decision.video, false);
    assert.match(decision.videoReason, /resolucao muda/);
    assert.equal(decision.audio, true, "o audio nao mudou, pode copiar");
  });

  it("nao copia H.264 para WebM (container nao aceita)", () => {
    const decision = decidePassthrough(
      db.passthrough, ".webm",
      {
        videoEncoder: "VP9", audioEncoder: "OPUS", resolution: "1920*1080",
        frameRate: 30, videoBitrateKbps: 4000, audioBitrateKbps: 128,
        sampleRateHz: 48000, channels: 2,
      },
      h264Mp4Source,
    );
    assert.equal(decision.video, false);
    assert.match(decision.videoReason, /mapa de passthrough/);
  });
});

// --------------------------------------------------------------------------- //

describe("construtor de comando", () => {
  const mp4 = () => formatByTitle("MP4");

  it("monta um comando H.264/AAC completo", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      overrides: {
        videoEncoder: "M264", audioEncoder: "MAAC", resolution: "1920*1080",
        frameRate: 30, videoBitrateKbps: 8000, audioBitrateKbps: 192,
        sampleRateHz: 44100, channels: 2,
      },
    });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.mov",
      outputPath: "/tmp/b.mp4",
    });

    assert.equal(built.videoEncoder, "libx264");
    assert.equal(built.audioEncoder, "aac");
    assert.ok(built.args.includes("-b:v"));
    assert.ok(built.args.includes("8000k"));
    assert.ok(built.args.includes("+faststart"), "MP4 deve sair com faststart");
    assert.ok(built.args.includes("-progress"), "precisamos do progresso em stdout");
    assert.equal(built.args.at(-1), "/tmp/b.mp4", "a saida e o ultimo argumento");
  });

  it("usa VideoToolbox quando pedido e disponivel", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      overrides: { videoEncoder: "M264", resolution: "1920*1080" },
    });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.mov",
      outputPath: "/tmp/b.mp4",
      preferHardware: true,
      availableEncoders: new Set(["libx264", "h264_videotoolbox", "aac"]),
    });

    if (process.platform === "darwin") {
      assert.equal(built.videoEncoder, "h264_videotoolbox");
      assert.equal(built.usedHardware, true);
    } else {
      assert.equal(built.videoEncoder, "libx264");
    }
  });

  it("cai no software e avisa quando o encoder de hardware nao existe", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      overrides: { videoEncoder: "M264", resolution: "1920*1080" },
    });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.mov",
      outputPath: "/tmp/b.mp4",
      preferHardware: true,
      availableEncoders: new Set(["libx264", "aac"]),
    });
    assert.equal(built.videoEncoder, "libx264");
    if (process.platform === "darwin") {
      assert.ok(built.warnings.some((w) => /videotoolbox/i.test(w)));
    }
  });

  it("passthrough troca o encoder por copy", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      overrides: {
        videoEncoder: "M264", audioEncoder: "MAAC", resolution: "1920*1080", frameRate: 30,
        sampleRateHz: 44100, channels: 2,
      },
      source: h264Mp4Source,
    });
    const decision = decidePassthrough(
      db.passthrough, ".mp4", resolved.choices, h264Mp4Source,
    );
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.mp4",
      outputPath: "/tmp/b.mp4",
      passthrough: decision,
      source: h264Mp4Source,
    });

    const joined = built.args.join(" ");
    assert.match(joined, /-c:v copy/);
    assert.ok(!joined.includes("libx264"), "nao deve reencodar");
    assert.ok(!joined.includes("-vf"), "copy nao aceita filtro de video");
  });

  it("escolhe o filtro de escala conforme o modo de encaixe", () => {
    const resolved = resolvePreset(db, {
      formatId: mp4().id,
      overrides: { videoEncoder: "M264", resolution: "1280*720" },
    });
    const vf = (mode: "contain" | "bars" | "fill" | "stretch") => {
      const built = buildCommand(db.codecMap, resolved, {
        inputPath: "/tmp/a.mov", outputPath: "/tmp/b.mp4", fitMode: mode,
      });
      return built.args[built.args.indexOf("-vf") + 1] ?? "";
    };
    assert.match(vf("bars"), /force_original_aspect_ratio=decrease.*pad=/s);
    assert.doesNotMatch(vf("contain"), /pad=/);
    assert.match(vf("contain"), /force_original_aspect_ratio=decrease/);
    assert.match(vf("fill"), /force_original_aspect_ratio=increase.*crop=/s);
    assert.ok(!vf("stretch").includes("force_original_aspect_ratio"));
  });

  it("ProRes nao recebe yuv420p (destruiria o 4:2:2 / 4:4:4)", () => {
    const prores = db.profiles.find((p) => p.video_encoder === "apch");
    assert.ok(prores, "esperava um preset ProRes HQ");
    const resolved = resolvePreset(db, { profileId: prores.id });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.mov", outputPath: "/tmp/b.mov",
    });
    assert.equal(built.videoEncoder, "prores_ks");
    assert.ok(!built.args.includes("yuv420p"));
    assert.ok(built.args.includes("-profile:v"));
  });

  it("AMR-NB fixa 8 kHz mono e nao deixa a gente sobrescrever", () => {
    const resolved = resolvePreset(db, {
      formatId: formatByTitle("AMR").id,
      overrides: { audioEncoder: "AMRN", sampleRateHz: 44100, channels: 2 },
    });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.wav", outputPath: "/tmp/b.amr",
    });
    const args = built.args;
    assert.equal(args.filter((a) => a === "-ar").length, 1, "um unico -ar");
    assert.equal(args[args.indexOf("-ar") + 1], "8000");
    assert.equal(args[args.indexOf("-ac") + 1], "1");
  });

  it("codecs lossless nao recebem -b:a", () => {
    const resolved = resolvePreset(db, {
      formatId: formatByTitle("FLAC").id,
      overrides: { audioEncoder: "flac", audioBitrateKbps: 320 },
    });
    const built = buildCommand(db.codecMap, resolved, {
      inputPath: "/tmp/a.wav", outputPath: "/tmp/b.flac",
    });
    assert.equal(built.audioEncoder, "flac");
    assert.ok(!built.args.includes("-b:a"), "bitrate nao faz sentido em lossless");
  });

  it("commandToString escapa caminho com espaco", () => {
    const line = commandToString("/opt/homebrew/bin/ffmpeg", ["-i", "/tmp/meu video.mov"]);
    assert.match(line, /'\/tmp\/meu video\.mov'/);
  });
});
