# Engenharia reversa — Wondershare UniConverter 17.6.0.688

Alvo: `/Applications/Wondershare UniConverter 17.app` (768 MB, x86_64 apenas, `com.Wondershare.UniConverter17`)
Data da análise: 2026-10-22
Método: análise estática do bundle (sem execução do app). Tudo abaixo marcado como **[obs]** foi observado
diretamente em arquivo/binário; **[inf]** é inferência a partir de símbolos ou strings.

---

## 0. Arquitetura geral

O app não é monolítico. É um **host Objective-C** (`MacOS/Wondershare UniConverter 17`, 26 MB) que orquestra
~46 frameworks e ~160 dylibs/executáveis auxiliares, cada um com uma responsabilidade. **[obs]**

| Camada | Componentes |
|---|---|
| UI / orquestração | binário principal + `.nib`s em `Resources/` (622 arquivos) |
| Conversão | `MediaConvertKit.framework`, `kernaldec.dylib`, `WS_*` dylibs, `MacOS/PlugIns/wp_*.dylib` |
| Download | `MediaDownloadKit.framework` (loader) + `MediaDownloader.bundle` (baixado) |
| Enhancement local | `libimgenchance.dylib`, `NewMagicXEAlgorithms.dylib`, `libmagic_xe_wrapper.dylib` |
| Enhancement IA | HTTP → `https://vcu-api.300624.com/v1` |
| Probe/metadata | `MediaInfoKit.framework`, `WS_MediaInfoLib.dylib` |

---

## 1. Como ele converte vídeo

### 1.1 O motor é FFmpeg estático, não o CLI

`MacOS/kernaldec.dylib` (38,9 MB) tem **libavcodec/libavformat ligados estaticamente**, junto com
**x264, x265 e libvpx**. Strings encontradas: `libavcodec` (146x), `libavformat` (59x), `x264` (61x),
`x265` (50x), `Lavf58.29.100`, `Lavc58.54.100`. **[obs]**

→ Isso corresponde à série **FFmpeg 4.2 / 4.3**. **[inf]**

Existe também um binário `MacOS/ffmpeg` de 80,7 MB, que é o build público
**`8.0.1-tessus`** (`--extra-version=tessus`, `--prefix=/opt/ffmpeg` — o build estático do evermeet.cx,
GPL, com x264/x265/aom/dav1d/libvpx/lame/opus/vmaf etc.). **[obs]**

Mas esse CLI **não é o caminho principal de conversão**. Em `MediaConvertKit` existe um wrapper
chamado `SimpleFFmpegKit` cujas únicas strings de uso são:

```
[Export Chapters] FFmpeg not available
FFmpeg failed to export chapters.
[Export Chapters][MP3] FFmpeg not available
FFmpeg failed to export MP3 ID3v2 chapters.
```

→ O CLI é usado para tarefas acessórias (exportar capítulos, ID3v2). A conversão real roda
**in-process** pela libav* dentro de `kernaldec.dylib`. **[inf, forte]**

### 1.2 Pipeline de plugins

Todo o pipeline é um sistema de plugins registrado por XML. **[obs]**

```
arquivo → fdp*/vdp* (demux + decode) → WS_VideoCompositor / filtros → wp_* (encode + mux) → saída
```

| Diretório | Função | Exemplos |
|---|---|---|
| `MacOS/DecPlugins/` | decoders de vídeo/áudio | `vdpVideoToolBox.dylib`, `vdpdav1d.dylib`, `vdpAC3`, `vdpDTS`, `vdpHEIC` |
| `MacOS/PlugIns/` | **encoders + muxers** (`wp_` = write plugin) | `wp_h264`, `wp_hevc`, `wp_hevc_10bit`, `wp_videotoolbox`, `wp_aom`, `wp_vp8`, `wp_mp4`, `wp_mkv`, `wp_mxf`, `wp_cfhd` |
| `MacOS/ImagePlugins/` | decode de imagem | `idptbjpg`, `idptbpng`, `idpfi` |
| `MacOS/AudioPlugin/` | efeitos de áudio (estilo LADSPA) | `denoise`, `limiter`, `reverb`, `pitch_shifter`, `10bandeq`, `up_mixer`, `surround_panner` |
| `MacOS/EffectPlug/` | efeitos de vídeo GPU | `Shader/`, `Metal/`, `EffectShaders/`, `VideoEffect.xml` |

