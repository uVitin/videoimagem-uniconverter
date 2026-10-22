#!/usr/bin/env python3
"""
Monta data/codec-map.json: FourCC do UniConverter -> encoder FFmpeg.

IMPORTANTE: este arquivo NAO e extraido do app. Os FourCC sao observados
(aparecem em Format.pro), mas o mapeamento para encoders FFmpeg e uma decisao
de design nossa. Cada entrada carrega "confidence":

  "high"   - FourCC autoexplicativo ou FourCC padrao da industria (ex. 'apch' = ProRes HQ)
  "medium" - familia de codec clara, variante/implementacao inferida pelo prefixo
  "low"    - palpite; precisa ser validado antes de confiar

O prefixo do FourCC deles indica a IMPLEMENTACAO, nao o codec:
  X264 / M264 / FAVC / H264 / MAVC / PAVC  -> todos H.264, backends diferentes
  I*** (IAVC, IM4V, IPAN, IPON)            -> caminho Intel (IPP/QuickSync)
  K264 / K265                              -> 'kernal', o motor interno deles (4K)
  H*** (HAVC, HMP2)                        -> caminho de hardware
Para nos isso e irrelevante: tudo colapsa no mesmo encoder FFmpeg.
"""

import json
from pathlib import Path

# fourcc: (familia, encoder software, encoder hardware macOS, extra_args, confidence, nota)
VIDEO = {
    # --- H.264 -------------------------------------------------------------
    "H264": ("h264", "libx264", "h264_videotoolbox", [], "high", None),
    "X264": ("h264", "libx264", "h264_videotoolbox", [], "high", "x264 explicito"),
    "M264": ("h264", "libx264", "h264_videotoolbox", [], "high", "default do MP4 deles"),
    "FAVC": ("h264", "libx264", "h264_videotoolbox", [], "medium", "F = backend FFmpeg"),
    "MAVC": ("h264", "libx264", "h264_videotoolbox", [], "medium", None),
    "PAVC": ("h264", "libx264", "h264_videotoolbox", [], "low", None),
    "HAVC": ("h264", "libx264", "h264_videotoolbox", [], "medium", "H = caminho de hardware"),
    "IAVC": ("h264", "libx264", "h264_videotoolbox", [], "medium", "I = Intel QuickSync"),
    "IPAN": ("h264", "libx264", "h264_videotoolbox", [], "low", "provavel Intel"),
    "IPON": ("h264", "libx264", "h264_videotoolbox", [], "low", "provavel Intel"),
    "K264": ("h264", "libx264", "h264_videotoolbox", [], "medium", "motor interno, perfil 4K"),
    "AVHD": ("h264", "libx264", "h264_videotoolbox",
             ["-profile:v", "high", "-level", "4.1"], "medium",
             "AVCHD: H.264 em m2ts, com restricoes de profile"),
    "PS3H": ("h264", "libx264", "h264_videotoolbox", [], "low", "preset PlayStation 3"),

    # --- H.265 / AV1 -------------------------------------------------------
    "HEVC": ("hevc", "libx265", "hevc_videotoolbox", [], "high", None),
    "K265": ("hevc", "libx265", "hevc_videotoolbox", [], "medium", "motor interno"),
    "AV1":  ("av1", "libsvtav1", None, [], "high",
             "libsvtav1 e o mais rapido; libaom-av1 comprime um pouco melhor"),

    # --- MPEG --------------------------------------------------------------
    "MP4V": ("mpeg4", "mpeg4", None, ["-vtag", "DX50"], "high", "MPEG-4 Part 2"),
    "IM4V": ("mpeg4", "mpeg4", None, ["-vtag", "DX50"], "medium", "MPEG-4 via Intel"),
    "DIVX": ("mpeg4", "mpeg4", None, ["-vtag", "DIVX"], "high", None),
    "Xvid": ("mpeg4", "mpeg4", None, ["-vtag", "XVID"], "high", None),
    "mp43": ("mpeg4", "mpeg4", None, ["-vtag", "MP43"], "medium", "MS MPEG-4 v3"),
    "MP2V": ("mpeg2", "mpeg2video", None, [], "high", None),
    "mp2v": ("mpeg2", "mpeg2video", None, [], "high", None),
    "HMP2": ("mpeg2", "mpeg2video", None, [], "medium", "MPEG-2 por hardware"),
    "BDAV": ("mpeg2", "mpeg2video", None, [], "low", "Blu-ray AV; pode ser H.264 tambem"),
    "mp1v": ("mpeg1", "mpeg1video", None, [], "high", None),
    "H263": ("h263", "h263p", None, [], "high", "h263p aceita mais resolucoes que h263"),

    # --- WebM / VPx / Theora ----------------------------------------------
    "VP8":  ("vp8", "libvpx", None, [], "high", None),
    "VP9":  ("vp9", "libvpx-vp9", None, [], "high", None),
    "OGV":  ("theora", "libtheora", None, [], "high", None),

    # --- Windows Media -----------------------------------------------------
    "WMV2": ("wmv2", "wmv2", None, [], "high", None),
    "flv1": ("flv1", "flv", None, [], "high", "Sorenson Spark"),

    # --- ProRes (FourCC reais da Apple) ------------------------------------
    "ap4x": ("prores", "prores_ks", None, ["-profile:v", "5"], "high", "ProRes 4444 XQ"),
    "ap4h": ("prores", "prores_ks", None, ["-profile:v", "4"], "high", "ProRes 4444"),
    "apch": ("prores", "prores_ks", None, ["-profile:v", "3"], "high", "ProRes 422 HQ"),
    "apcn": ("prores", "prores_ks", None, ["-profile:v", "2"], "high", "ProRes 422"),
    "apcs": ("prores", "prores_ks", None, ["-profile:v", "1"], "high", "ProRes 422 LT"),
    "apco": ("prores", "prores_ks", None, ["-profile:v", "0"], "high", "ProRes 422 Proxy"),

    # --- intermediarios de edicao -----------------------------------------
    "CFHD": ("cineform", "cfhd", None, [], "high", "GoPro CineForm"),
    "FFV1": ("ffv1", "ffv1", None, ["-level", "3"], "high", "lossless"),
    "DV50": ("dv", "dvvideo", None, [], "medium", "DVCPRO50"),
    "DV60": ("dv", "dvvideo", None, [], "medium", "DVCPRO50 60i"),
    "H50":  ("dv", "dvvideo", None, [], "low", "provavel DVCPRO50"),
    "H100": ("dv", "dvvideo", None, [], "low", "provavel DVCPRO HD 100"),
    "MJPG": ("mjpeg", "mjpeg", None, [], "high", None),
    "RAWV": ("rawvideo", "rawvideo", None, [], "high", None),

    # --- imagem / animacao -------------------------------------------------
    "GIFA": ("gif", "gif", None, [], "high", "GIF animado"),
    "GIFV": ("gif", "gif", None, [], "medium", "GIF de video"),
    "WEBP": ("webp", "libwebp", None, [], "high", None),
    "PNG":  ("png", "png", None, [], "high", "sequencia de imagens"),
    "JPG":  ("mjpeg", "mjpeg", None, [], "high", "sequencia de imagens"),

    # --- legado / nao resolvido -------------------------------------------
    "AMV":  ("amv", "amv", None, [], "medium", "players MP4 chineses antigos"),
    "qtv5": ("?", None, None, [], "low", "provavel Sorenson Video 3 / QT legado"),
    "qtv6": ("?", None, None, [], "low", "nao resolvido"),
    "qtv7": ("?", None, None, [], "low", "nao resolvido"),
    "MPON": ("?", None, None, [], "low", "nao resolvido"),
}

