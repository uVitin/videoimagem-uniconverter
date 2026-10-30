/** Aviso de versao do app e atualizacao do yt-dlp (sem rede: fetch falso). */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  checkAppUpdate,
  compareVersions,
  isAppReleaseUrl,
  parseRelease,
  updateYtDlp,
  type FetchFn,
} from "../src/engine/updates";

let workDir = "";

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), "vi-updates-"));
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Responde por URL; o que nao esta no mapa vira 404. */
function fakeFetch(routes: Record<string, unknown | Buffer>): FetchFn {
  return async (url) => {
    if (!(url in routes)) return { ok: false, status: 404 } as never;
    const body = routes[url];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => String(body),
      arrayBuffer: async () => {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
    } as never;
  };
}

describe("compareVersions", () => {
  it("compara numeros, nao texto", () => {
    assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
    assert.ok(compareVersions("v1.2.3", "1.2.4") < 0);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
  });

  it("entende datas do yt-dlp", () => {
    assert.ok(compareVersions("2026.11.02", "2026.10.26") > 0);
    assert.ok(compareVersions("2026.10.26.123456", "2026.10.26") > 0);
  });
});

describe("parseRelease", () => {
  const repo = "uVitin/videoimagem-uniconverter";
  const ok = {
    tag_name: "v0.2.0",
    html_url: `https://github.com/${repo}/releases/tag/v0.2.0`,
    body: "novidades",
    assets: [
      { name: "a.dmg", browser_download_url: `https://github.com/${repo}/releases/download/v0.2.0/a.dmg` },
      { name: "evil", browser_download_url: "https://exemplo.com/evil" },
    ],
  };

  it("le a release e descarta assets de outro endereco", () => {
    const release = parseRelease(ok, repo);
    assert.equal(release.tag, "v0.2.0");
    assert.deepEqual(release.assets.map((a) => a.name), ["a.dmg"]);
  });

  it("recusa rascunho, pre-lancamento e endereco estranho", () => {
    assert.throws(() => parseRelease({ ...ok, draft: true }, repo), /nao final/);
    assert.throws(() => parseRelease({ ...ok, prerelease: true }, repo), /nao final/);
    assert.throws(() => parseRelease({ ...ok, html_url: "https://exemplo.com/x" }, repo), /inesperado/);
    assert.throws(() => parseRelease(null, repo), /invalida/);
  });
});

describe("checkAppUpdate", () => {
  const api = "https://api.github.com/repos/uVitin/videoimagem-uniconverter/releases/latest";
  const release = (tag: string) => ({
    tag_name: tag,
    html_url: `https://github.com/uVitin/videoimagem-uniconverter/releases/tag/${tag}`,
    assets: [],
  });

  it("avisa quando ha versao maior", async () => {
    const status = await checkAppUpdate("0.1.0", fakeFetch({ [api]: release("v0.2.0") }));
    assert.equal(status.available, true);
    assert.equal(status.latest, "0.2.0");
  });

  it("nao avisa quando esta em dia ou a frente", async () => {
    assert.equal((await checkAppUpdate("0.2.0", fakeFetch({ [api]: release("v0.2.0") }))).available, false);
    assert.equal((await checkAppUpdate("0.3.0", fakeFetch({ [api]: release("v0.2.0") }))).available, false);
  });

  it("sem release publicada da erro claro", async () => {
    await assert.rejects(checkAppUpdate("0.1.0", fakeFetch({})), /ainda nao ha release/);
  });

  it("so abre paginas de release do proprio projeto", () => {
    assert.ok(isAppReleaseUrl("https://github.com/uVitin/videoimagem-uniconverter/releases/tag/v1"));
    assert.ok(!isAppReleaseUrl("https://github.com/outro/repo/releases"));
    assert.ok(!isAppReleaseUrl("file:///etc/passwd"));
  });
});

describe("updateYtDlp", () => {
  const api = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
  const base = "https://github.com/yt-dlp/yt-dlp/releases/download/2099.01.01";
  const script = Buffer.from('#!/bin/sh\necho 2099.01.01\n');
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

  const routes = (sums: string): Record<string, unknown> => ({
    [api]: {
      tag_name: "2099.01.01",
      html_url: "https://github.com/yt-dlp/yt-dlp/releases/tag/2099.01.01",
      assets: [
        { name: "yt-dlp_macos", browser_download_url: `${base}/yt-dlp_macos` },
        { name: "SHA2-256SUMS", browser_download_url: `${base}/SHA2-256SUMS` },
      ],
    },
    [`${base}/yt-dlp_macos`]: script,
    [`${base}/SHA2-256SUMS`]: Buffer.from(sums),
  });

  it("baixa, confere o SHA-256 e instala executavel", async () => {
    const target = join(workDir, "ok", "yt-dlp");
    const result = await updateYtDlp(
      "2026.10.26",
      target,
      fakeFetch(routes(`${sha(script)}  yt-dlp_macos\n0000  outro\n`)),
    );
    assert.deepEqual(result, { updated: true, from: "2026.10.26", to: "2099.01.01" });
    assert.equal(await readFile(target, "utf8"), script.toString());
  });

  it("nao instala quando o SHA-256 nao confere", async () => {
    const target = join(workDir, "ruim", "yt-dlp");
    await assert.rejects(
      updateYtDlp("2026.10.26", target, fakeFetch(routes(`${"0".repeat(64)}  yt-dlp_macos\n`))),
      /SHA-256/,
    );
    assert.equal(existsSync(target), false);
  });

  it("nao baixa nada quando ja esta na versao mais nova", async () => {
    const target = join(workDir, "novo", "yt-dlp");
    const result = await updateYtDlp("2099.01.01", target, fakeFetch(routes("")));
    assert.equal(result.updated, false);
    assert.equal(existsSync(target), false);
  });
});
