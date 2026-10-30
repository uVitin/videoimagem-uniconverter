/**
 * Testes do download. Nao usam rede: um yt-dlp falso (script sh) responde no
 * mesmo formato do real, o que exercita o parser, o gerenciador e o cancelamento.
 *
 * ATENCAO: isto NAO prova que o yt-dlp real aceita as flags de buildDownloadArgs
 * (--print after_move, --progress-template, -S). O fake foi escrito a partir da
 * documentacao. Isso so se confirma baixando algo de verdade com o binario real.
 */

import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  buildDownloadArgs,
  formatSelector,
  lastErrorLine,
  locateYtDlp,
  normalizeUrl,
  parseMediaInfo,
  parsePathLine,
  parseProgressLine,
} from "../src/engine/ytdlp";
import { DownloadManager, type DownloadItem } from "../src/main/downloads";

let workDir = "";
let fakePath = "";

/**
 * O URL decide o comportamento:
 *   /fail   -> falha na analise
 *   /broken -> analisa, mas o download termina com erro
 *   /slow   -> baixa devagar (para testar cancelamento)
 *   outro   -> baixa direito
 */
const FAKE_YTDLP = `#!/bin/sh
url=""
dir="."
analyze=0
prev=""
for arg in "$@"; do
  [ "$arg" = "-J" ] && analyze=1
  [ "$prev" = "-P" ] && dir="$arg"
  prev="$arg"
  url="$arg"
done

if [ "$analyze" = "1" ]; then
  case "$url" in
    */fail*) echo "ERROR: Unsupported URL: $url" >&2; exit 1;;
    */live*) echo '{"title":"ao vivo","is_live":true,"formats":[]}'; exit 0;;
  esac
  echo '{"title":"Video de teste","uploader":"Canal","duration":42,"formats":[{"height":1080},{"height":720},{"height":1080},{"height":null}]}'
  exit 0
fi

case "$url" in
  */broken*) echo "ERROR: HTTP Error 403: Forbidden" >&2; exit 1;;
  */slow*)
    echo "VIPROG|1000|10000|NA|500|18|137"
    exec sleep 30;;
esac

echo "VIPROG|2500|10000|NA|1000|7|137"
echo "VIPROG|10000|10000|NA|NA|NA|137"
echo "VIPROG|100|NA|400|NA|NA|140"
printf 'dados' > "$dir/Video de teste.mp4"
echo "VIPATH|$dir/Video de teste.mp4"
`;

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), "vi-download-"));
  fakePath = join(workDir, "yt-dlp-falso");
  await writeFile(fakePath, FAKE_YTDLP, "utf8");
  await chmod(fakePath, 0o755);
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------- //

describe("normalizeUrl", () => {
  it("aceita http e https", () => {
    assert.equal(normalizeUrl("  https://exemplo.com/v?id=1  "), "https://exemplo.com/v?id=1");
    assert.equal(normalizeUrl("http://exemplo.com/"), "http://exemplo.com/");
  });

  it("recusa esquemas que abrem arquivos locais ou executam coisas", () => {
    assert.throws(() => normalizeUrl("file:///etc/passwd"), /http/);
    assert.throws(() => normalizeUrl("javascript:alert(1)"), /http/);
    assert.throws(() => normalizeUrl("ftp://exemplo.com/a"), /http/);
  });

  it("recusa texto que nao e URL", () => {
    assert.throws(() => normalizeUrl("nao e um link"), /URL/);
    assert.throws(() => normalizeUrl(""), /URL/);
  });
});

describe("parser da saida do yt-dlp", () => {
  it("le uma linha de progresso completa", () => {
    const p = parseProgressLine("VIPROG|2500|10000|NA|1000|7|137")!;
    assert.equal(p.fraction, 0.25);
    assert.equal(p.downloadedBytes, 2500);
    assert.equal(p.totalBytes, 10000);
    assert.equal(p.speedBytesPerSec, 1000);
    assert.equal(p.etaSeconds, 7);
    assert.equal(p.formatId, "137");
  });

  it("usa a estimativa quando o tamanho exato e desconhecido", () => {
    const p = parseProgressLine("VIPROG|100|NA|400|NA|NA|140")!;
    assert.equal(p.totalBytes, 400);
    assert.equal(p.fraction, 0.25);
    assert.equal(p.speedBytesPerSec, undefined);
    assert.equal(p.etaSeconds, undefined);
  });

  it("fracao nula quando nao ha tamanho nenhum (ex. HLS)", () => {
    const p = parseProgressLine("VIPROG|500|NA|NA|NA|NA|NA")!;
    assert.equal(p.fraction, null);
    assert.equal(p.formatId, undefined);
  });

  it("nunca passa de 100% se a estimativa estava errada", () => {
    assert.equal(parseProgressLine("VIPROG|900|NA|500|NA|NA|x")!.fraction, 1);
  });

  it("ignora linhas que nao sao nossas", () => {
    assert.equal(parseProgressLine("[download] Destination: x.mp4"), null);
    assert.equal(parsePathLine("[Merger] Merging formats"), null);
  });

  it("le o caminho final, mesmo com espacos e barras", () => {
    assert.equal(parsePathLine("VIPATH|/tmp/a b/Video [x].mp4"), "/tmp/a b/Video [x].mp4");
    assert.equal(parsePathLine("VIPATH|"), null);
  });

  it("extrai a linha ERROR do stderr, nao o ruido em volta", () => {
    const stderr = "WARNING: algo\nERROR: Video unavailable\n[debug] fim\n";
    assert.equal(lastErrorLine(stderr), "Video unavailable");
    assert.equal(lastErrorLine(""), "falha desconhecida");
  });
});