Registro: `Resources/Dll_Info_Config.xml` mapeia extensão → FourCC → dylib → prioridade. Ex.: **[obs]**

```xml
<FDPAVI><FORMATE_1>
  <EXTNAME CHAR="">.avi</EXTNAME>
  <PRIORITY INT="">15</PRIORITY>
  <DLLNAME CHAR="">fdpAVI.dylib</DLLNAME>
  <FOURCC DWORD="">' IVA'</FOURCC>
</FORMATE_1></FDPAVI>
```

### 1.3 Aceleração por hardware

Binários que linkam `VideoToolbox.framework`: **[obs]**

- `MacOS/PlugIns/wp_videotoolbox.dylib` → **encode por hardware**. Símbolos indefinidos incluem
  `VTCompressionSessionCreate`, `VTCompressionSessionEncodeFrame`, `kVTCompressionPropertyKey_AverageBitRate`,
  `kVTCompressionPropertyKey_ConstantBitRate`, `kVTCompressionPropertyKey_MaxKeyFrameInterval`,
  `kVTCompressionPropertyKey_ProfileLevel`, `kVTCompressionPropertyKey_HDRMetadataInsertionMode`,
  `kVTCompressionPropertyKey_PreserveAlphaChannel`, `MultiPassStorage` (two-pass).
- `MacOS/DecPlugins/vdpVideoToolBox.dylib` → decode por hardware.
- `kernaldec.dylib` menciona `videotoolbox_vld`, `QSV`, `AMF`, `vaapi` (herança do build multiplataforma).

→ macOS: decode e encode via VideoToolbox quando disponível; fallback para x264/x265 em software. **[inf]**

Extras: `wsCUDA.dylib` (NVIDIA, irrelevante em Mac moderno), `libEffectMgrMetal.dylib` + `default.metallib`
(efeitos em Metal), `WS_SmartRender.dylib` (**smart render / remux sem reencode**).

### 1.4 Banco de presets — a parte mais reaproveitável

Tudo em XML legível em `Contents/Resources/`: **[obs]**

| Arquivo | Tamanho | Conteúdo |
|---|---|---|
| `preset_profiles.pro` | 305 KB | **469 `<Profile>` e 91 `<Format>`** — cada preset de saída |
| `Format.pro` | 193 KB | categorias (Video, Audio, Devices, Editing, Web) e formatos |
| `EncParams_Config.xml` | 253 KB | **tabelas de valores válidos por codec** (bitrate, sample rate, canais…) |
| `LossLess_xml.xml` | 1,5 KB | mapa container→codec onde é possível **remux sem reencode** |
| `ParamterRules_Std.plist` | 28 KB | `BitrateControlTable`, `FourCCTable` (`K264`→`4K264`) |
| `MPDemuxList.xml` | — | lista de demuxers |

Exemplo de preset: **[obs]**

```xml
<Profile id="0" formatid="0" Title="HTC Vive" pixId="icon24_htc" defaultAutoEnc="126">
    <defaultFrameRate>30.00</defaultFrameRate>
    <defaultSampleRate>44100</defaultSampleRate>
    <defaultChannel>2</defaultChannel>
    <defaultAudioEncoders>AAC </defaultAudioEncoders>
    <defaultVideoEncoders>H264</defaultVideoEncoders>
    <defaultAudioBitrate>192</defaultAudioBitrate>
    <defaultResolution>1920*1080</defaultResolution>
    <defaultVideoBitrate>20000</defaultVideoBitrate>
</Profile>
```

Exemplo de `EncParams_Config.xml`: **[obs]**

```xml
<_ac3><AUDIO><_AC3 EncName="AC-3 Audio"><PARAMS>
  <A_BITRATE _TYPE="INT">{32000, 40000, 48000, 56000, 64000, 80000, 96000, 112000, 128000, ...}</A_BITRATE>
</PARAMS></_AC3></AUDIO></_ac3>
```

→ É literalmente um **banco de dados de receitas de encode**. O valor de UniConverter não está no
codec (é FFmpeg), está nessa curadoria de 469 presets.

---

## 2. Como ele baixa vídeos

### 2.1 O downloader é um plugin atualizado pelo servidor

`MediaDownloadKit.framework` tem apenas **99 KB** e é um *loader*. Strings: **[obs]**

```
MediaDownloader.bundle
Application Support / Library / Bundles3
Download Bundle load error, remove it!
WSMediaSniffer
WSPlaylistAnalyster
```

O motor real fica fora do app, em:

