# Videoimagem UniConverter — app

Conversor de vídeo com fila em lote, construído sobre o banco de presets
extraído do Wondershare UniConverter 17 (ver `../01-analise-uniconverter17.md`).

## Pré-requisitos

- **Node.js 22+** (o engine usa o test runner nativo)
- Para desenvolver: **FFmpeg e ffprobe** (`brew install ffmpeg`) e, para a aba de
  download, **yt-dlp** (`brew install yt-dlp`)

**O app instalado (DMG) não precisa de nada disso:** `npm run dist` baixa e embute
yt-dlp, ffmpeg e ffprobe em `Resources/bin` (um conjunto por arquitetura — Intel e
Apple Silicon), via `tools/fetch-ytdlp.mjs` e `tools/fetch-ffmpeg.mjs`. Os downloads
ficam em `vendor/` (fora do git) e as versões são fixas nesses scripts; para atualizar,
mude a versão (ffmpeg) ou apague o arquivo em `vendor/` (yt-dlp) e gere o DMG de novo.
Os sites mudam toda semana, então refaça o DMG de vez em quando para renovar o yt-dlp.

O ffmpeg com x264/x265 é GPL. Ele roda como programa separado (chamado por linha de
comando), junto do instalador; quem redistribuir o app deve respeitar a GPL dele.

Ordem de busca dos binários: variável de ambiente → embutido no app → PATH → pastas
comuns do Homebrew/MacPorts:

```bash
export VIDEOIMAGEM_FFMPEG=/caminho/para/ffmpeg
export VIDEOIMAGEM_FFPROBE=/caminho/para/ffprobe
export VIDEOIMAGEM_YTDLP=/caminho/para/yt-dlp
```

## Comandos

```bash
npm install
npm start     # build + abre o app
npm test      # 94 testes, inclui conversões reais
npm run build # só compila
npm run pack  # empacota sem gerar instalador (release/mac/)
npm run dist  # gera os DMG (x64 + arm64) em release/
npm run icon  # regenera build/icon.icns
```

Se o banco de presets não for encontrado, gere:

```bash
cd .. && python3 tools/extract_presets.py && python3 tools/build_codec_map.py
```

## Como está organizado

```
src/
  engine/          lógica pura, sem Electron — testável isolada
    types.ts       formato dos dados de ../data
    data.ts        carrega o banco e liga Profile → Format
    limits.ts      avalia as restrições condicionais do formato
    bitrate.ts     bitrate recomendado (âncoras + coeficientes)
    resolver.ts    preset + escolhas do usuário → configuração válida
    passthrough.ts quando dá para usar -c copy em vez de reencodar
    command.ts     monta os argumentos do ffmpeg
    runner.ts      executa e reporta progresso
    probe.ts       ffprobe → metadados
    binaries.ts    acha ffmpeg/ffprobe
  main/            processo principal
    main.ts        janela e ciclo de vida
    ipc.ts         handlers de IPC
    queue.ts       fila de conversão (sem Electron — por isso é testável)
    preferences.ts preferências persistidas em userData/preferences.json
    ipc-types.ts   contrato compartilhado com o renderer
  renderer/        a interface (script clássico, sem acesso a Node)
tests/
  engine.test.ts      31 testes de unidade do engine
  integration.test.ts  5 testes que convertem de verdade
  queue.test.ts       11 testes da fila, também convertendo
```

Nem o engine nem a fila importam Electron. Dá para usá-los de um CLI, de um
servidor ou de outra UI sem mudar uma linha.

## Duas decisões que valem explicação

**O resolvedor roda em ponto fixo.** `resolvePreset()` pega os padrões do
preset, aplica o que o usuário mexeu, e então reavalia as restrições do formato
e reencaixa cada campo até nada mais mudar. Escolher o codec muda os bitrates
válidos; escolher a resolução muda os framerates — um passe só deixa
configuração inválida. Cada ajuste vira uma nota explicando o que mudou e por
quê, e as notas aparecem na UI.

**A fila converte um arquivo por vez.** O ffmpeg já satura todos os núcleos;
dois em paralelo só deixam os dois lentos e brigam por I/O. O preset é global
para o lote, mas **cada item é resolvido contra os próprios metadados** — é o
que faz "igual à origem" e o passthrough funcionarem numa fila de arquivos com
resoluções diferentes. Há um teste dedicado a isso em `queue.test.ts`.

## Verificação automática da interface

```bash
VIDEOIMAGEM_SMOKE=/tmp/tela.png npm start
```

Abre o app, salva uma captura da janela e sai. `VIDEOIMAGEM_SMOKE_EVAL` deixa a
tela num estado específico antes de capturar, e `VIDEOIMAGEM_SMOKE_DELAY`
controla a espera (ms) depois do script:

```bash
VIDEOIMAGEM_SMOKE=/tmp/tela.png VIDEOIMAGEM_SMOKE_DELAY=7000 \
VIDEOIMAGEM_SMOKE_EVAL="(async()=>{
  const g = await api.listPresets();
  const p = g.flatMap(x => x.items).find(i => i.title === 'MP4-HD 720P');
  await selectPreset(p.profileId);
  await refreshQueue(api.addPaths(['/tmp/a.mp4','/tmp/b.mp4']));
  await startQueue();
})()" npm start
```

## Empacotamento

`npm run dist` gera dois DMG em `release/` (Intel e Apple Silicon, ~95 MB cada).

O banco de presets vai para `Contents/Resources/data`, **fora do asar** — o
loader em `engine/data.ts` procura em `process.resourcesPath/data` quando
empacotado. Para conferir que não está pegando o `data/` de desenvolvimento por
acidente, rode o app empacotado a partir de outro diretório:

```bash
cd /tmp && "/caminho/release/mac/Videoimagem UniConverter.app/Contents/MacOS/Videoimagem UniConverter"
```

**Os builds saem sem assinatura** (`mac.identity: null`). No primeiro
abrir, o macOS vai reclamar — botão direito → Abrir, ou
`xattr -dr com.apple.quarantine "/Applications/Videoimagem UniConverter.app"`.
Para distribuir de verdade é preciso um certificado Developer ID e notarização.

O ícone em `build/icon.icns` é **placeholder**, gerado por `tools/make-icon.sh`
com o próprio ffmpeg. Troque `build/icon.png` pela sua arte e rode `npm run icon`.

## Limitações conhecidas

- **115 dos 469 presets não têm tabela de capacidades.** São os presets de
  dispositivo agrupados por marca (Huawei, Apple, Samsung…). A UI mostra
  "(livre)" nos campos, o container é inferido pelo encoder, e uma nota avisa.
  Ver o comentário em `engine/data.ts` com os números medidos.
- **Alguns FourCC têm mapeamento de baixa confiança** (`IPAN`, `qtv5/6/7`,
  `MPON`, `DPCM`, `ADPV`). A UI marca com ⚠ e emite um aviso.
- **O preset é global para a fila**, não por arquivo.
- **Sem edição**: nada de cortar, juntar, marca d'água ou legendas. É conversão.
- **Builds sem assinatura nem notarização.**