describe("parseMediaInfo", () => {
  it("junta alturas sem repetir e da maior para a menor", () => {
    const info = parseMediaInfo(
      '{"title":"T","duration":10,"formats":[{"height":720},{"height":1080},{"height":720},{}]}',
    );
    assert.deepEqual(info.heights, [1080, 720]);
    assert.equal(info.title, "T");
    assert.equal(info.durationSeconds, 10);
    assert.equal(info.isLive, false);
  });

  it("aguenta JSON sem formatos nem titulo", () => {
    const info = parseMediaInfo("{}");
    assert.deepEqual(info.heights, []);
    assert.equal(info.title, "sem titulo");
  });
});

describe("buildDownloadArgs", () => {
  const base = { url: "https://exemplo.com/v", outputDir: "/tmp/saida" };

  it("limita a altura quando o usuario escolhe uma resolucao", () => {
    assert.equal(formatSelector("1080"), "bv*[height<=1080]+ba/b[height<=1080]/b");
    assert.equal(formatSelector("best"), "bv*+ba/b");
  });

  it("video: junta em mp4 e aponta o ffmpeg", () => {
    const args = buildDownloadArgs({ ...base, quality: "720", ffmpegPath: "/usr/local/bin/ffmpeg" });
    assert.ok(args.includes("--merge-output-format"));
    assert.ok(!args.includes("-x"));
    assert.equal(args[args.indexOf("--ffmpeg-location") + 1], "/usr/local/bin");
    assert.equal(args[args.indexOf("-P") + 1], "/tmp/saida");
    assert.ok(args.includes("--no-playlist"));
  });

  it("audio: extrai sem recodificar", () => {
    const args = buildDownloadArgs({ ...base, quality: "audio" });
    assert.ok(args.includes("-x"));
    assert.equal(args[args.indexOf("--audio-format") + 1], "best");
    assert.ok(!args.includes("--merge-output-format"));
  });

  it("a URL vai depois de '--', entao nunca vira opcao", () => {
    const args = buildDownloadArgs({ ...base, url: "https://exemplo.com/--exec", quality: "best" });
    assert.equal(args[args.length - 2], "--");
    assert.equal(args[args.length - 1], "https://exemplo.com/--exec");
  });
});

// --------------------------------------------------------------------------- //

interface Recorder {
  manager: DownloadManager;
  changes: DownloadItem[];
  done: DownloadItem[];
  progress: number[];
  settled(id: string): Promise<DownloadItem>;
}

function makeManager(concurrency = 2): Recorder {
  const changes: DownloadItem[] = [];
  const done: DownloadItem[] = [];
  const progress: number[] = [];
  const waiters: Array<{ id: string; resolve: (item: DownloadItem) => void }> = [];
  const FINAL = new Set(["done", "failed", "canceled"]);

  const manager = new DownloadManager(
    { ytdlpPath: fakePath, concurrency },
    {
      onItemChanged: (item) => {
        changes.push(item);
        if (FINAL.has(item.status)) {
          for (const waiter of waiters.filter((w) => w.id === item.id)) waiter.resolve(item);
        }
      },
      onProgress: (_id, p) => {
        if (p.fraction != null) progress.push(p.fraction);
      },
      onLog: () => {},
      onItemDone: (item) => done.push(item),
    },
  );

  return {
    manager,
    changes,
    done,
    progress,
    settled: (id) =>
      new Promise((resolve) => {
        const existing = changes.find((c) => c.id === id && FINAL.has(c.status));
        if (existing) resolve(existing);
        else waiters.push({ id, resolve });
      }),
  };
}