```
~/Library/Application Support/MediaDownloadKit/Bundles3/5.1.74/MediaDownloader.bundle   (21 MB)
```

Versão **5.1.74**, binários datados de **15/10/2026** — ou seja, atualizado sem precisar atualizar o app.
Isso é essencial porque YouTube quebra extratores toda semana. **[obs]**

Conteúdo de `MediaDownloader.bundle/Contents/MacOS/`: **[obs]**

| Binário | Função |
|---|---|
| `MediaDownloader` (689 KB) | orquestrador |
| `MediaDownloadClient` (359 KB) | cliente HTTP / fila de download |
| `DynamicAnalysiser` (221 KB) | análise dinâmica de página (WKWebView) |
| `libM3u8downloader.dylib` (291 KB) | **HLS / m3u8** |
| `rtmpdump` (526 KB) | streams **RTMP** |
| `UniConverter Chrome Helper` (29 KB) | integração com extensão Chrome |
| `updateProcess` (50 KB) | auto-atualização do próprio bundle |

### 2.2 Extração: fork privado do youtube-dl

Em `MediaDownloader.bundle/Contents/Resources/python/` há um **CPython 3.7 embutido**, com
`lib/python37.zip` contendo (só `.pyc`, fonte removido): **[obs]**

```
youtube_dl/              ← 785 arquivos em youtube_dl/extractor/
execjs/                  ← executa JS (decifra signature do YouTube)
Crypto/                  ← pycryptodome
Cookies/                 ← fork de browser-cookie3 + keyring (lê cookies do navegador do usuário)
websocket/  lz4/  certifi/
Core/                    ← módulo próprio deles, version.ini = 3.0.0.126
```

- `youtube_dl/version.pyc` declara `__version__ = '2020.03.08'` **[obs]**
- Mas os `.pyc` foram compilados em **09/10/2026** **[obs]**

→ É um **fork privado** do youtube-dl 2020.03.08, mantido por eles desde então (não migraram para yt-dlp). **[inf]**
O `youtube.pyc` ainda tem a estrutura antiga (`_get_ytplayer_config`, `_parse_sig_swf`, `_decrypt_signature`),
sem InnerTube nem PO token. **[obs]**

### 2.3 YouTube moderno: PO Token via WKWebView real

O que o Python antigo não faz, o lado nativo faz. Em `Resources/` existem: **[obs]**

- **`bgutils-bundle.js`** (14,9 KB) — o projeto público **`bgutils-js`** compilado
  (`BgUtils.BotGuardClient`, `BgUtils.WebPoMinter`, `integrityToken`, `webPoSignalOutput`)
- **`driver.js`** (6,5 KB) — script de injeção, **com comentários do próprio desenvolvedor**

O `driver.js` documenta o fluxo inteiro (citação literal do arquivo): **[obs]**

```js
// Runs inside the real https://www.youtube.com page loaded by WKWebView.
// Bridges the result back to the ObjC host via window.webkit.messageHandlers.bridge.
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
```

Sequência (os próprios `step = "..."` do código): **[obs]**

1. `init` — lê `window.__botguardContentBinding` (injetado pelo host ObjC)
2. `parse-homepage` — extrai `ytcfg.set({...})` e `window.ytAtN({...})` do HTML para achar `bgChallenge`
3. `fetch-att-get` — fallback: `POST https://www.youtube.com/youtubei/v1/att/get`
   com `clientName: "WEB", clientVersion: "2.20260817.01.00"`
4. `load-interpreter` — carrega o interpretador BotGuard como `<script src>` real.
   O comentário explica **por que**: o asset não tem CORS, então `fetch()` seria bloqueado num
   navegador de verdade; e o youtube.com força **Trusted Types**, então eles criam uma
   `trustedTypes.createPolicy("botguard-wkwebview#"+Date.now())` para poder atribuir `.src`.
5. `botguard-snapshot` — `BgUtils.BotGuardClient.create({program, globalName, globalObject: window})`
   → `.snapshot({ webPoSignalOutput })`
6. `fetch-generate-it` — `POST BgUtils.buildURL("GenerateIT")` com `[REQUEST_KEY, botguardResponse]`
   → recebe `[integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken]`
7. `mint-po-token` — `BgUtils.WebPoMinter.create(...).mintAsWebsafeString(contentBinding)`
8. devolve `{poToken, contentBinding, expiresAt}` ao ObjC via `messageHandlers.bridge`