# fourcc: (familia, encoder, extra_args, confidence, nota)
AUDIO = {
    "AAC":  ("aac", "aac", [], "high", "aac_at (AudioToolbox) soa melhor no macOS"),
    "MAAC": ("aac", "aac", [], "high", "default do MP4 deles"),
    "eAAC": ("aac", "libfdk_aac", ["-profile:a", "aac_he_v2"], "low",
             "HE-AAC v2; exige FFmpeg com libfdk_aac (nao-free)"),
    "AC3":  ("ac3", "ac3", [], "high", None),
    "MP3":  ("mp3", "libmp3lame", [], "high", None),
    "fmp3": ("mp3", "libmp3lame", [], "high", "mp3 via FFmpeg"),
    "MP2A": ("mp2", "mp2", [], "high", None),
    "OPUS": ("opus", "libopus", [], "high", None),
    "VBIS": ("vorbis", "libvorbis", [], "high", None),
    "OGG":  ("vorbis", "libvorbis", [], "medium", "OGG e container; o codec e Vorbis"),
    "flac": ("flac", "flac", [], "high", "lossless"),
    "ALAC": ("alac", "alac", [], "high", "lossless"),
    "PCM":  ("pcm", "pcm_s16le", [], "high", None),
    "APCM": ("pcm", "pcm_s16le", [], "medium", None),
    "in24": ("pcm", "pcm_s24le", [], "high", "FourCC Apple para PCM 24 bits"),
    "DPCM": ("pcm", "pcm_s16be", [], "low", "provavel PCM big-endian"),
    "ADPV": ("adpcm", "adpcm_ima_wav", [], "low", "variante de ADPCM nao confirmada"),
    "AMRN": ("amr_nb", "libopencore_amrnb", ["-ar", "8000", "-ac", "1"], "high",
             "AMR-NB exige 8 kHz mono"),
    "wma1": ("wmav1", "wmav1", [], "high", None),
    "wma2": ("wmav2", "wmav2", [], "high", None),
    "APE":  ("ape", None, [], "high", "FFmpeg DECODIFICA ape mas nao codifica"),
    "caf":  ("?", None, [], "low", "CAF e container, nao codec"),
    "qta0": ("?", None, [], "low", "nao resolvido"),
}


def main() -> None:
    out = {
        "_note": "FourCC observados em Format.pro; mapeamento para FFmpeg e decisao "
                 "de design nossa. Ver 'confidence' em cada entrada.",
        "video": {
            fourcc: {
                "family": fam,
                "encoder": sw,
                "encoder_hw_macos": hw,
                "extra_args": extra,
                "confidence": conf,
                **({"note": note} if note else {}),
            }
            for fourcc, (fam, sw, hw, extra, conf, note) in sorted(VIDEO.items())
        },
        "audio": {
            fourcc: {
                "family": fam,
                "encoder": enc,
                "extra_args": extra,
                "confidence": conf,
                **({"note": note} if note else {}),
            }
            for fourcc, (fam, enc, extra, conf, note) in sorted(AUDIO.items())
        },
    }

    path = Path(__file__).resolve().parent.parent / "data" / "codec-map.json"
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    unmapped = [f for f, v in VIDEO.items() if v[1] is None]
    unmapped += [f for f, v in AUDIO.items() if v[1] is None]
    print(f"{path.name}: {len(VIDEO)} video + {len(AUDIO)} audio")
    print(f"sem encoder definido: {unmapped}")


if __name__ == "__main__":
    main()
