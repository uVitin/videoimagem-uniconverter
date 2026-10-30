# Videoimagem UniConverter

Conversor de vídeo próprio, construído a partir da engenharia reversa do
Wondershare UniConverter 17.

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| `01-analise-uniconverter17.md` | relatório da engenharia reversa: como o UniConverter converte, baixa e "melhora" vídeo |
| `tools/` | extratores em Python que leem os XML/plist do app instalado |
| `data/` | o banco de presets extraído, em JSON (174 formatos, 469 presets) |
| `app/` | o conversor: engine em TypeScript + interface Electron |

Comece pelo [`app/README.md`](app/README.md) para rodar, e por
[`data/README.md`](data/README.md) para entender o modelo de dados.

## Rodar

```bash
brew install ffmpeg          # só para desenvolver; o app instalado (DMG) já leva ffmpeg e yt-dlp
brew install yt-dlp          # só para o download em desenvolvimento
                             # (alternativa: binário em bin/ + VIDEOIMAGEM_YTDLP=bin/yt-dlp_macos)
cd app && npm install && npm start
```

`npm test` roda 94 testes, incluindo conversões de verdade.

## Estado

- ✅ **Conversão** — engine, interface, fila em lote, empacotamento (DMG)
- ✅ **Download** de vídeos — validado com o yt-dlp real (vídeo+áudio em mp4, só áudio)
- ⬜ **Melhoria de qualidade**

## Sobre a engenharia reversa

A análise serviu para entender *arquitetura e técnica* — qual engine, qual
pipeline, como os presets são modelados. O código do produto analisado não foi
copiado: o conversor aqui é uma implementação própria sobre FFmpeg.