→ **Conclusão:** o download de YouTube usa um navegador real (WKWebView) carregando youtube.com
para gerar o PO token legítimo, e o extrator Python recebe esse token. Para os outros ~780 sites,
o fork de youtube-dl resolve sozinho. HLS vai para `libM3u8downloader`, RTMP para `rtmpdump`. **[inf, forte]**

---

## 3. Como ele "melhora a qualidade"

São **dois caminhos completamente diferentes**, e essa é a descoberta mais importante.

### 3.1 Caminho local = OpenCV clássico, zero IA

`libimgenchance.dylib` tem 16 MB, mas os 16 MB são **OpenCV 4.1 ligado estaticamente**.
Os únicos símbolos próprios exportados são: **[obs]**

```
CAlgorithmClass_Enchance::Process(cv::Mat&, cv::Mat&, Algorithm_Params*)
CAlgorithmClass_Enchance::SetProcessAlgorithm(Algorithm_Params*)
CAlgorithmClass_EnchanceImpl::Process(unsigned char*, unsigned char*, int, int)
```

Todo o resto é `cv::` — `PCACompute`, `medianBlur`, `meanStdDev`, `checkRange`, `solveCubic`,
`FileStorage`, `cvflann`. **Nenhum runtime de rede neural**: busca por `ncnn|MNN|onnxruntime|tensorflow|
libtorch|coreml|openvino|TNN|paddle` retornou **zero** ocorrências. **[obs]**

Idem `WS_MagicXEAlgorithms_V2.dylib` e `NewMagicXEAlgorithms.dylib` — linkam apenas
`libopencv_core/imgproc/imgcodecs 4.1` + `ws_libyuv`. **[obs]**

→ O "enhance" local é **processamento de imagem clássico**: auto-contraste/CLAHE, correção de cor,
unsharp mask, denoise temporal, deblock. **[inf]**

O único modelo neural embarcado em todo o bundle é
`Resources/face_detection_yunet_2023mar.onnx` — que é o **modelo público YuNet do OpenCV Zoo**,
usado para detecção de rosto, não para enhancement. **[obs]**

### 3.2 Magic XE: SDK de plugins baixados sob demanda

`libmagic_xe_wrapper.dylib` expõe um carregador dinâmico: **[obs]**

```cpp
magic_xe::MagicXEPlugin::CreateInstance(char const*)
magic_xe::MagicXEPlugin::LoadMagicXELibrary(char const* path, char const* name)
magic_xe::MagicXEPlugin::PrepareProcess(magic_xe::Frame const*, MagicXEPluginParam const*, MagicXEOutPutParam*)
magic_xe::MagicXEKernelLoader::MagicXEVideoFrameAlloc(MagicXEPixelFormat, MagicXEMemoryType, ...)
magic_xe::MagicXEKernelLoader::MagicXEVideoOpenGLFrameMake(unsigned int, ...)
magic_xe::MagicXEPlugin::ProgressCallbackSet(MagicXEProgressCallbackStatus (*)(float, void*), void*)
```

→ "Magic XE" é o SDK de algoritmos compartilhado entre produtos Wondershare (Filmora usa o mesmo).
Os modelos **não vêm no app** — são baixados como bibliotecas de plugin. Confirma isso a existência de
`AIModelKindViewItem.nib`, `AIModelTipsViewCtrl.nib` e o endpoint `/v1/model/tags`,
além das pastas vazias `~/Library/Application Support/com.Wondershare.UniConverter17/{plugins,format}/`. **[inf]**

Algoritmos que vêm compilados localmente (`NewMagicXEAlgorithms.dylib`): **[obs]**

```
VideoDenoisingLite      VideoStablization        VideoHumanSegmentation
VideoWaterMarkRemovel   VideoSceneDetection      VideoHighlightGenerator
VideoNakedeye3D         VideoNakedeyeVR          VideoFaceCompare
AudioSeparation         AudioSpeechEnhance       AudioVoiceChange
```

### 3.3 Caminho IA = nuvem, cobrado em créditos

**Nada de IA generativa roda na sua máquina.** O backend é `https://vcu-api.300624.com/v1`
("vcu" = Video Converter Ultimate; `300624.com` é o domínio de API da Wondershare). **[obs]**

Endpoints extraídos do binário principal: **[obs]**

