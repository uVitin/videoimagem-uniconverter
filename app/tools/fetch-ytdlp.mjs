// Baixa o yt-dlp oficial (binario universal, Intel + Apple Silicon) para vendor/
// e confere o SHA-256 contra o arquivo de somas da propria release.
// Roda antes do 'pack'/'dist'. Se o arquivo ja existe, nao baixa de novo;
// para atualizar, apague vendor/yt-dlp_macos e rode de novo.
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "vendor", "yt-dlp_macos");
const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function get(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

if (await exists(target)) {
  console.log("yt-dlp ja esta em vendor/ (apague para baixar de novo)");
  process.exit(0);
}

console.log("baixando yt-dlp_macos…");
const [binary, sums] = await Promise.all([get(`${base}/yt-dlp_macos`), get(`${base}/SHA2-256SUMS`)]);

const line = sums.toString("utf8").split("\n").find((l) => l.trim().endsWith(" yt-dlp_macos"));
if (!line) throw new Error("yt-dlp_macos nao consta no SHA2-256SUMS");
const expected = line.trim().split(/\s+/)[0];
const actual = createHash("sha256").update(binary).digest("hex");
if (actual !== expected) {
  throw new Error(`SHA-256 nao confere (esperado ${expected}, obtido ${actual}); nada foi gravado`);
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, binary);
await chmod(target, 0o755);
console.log(`yt-dlp_macos ok (${(binary.length / 1e6).toFixed(1)} MB, sha256 conferido)`);
