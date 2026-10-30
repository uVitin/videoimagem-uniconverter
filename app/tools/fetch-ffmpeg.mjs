// Baixa o ffmpeg e o ffprobe estaticos (versao fixa) para vendor/ffmpeg/<arch>/.
//   Intel (x64)      -> evermeet.cx          (confere o tamanho publicado na API deles)
//   Apple Silicon    -> ffmpeg.martin-riedl.de (confere o SHA-256 publicado por eles)
// Roda antes do 'pack'/'dist'. Se os arquivos ja existem, nao baixa de novo.
// Para trocar de versao, edite as constantes abaixo e apague vendor/ffmpeg.
//
// Licenca: estes builds incluem x264/x265 (GPL). Viajam como programas separados,
// chamados por linha de comando; quem redistribuir o app deve respeitar a GPL deles.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = (arch, name) => join(root, "vendor", "ffmpeg", arch, name);

const EVERMEET_VERSION = "9.0.2";
const RIEDL_BUILD = "1789931890_9.0.2";

const sources = {
  x64: {
    ffmpeg: { url: `https://evermeet.cx/ffmpeg/ffmpeg-${EVERMEET_VERSION}.zip`, size: 26198325 },
    ffprobe: { url: `https://evermeet.cx/ffmpeg/ffprobe-${EVERMEET_VERSION}.zip`, size: 26104193 },
  },
  arm64: {
    ffmpeg: { url: `https://ffmpeg.martin-riedl.de/download/macos/arm64/${RIEDL_BUILD}/ffmpeg.zip` },
    ffprobe: { url: `https://ffmpeg.martin-riedl.de/download/macos/arm64/${RIEDL_BUILD}/ffprobe.zip` },
  },
};

const exists = (path) => stat(path).then(() => true, () => false);

async function get(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchOne(arch, name, source) {
  const target = out(arch, name);
  if (await exists(target)) {
    console.log(`${arch}/${name} ja existe`);
    return;
  }

  console.log(`baixando ${arch}/${name}…`);
  const zip = await get(source.url);

  if (source.size !== undefined && zip.length !== source.size) {
    throw new Error(`${arch}/${name}: tamanho ${zip.length}, esperado ${source.size}`);
  }
  if (arch === "arm64") {
    const sums = (await get(`${source.url}.sha256`)).toString("utf8");
    const expected = sums.trim().split(/\s+/)[0];
    const actual = createHash("sha256").update(zip).digest("hex");
    if (actual !== expected) {
      throw new Error(`${arch}/${name}: SHA-256 ${actual}, esperado ${expected}; nada foi gravado`);
    }
  }

  const tmp = await mkdtemp(join(tmpdir(), "vi-ffmpeg-"));
  try {
    await writeFile(join(tmp, "pkg.zip"), zip);
    await run("/usr/bin/ditto", ["-x", "-k", join(tmp, "pkg.zip"), tmp]);
    const extracted = join(tmp, name);
    if (!(await exists(extracted))) throw new Error(`${arch}/${name}: o zip nao trouxe '${name}'`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(extracted));
    await chmod(target, 0o755);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  console.log(`${arch}/${name} ok (${(zip.length / 1e6).toFixed(1)} MB zip)`);
}

for (const [arch, files] of Object.entries(sources)) {
  for (const [name, source] of Object.entries(files)) {
    await fetchOne(arch, name, source);
  }
}