| Endpoint | Função provável |
|---|---|
| `/v1/ai/video/vqe/batch` | **Video Quality Enhancement** |
| `/v1/ai/video/vrw/batch` | Video Remove Watermark |
| `/v1/ai/video/mask_propainter/batch` | inpainting de vídeo (ProPainter) |
| `/v1/ai/image/cisr` | super-resolução de imagem |
| `/v1/ai/image/imagesharpen/batch` | sharpen |
| `/v1/ai/image/change_bg/batch` | troca de fundo |
| `/v1/ai/image/generate`, `/v1/ai/image/models` | geração de imagem |
| `/v1/ai/aigc/alg/image_enchancer` (+ `/workflow`) | enhancer de imagem |
| `/v1/ai/aigc/alg/auto_color`, `/colorizer/workflow` | colorização |
| `/v1/ai/aigc/alg/deflickering`, `/repair`, `/anime` | restauração |
| `/v1/ai/capacity/application/night_video_enhancer` | vídeo noturno |
| `/v1/ai/capacity/application/generative_video_hd` | upscale generativo |
| `/v1/ai/capacity/application/fxm_human_enhancer_v2` | realce de pessoas |
| `/v1/ai/capacity/application/vcu_static_watermark_remove` | remoção de marca d'água |
| `/v1/ai/capacity/application/app_gemini3_1_flash_img_banana_v2` | **proxy para Gemini 3.1 Flash Image (Nano Banana)** |
| `/v1/ai/capacity/application/app_gpt_image_i2i_v2` | **proxy para GPT Image (image-to-image)** |
| `/v1/ai/audio/audio-language-recognition` | detecção de idioma |
| `/v1/support/oss/credential` | credencial temporária de upload |
| `/v1/ai/pub/task/` , `/v1/ai/pub/task/cancel/` | polling de tarefa assíncrona |
| `/v1/common/credit/rule`, `/v1/common/credit/report` | créditos |

Há `Resources/nano_banana_templates.json` e `image_generator_templates.json`, confirmando o proxy
para Gemini. **[obs]**

Fluxo: **[inf, forte]**

```
GET  /v1/support/oss/credential      → credencial Aliyun OSS (AliyunOSSOSX.framework está no bundle)
PUT  → upload do arquivo para o OSS
POST /v1/ai/video/vqe/batch          → cria tarefa, debita créditos
GET  /v1/ai/pub/task/<id>            → polling até concluir
GET  → baixa resultado
POST /v1/common/task/report          → telemetria
```

Custo em créditos (`Resources/AICreditsConsumptionRule.plist`): **[obs]**

```
AIVideoEnhancer       8
AIImageEnhancer       5
AutoSubtitleGenerator 4
TextToSpeech         10
```

→ **O "AI Video Enhancer" do UniConverter é um orquestrador de API na nuvem.** O software em si
não contém nenhum modelo de upscaling.

---

## 4. Outros achados relevantes

- **Remoção de fundo**: `Frameworks/rmbg.dylib` + endpoint `https://pixcut.wondershare.com`. **[obs]**
- **Legendas automáticas**: `libWESCaption.dylib` (16,9 MB) + `/v1/ai/pub/languages`. **[obs]**
- **DVD/Blu-ray**: todo o conjunto `DVD*.dylib`, `IM_DVDBuilder`, `mkisofs`, `DVDCrack.dylib`,
  `RegionalFree.dylib`, `Ogre.framework` + `RenderSystem_GL` (menus 3D). **[obs]**
- **Áudio**: `libAudioNoiseReduction.dylib`, `libVocalEnhance.dylib`, 20 plugins LADSPA-like. **[obs]**
- **Dispositivos**: `IOSDevice`, `AndroidDevice`, `iPodDevice`, `CarDevice`, `DeviceManager`. **[obs]**
- **Crash/telemetria**: `BugsplatMac.framework`, `sdk.hockeyapp.net`, `prod-web.wondershare.cc`. **[obs]**
- **x86_64 apenas** — roda sob Rosetta 2 em Apple Silicon, sem build nativo arm64. **[obs]**

---

## 5. Lacunas (não resolvido nesta passada)

- Comando exato que `MediaConvertKit` monta para `kernaldec` (precisa de decompilação ou observação em runtime).
- Corpo exato das requisições a `vcu-api.300624.com` (precisaria de captura de tráfego com o app rodando).
- Conteúdo dos plugins Magic XE (não foram baixados nesta máquina — pastas `plugins/` e `format/` vazias).
- Lista completa dos ~780 extratores do fork youtube-dl (os `.pyc` precisariam ser decompilados).
