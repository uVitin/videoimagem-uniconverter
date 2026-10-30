/** ffmpeg/ffprobe que acompanham o app instalado (`<resources>/bin`). */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { bundledBinaryPath } from "../src/engine/binaries";

let workDir = "";

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), "vi-bin-"));
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("bundledBinaryPath", () => {
  it("acha ffmpeg e ffprobe em <resources>/bin", async () => {
    const resources = join(workDir, "Resources");
    await mkdir(join(resources, "bin"), { recursive: true });
    await writeFile(join(resources, "bin", "ffmpeg"), "x");
    await writeFile(join(resources, "bin", "ffprobe"), "x");
    assert.equal(bundledBinaryPath(resources, "ffmpeg"), join(resources, "bin", "ffmpeg"));
    assert.equal(bundledBinaryPath(resources, "ffprobe"), join(resources, "bin", "ffprobe"));
  });

  it("devolve null fora do app empacotado ou sem o arquivo", () => {
    assert.equal(bundledBinaryPath(undefined, "ffmpeg"), null);
    assert.equal(bundledBinaryPath(join(workDir, "nao-existe"), "ffprobe"), null);
  });
});
