/**
 * Atualizacoes: aviso de versao nova do proprio app e atualizacao do yt-dlp.
 *
 * Tudo vem de releases publicas do GitHub (sem token). O app NAO se reinstala
 * sozinho -- isso exigiria assinatura da Apple --; ele avisa e abre a pagina da
 * release. Ja o yt-dlp e so um binario de dados: baixamos o oficial, conferimos
 * o SHA-256 e guardamos numa pasta do usuario, sem mexer no app instalado.
 *
 * Puro Node (sem Electron); o `fetch` entra por parametro para testar sem rede.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const APP_REPO = "uVitin/videoimagem-uniconverter";
export const YTDLP_REPO = "yt-dlp/yt-dlp";

export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

// --------------------------------------------------------------------------- //
// versoes

/** Compara "1.2.3", "v1.2.3" e datas "2026.10.26": negativo se a < b. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v.trim().replace(/^v/i, "").split(/[^0-9]+/).filter(Boolean).map(Number);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// --------------------------------------------------------------------------- //
// release do GitHub

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface Release {
  tag: string;
  pageUrl: string;
  notes: string;
  assets: ReleaseAsset[];
}

/** Valida o JSON da API; ignora rascunhos e pre-lancamentos. */
export function parseRelease(raw: unknown, repo: string): Release {
  if (typeof raw !== "object" || raw === null) throw new Error("resposta invalida do GitHub");
  const r = raw as Record<string, unknown>;
  if (typeof r.tag_name !== "string" || !r.tag_name) throw new Error("release sem tag");
  if (r.draft === true || r.prerelease === true) throw new Error("release nao final");

  const prefix = `https://github.com/${repo}/`;
  const pageUrl = typeof r.html_url === "string" ? r.html_url : "";
  if (!pageUrl.startsWith(prefix)) throw new Error("endereco da release inesperado");

  const assets: ReleaseAsset[] = [];
  if (Array.isArray(r.assets)) {
    for (const asset of r.assets) {
      const a = asset as Record<string, unknown>;
      if (
        typeof a.name === "string" &&
        typeof a.browser_download_url === "string" &&
        a.browser_download_url.startsWith(`${prefix}releases/download/`)
      ) {
        assets.push({ name: a.name, url: a.browser_download_url });
      }
    }
  }
  return {
    tag: r.tag_name,
    pageUrl,
    notes: typeof r.body === "string" ? r.body : "",
    assets,
  };
}

export async function fetchLatestRelease(repo: string, fetchFn: FetchFn = fetch as FetchFn): Promise<Release> {
  const response = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "videoimagem-uniconverter" },
  });
  if (response.status === 404) throw new Error("ainda nao ha release publicada");
  if (!response.ok) throw new Error(`GitHub respondeu HTTP ${response.status}`);
  return parseRelease(await response.json(), repo);
}

// --------------------------------------------------------------------------- //
// aviso de versao nova do app

export interface AppUpdateStatus {
  available: boolean;
  current: string;
  latest: string;
  url: string;
  notes: string;
}

export async function checkAppUpdate(current: string, fetchFn?: FetchFn): Promise<AppUpdateStatus> {
  const release = await fetchLatestRelease(APP_REPO, fetchFn);
  return {
    available: compareVersions(release.tag, current) > 0,
    current,
    latest: release.tag.replace(/^v/i, ""),
    url: release.pageUrl,
    notes: release.notes,
  };
}

/** So abrimos no navegador paginas das releases do proprio projeto. */
export function isAppReleaseUrl(url: string): boolean {
  return url.startsWith(`https://github.com/${APP_REPO}/releases`);
}

// --------------------------------------------------------------------------- //
// yt-dlp

export interface YtDlpUpdateResult {
  updated: boolean;
  from: string;
  to: string;
}

const YTDLP_ASSET = "yt-dlp_macos";

/**
 * Baixa o yt-dlp mais novo para `targetPath` se `current` estiver atras.
 * Confere o SHA-256 (arquivo de somas da propria release), grava ao lado e so
 * entao troca o arquivo, e testa que o binario novo responde -- um download
 * ruim nunca substitui um yt-dlp que funciona.
 */
export async function updateYtDlp(
  current: string,
  targetPath: string,
  fetchFn: FetchFn = fetch as FetchFn,
): Promise<YtDlpUpdateResult> {
  const release = await fetchLatestRelease(YTDLP_REPO, fetchFn);
  if (compareVersions(release.tag, current) <= 0) {
    return { updated: false, from: current, to: current };
  }

  const binaryAsset = release.assets.find((a) => a.name === YTDLP_ASSET);
  const sumsAsset = release.assets.find((a) => a.name === "SHA2-256SUMS");
  if (!binaryAsset || !sumsAsset) throw new Error("a release do yt-dlp nao traz o binario do macOS");

  const download = async (url: string): Promise<Buffer> => {
    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`download falhou (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  };
  const [binary, sums] = await Promise.all([download(binaryAsset.url), download(sumsAsset.url)]);

  const line = sums
    .toString("utf8")
    .split("\n")
    .find((l) => l.trim().endsWith(` ${YTDLP_ASSET}`));
  const expected = line?.trim().split(/\s+/)[0];
  if (!expected) throw new Error("soma SHA-256 do yt-dlp nao encontrada");
  const actual = createHash("sha256").update(binary).digest("hex");
  if (actual !== expected) throw new Error("o yt-dlp baixado nao confere com o SHA-256; ignorado");

  await mkdir(dirname(targetPath), { recursive: true });
  const temp = join(dirname(targetPath), `.yt-dlp-${process.pid}.tmp`);
  try {
    await writeFile(temp, binary);
    await chmod(temp, 0o755);
    const { stdout } = await exec(temp, ["--version"], { timeout: 30_000 });
    const version = stdout.trim();
    if (!version) throw new Error("o yt-dlp baixado nao respondeu");
    await rename(temp, targetPath);
    return { updated: true, from: current, to: version };
  } finally {
    await rm(temp, { force: true });
  }
}
