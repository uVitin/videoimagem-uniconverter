# data/ — banco de presets extraído

Gerado por `tools/extract_presets.py` e `tools/build_codec_map.py`.
Regenerar: `python3 tools/extract_presets.py && python3 tools/build_codec_map.py`

| Arquivo | Origem | Conteúdo |
|---|---|---|
| `categories.json` | `Format.pro` | 8 categorias (Video, Audio, Devices, Editing, HD &3D, Web Sharing, Image, Custom) |
| `formats.json` | `Format.pro` | **174 formatos** com valores permitidos + limites condicionais |
| `profiles.json` | `preset_profiles.pro` | **469 presets** de dispositivo/plataforma + índice de 91 formatos |
| `bitrate-model.json` | `ParamterRules_Std.plist` | tabelas do algoritmo de bitrate recomendado |
| `device-rules.json` | `ParamterRules_Std.plist` | 116 formatos → 18 conjuntos de restrição |
| `passthrough.json` | `LossLess_xml.xml` | 8 containers onde cabe `-c copy` em vez de reencode |
| `codec-map.json` | **nosso** | FourCC → encoder FFmpeg (ver aviso abaixo) |

## O modelo de dados em uma frase

Um **formato** (`formats.json`) diz *o que é possível*: lista de resoluções, framerates,
bitrates, encoders válidos — e `limits`, que são restrições condicionais do tipo
"se o áudio for AC-3, então só 2 ou 6 canais".

Um **preset** (`profiles.json`) diz *o que usar por padrão* para um alvo concreto
("iPhone 15", "YouTube 4K", "Premiere Pro"), apontando para um formato via `format_id`.

Resolver um preset = pegar os defaults do preset, validar contra o formato, aplicar
os `limits` que casarem com a combinação escolhida.

### Exemplo de `limits`

```json
{ "when": { "AudioEncoder": "AC3" },
  "then": { "channels": { "default": 2, "allowed": [2, 6] } } }
```

A condição pode combinar chaves (`AudioEncoder` + `Resolution`, por exemplo). Avalie
todos os `limits` cuja condição casa e faça a interseção dos conjuntos resultantes.

## Modelo de bitrate (`bitrate-model.json`)

Três tabelas que juntas reproduzem o "bitrate recomendado" deles:

1. `fourcc_to_family` — encoder → família (`M264` → `H.264(Baseline)`, `K264` → `4K264`)
2. `family_anchors` — por família, âncoras `{width, height, fps, video_bitrate_kbps}`
3. `family_coefficient` — multiplicador relativo ao H.264:
   `MJPEG 8`, `MPEG-2 2`, `H.263 1.5`, `MPEG-4 1.5`, `VP8 1.2`, `VC-1 1`, `H.264 1`

Algoritmo: escolha a âncora mais próxima da resolução alvo, escale por
(pixels alvo / pixels da âncora) e por (fps alvo / fps da âncora), multiplique
pelo coeficiente da família.

## ⚠️ `codec-map.json` não é dado extraído

Os FourCC são observados no app, mas a tradução para encoder FFmpeg é **nossa decisão
de design**. Cada entrada tem `confidence`:

- `high` — FourCC autoexplicativo ou padrão da indústria (`apch` = ProRes 422 HQ)
- `medium` — família clara, implementação inferida pelo prefixo
- `low` — palpite, **valide antes de confiar** (`qtv5/6/7`, `MPON`, `qta0`, `DPCM`, `ADPV`)

O prefixo do FourCC deles indica o *backend*, não o codec: `X264`, `M264`, `FAVC`,
`MAVC`, `PAVC`, `HAVC`, `IAVC`, `K264` são **todos H.264** com implementações
diferentes. Para nós todos colapsam em `libx264` / `h264_videotoolbox`.

Sem encoder definido (FFmpeg não codifica, ou FourCC não resolvido):
`APE` (só decode), `caf`/`qta0` (containers, não codecs), `qtv5`/`qtv6`/`qtv7`, `MPON`.