describe("DownloadManager", () => {
  it("analisa, baixa e informa o arquivo final", async () => {
    const r = makeManager();
    const item = r.manager.add({ url: "https://exemplo.com/ok", quality: "best", outputDir: workDir });
    const final = await r.settled(item.id);

    assert.equal(final.status, "done");
    assert.equal(final.title, "Video de teste");
    assert.equal(final.outputPath, join(workDir, "Video de teste.mp4"));
    assert.equal(await readFile(final.outputPath!, "utf8"), "dados");
    assert.equal(r.done.length, 1);

    const order = r.changes.filter((c) => c.id === item.id).map((c) => c.status);
    assert.deepEqual(order.slice(0, 3), ["pending", "analyzing", "running"]);
    assert.ok(r.progress.includes(0.25) && r.progress.includes(1));
  });

  it("URL invalida falha ao adicionar, sem criar item nem chamar o binario", () => {
    const r = makeManager();
    assert.throws(
      () => r.manager.add({ url: "file:///etc/passwd", quality: "best", outputDir: workDir }),
      /http/,
    );
    assert.equal(r.manager.list().length, 0);
  });

  it("erro na analise vira falha com a mensagem do yt-dlp", async () => {
    const r = makeManager();
    const item = r.manager.add({ url: "https://exemplo.com/fail", quality: "best", outputDir: workDir });
    const final = await r.settled(item.id);
    assert.equal(final.status, "failed");
    assert.match(final.error!, /Unsupported URL/);
    assert.equal(r.done.length, 0);
  });

  it("erro durante o download vira falha com o ERROR do stderr", async () => {
    const r = makeManager();
    const item = r.manager.add({ url: "https://exemplo.com/broken", quality: "best", outputDir: workDir });
    const final = await r.settled(item.id);
    assert.equal(final.status, "failed");
    assert.equal(final.error, "HTTP Error 403: Forbidden");
  });

  it("recusa transmissao ao vivo em vez de baixar para sempre", async () => {
    const r = makeManager();
    const item = r.manager.add({ url: "https://exemplo.com/live", quality: "best", outputDir: workDir });
    const final = await r.settled(item.id);
    assert.equal(final.status, "failed");
    assert.match(final.error!, /ao vivo/);
  });

  it("clicar duas vezes em Baixar nao duplica o download em andamento", async () => {
    const r = makeManager();
    const a = r.manager.add({ url: "https://exemplo.com/slow", quality: "best", outputDir: workDir });
    const b = r.manager.add({ url: "https://exemplo.com/slow", quality: "best", outputDir: workDir });
    assert.equal(a.id, b.id);
    assert.equal(r.manager.list().length, 1);

    r.manager.cancelItem(a.id);
    await r.settled(a.id);
  });

  it("cancelar um download em andamento mata o processo e marca cancelado", async () => {
    const r = makeManager();
    const item = r.manager.add({ url: "https://exemplo.com/slow", quality: "best", outputDir: workDir });

    // espera chegar em 'running' (a analise do fake e instantanea)
    for (let i = 0; i < 100 && !r.changes.some((c) => c.id === item.id && c.status === "running"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(r.changes.some((c) => c.id === item.id && c.status === "running"));

    const started = Date.now();
    assert.equal(r.manager.cancelItem(item.id), true);
    const final = await r.settled(item.id);

    assert.equal(final.status, "canceled");
    assert.ok(Date.now() - started < 5000, "o cancelamento nao pode esperar o sleep de 30s");
    assert.equal(r.done.length, 0);
  });

  it("respeita o limite de paralelismo", async () => {
    const r = makeManager(1);
    const slow = r.manager.add({ url: "https://exemplo.com/slow", quality: "best", outputDir: workDir });
    const next = r.manager.add({ url: "https://exemplo.com/ok2", quality: "best", outputDir: workDir });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const status = (id: string) => r.manager.list().find((i) => i.id === id)!.status;
    assert.equal(status(slow.id), "running");
    assert.equal(status(next.id), "pending", "com concurrency 1 o segundo espera");

    r.manager.cancelItem(slow.id);
    const final = await r.settled(next.id);
    assert.equal(final.status, "done", "ao liberar a vaga, o proximo comeca sozinho");
  });

  it("cancelar um item que ainda esta na fila nao chega a chamar o binario", async () => {
    const r = makeManager(1);
    const slow = r.manager.add({ url: "https://exemplo.com/slow", quality: "best", outputDir: workDir });
    const waiting = r.manager.add({ url: "https://exemplo.com/ok3", quality: "best", outputDir: workDir });

    assert.equal(r.manager.cancelItem(waiting.id), true);
    assert.equal(r.manager.list().find((i) => i.id === waiting.id)!.status, "canceled");

    r.manager.cancelItem(slow.id);
    await r.settled(slow.id);
  });

  it("clearFinished tira so o que terminou", async () => {
    const r = makeManager();
    const ok = r.manager.add({ url: "https://exemplo.com/ok4", quality: "best", outputDir: workDir });
    await r.settled(ok.id);
    const slow = r.manager.add({ url: "https://exemplo.com/slow2", quality: "best", outputDir: workDir });

    r.manager.clearFinished();
    assert.deepEqual(r.manager.list().map((i) => i.id), [slow.id]);

    r.manager.cancelItem(slow.id);
    await r.settled(slow.id);
  });
});

// --------------------------------------------------------------------------- //

describe("yt-dlp real", () => {
  it("esta instalado e responde a --version", async (t) => {
    let found;
    try {
      found = await locateYtDlp(true);
    } catch {
      t.skip("yt-dlp nao instalado");
      return;
    }
    assert.match(found.version, /^\d{4}\.\d{2}\.\d{2}/);
  });
});
