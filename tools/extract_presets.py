#!/usr/bin/env python3
"""
Extrai o banco de presets do Wondershare UniConverter 17 para JSON estruturado.

Lê (somente leitura) os XML/plist de configuracao do app instalado e emite em data/:
    categories.json   - as 8 categorias de saida
    formats.json      - 174 formatos com valores permitidos + limites condicionais
    profiles.json     - 469 presets (dispositivo/plataforma) com seus defaults
    bitrate-model.json- tabelas do algoritmo de bitrate recomendado
    device-rules.json - restricoes por familia de dispositivo
    passthrough.json  - combinacoes container/codec que permitem remux sem reencode

Uso:
    python3 tools/extract_presets.py [--app CAMINHO_DO_APP] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import plistlib
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_APP = Path("/Applications/Wondershare UniConverter 17.app")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def read_xml(path: Path) -> ET.Element:
    """Parse XML tolerando BOM UTF-8, que varios desses arquivos tem."""
    text = path.read_text(encoding="utf-8-sig")
    return ET.fromstring(text)


def split_list(raw: str | None) -> list[str]:
    """'320*240,640*480' -> ['320*240', '640*480']. Preserva FourCC com espaco."""
    if not raw:
        return []
    return [part for part in (p.strip() for p in raw.split(",")) if part]


def as_number(raw: str | None):
    """Converte para int/float quando possivel; devolve a string original se nao."""
    if raw is None:
        return None
    raw = raw.strip()
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        return raw or None


def parse_resolution(raw: str | None) -> dict | None:
    """'1920*1080' -> {'width': 1920, 'height': 1080}."""
    if not raw or "*" not in raw:
        return None
    w, _, h = raw.partition("*")
    try:
        return {"width": int(w), "height": int(h)}
    except ValueError:
        return None


def value_set(element: ET.Element | None) -> dict | None:
    """
    Converte <VideoBitrate default="2000">900,1500,...</VideoBitrate> em
    {'default': 2000, 'allowed': [900, 1500, ...], <outros atributos>}.
    """
    if element is None:
        return None
    out: dict = {}
    for key, raw in element.attrib.items():
        # as_number ja faz strip; FourCCs vem com espaco de padding ('AV1 ')
        # e precisam bater com os valores de 'allowed', que tambem sao limpos.
        out[key] = as_number(raw)
        if isinstance(out[key], str):
            out[key] = out[key].strip()
    values = [as_number(v) for v in split_list(element.text)]
    if values:
        out["allowed"] = values
    return out or None


# --------------------------------------------------------------------------- #
# extratores
# --------------------------------------------------------------------------- #

VALUE_FIELDS = (
    ("resolution", "Resolution"),
    ("frame_rate", "FrameRate"),
    ("video_bitrate_kbps", "VideoBitrate"),
    ("audio_bitrate_kbps", "AudioBitrate"),
    ("sample_rate_hz", "SampleRate"),
    ("channels", "Channel"),
    ("video_encoders", "VideoEncoders"),
    ("audio_encoders", "AudioEncoders"),
)


def extract_limit(limit: ET.Element) -> dict:
    """
    Um <limit> e uma restricao condicional: 'quando o encoder de audio for AC3,
    os canais permitidos passam a ser 2 ou 6'. As condicoes vem nos atributos,
    as restricoes resultantes nos filhos.
    """
    conditions = {k: v.strip() for k, v in limit.attrib.items()}
    constraints = {}
    for name, tag in VALUE_FIELDS:
        parsed = value_set(limit.find(tag))
        if parsed:
            constraints[name] = parsed
    return {"when": conditions, "then": constraints}


def extract_formats(root: ET.Element) -> tuple[list[dict], list[dict]]:
    categories = [
        {
            "id": as_number(c.get("id")),
            "title": c.get("title"),
            "icon": c.get("pixId"),
        }
        for c in root.findall("category")
    ]

    formats = []
    for f in root.findall("Format"):
        entry: dict = {
            "id": as_number(f.get("id")),
            "title": (f.findtext("Title") or "").strip(),
            "description": (f.findtext("Description") or "").strip() or None,
            "category_id": as_number(f.get("categoryid")),
            "extension": f.get("Ext"),
            "fourcc": f.get("FourCC"),
            "icon": f.get("pixId"),
        }

        # Flags booleanas que o app usa para habilitar features por formato.
        for attr, name in (
            ("multiTrack", "multi_track"),
            ("keepChapters", "keep_chapters"),
            ("isVR", "is_vr"),
            ("open4K", "allows_4k"),
            ("intelOnly", "intel_only"),
            ("sandboxLimit", "sandbox_limited"),
            ("imageFormat", "is_image_format"),
            ("toiTunes", "export_to_itunes"),
            ("toWifiTransfer", "export_wifi"),
            ("H264ProfileLevel", "exposes_h264_profile_level"),
        ):
            if f.get(attr) is not None:
                entry[name] = f.get(attr) == "1"

        for attr, name in (("defaultAutoEnc", "default_auto_enc"),
                           ("allowedAutoEnc", "allowed_auto_enc")):
            if f.get(attr) is not None:
                entry[name] = as_number(f.get(attr))

        for name, tag in VALUE_FIELDS:
            parsed = value_set(f.find(tag))
            if parsed:
                entry[name] = parsed

        limits = f.find("Limits")
        if limits is not None:
            parsed_limits = [extract_limit(l) for l in limits.findall("limit")]
            if parsed_limits:
                entry["limits"] = parsed_limits

        formats.append(entry)

    return categories, formats


def extract_profiles(root: ET.Element) -> tuple[list[dict], list[dict]]:
    """preset_profiles.pro: <Formats> indexa, <PresetProfiles> traz os defaults."""
    format_index = [
        {
            "id": as_number(f.get("id")),
            "title": f.get("title"),
            "category_id": as_number(f.get("categoryID")),
            "icon": f.get("pixId"),
            "order": as_number(f.get("order")),
        }
        for f in root.find("Formats").findall("Format")
    ]

    profiles = []
    for p in root.find("PresetProfiles").findall("Profile"):
        entry: dict = {
            "id": as_number(p.get("id")),
            "format_id": as_number(p.get("formatid")),
            "title": p.get("Title"),
            "short_title": p.get("shortTitle"),
            "icon": p.get("pixId"),
            "order": as_number(p.get("order")),
            "region": p.get("region"),
            "default_auto_enc": as_number(p.get("defaultAutoEnc")),
            "video_encoder": (p.findtext("defaultVideoEncoders") or "").strip() or None,
            "audio_encoder": (p.findtext("defaultAudioEncoders") or "").strip() or None,
            "resolution": parse_resolution(p.findtext("defaultResolution")),
            "frame_rate": as_number(p.findtext("defaultFrameRate")),
            "video_bitrate_kbps": as_number(p.findtext("defaultVideoBitrate")),
            "audio_bitrate_kbps": as_number(p.findtext("defaultAudioBitrate")),
            "sample_rate_hz": as_number(p.findtext("defaultSampleRate")),
            "channels": as_number(p.findtext("defaultChannel")),
        }

        for attr, name in (
            ("lossless", "lossless"),
            ("supportVideoLosslessCopy", "supports_video_stream_copy"),
            ("sameAsSource", "same_as_source"),
            ("alpha", "supports_alpha"),
        ):
            if p.get(attr) is not None:
                entry[name] = p.get(attr) == "1"
        if p.get("losslessScale") is not None:
            entry["lossless_scale"] = as_number(p.get("losslessScale"))

        profiles.append({k: v for k, v in entry.items() if v is not None})

    return format_index, profiles


def extract_bitrate_model(plist: dict) -> dict:
    """
    BitrateControlTable descreve como o app sugere bitrate:
      FourCCTable     - FourCC do encoder -> familia de codec
      CoefficientTable- familia -> multiplicador relativo ao H.264
      ResolutionTable - familia -> ancoras 'W*H*fps;kbps'
    """
    table = plist.get("BitrateControlTable", {})

    anchors: dict[str, list[dict]] = {}
    for family, entries in table.get("ResolutionTable", {}).items():
        parsed = []
        for raw in entries:
            dims, _, kbps = raw.partition(";")
            parts = dims.split("*")
            if len(parts) != 3:
                continue
            try:
                parsed.append(
                    {
                        "width": int(parts[0]),
                        "height": int(parts[1]),
                        "fps": float(parts[2]),
                        "video_bitrate_kbps": int(kbps),
                    }
                )
            except ValueError:
                continue
        anchors[family] = parsed

    return {
        "fourcc_to_family": dict(table.get("FourCCTable", {})),
        "family_coefficient": dict(table.get("CoefficientTable", {})),
        "family_anchors": anchors,
    }


def extract_device_rules(plist: dict) -> dict:
    """RuleKeyOfFileFormat mapeia nome de formato/dispositivo -> conjunto em Rules."""
    def plain(value):
        if isinstance(value, dict):
            return {k: plain(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [plain(v) for v in value]
        if isinstance(value, (bytes, bytearray)):
            return value.decode("utf-8", "replace")
        return value

    return {
        "format_to_rule_key": plain(plist.get("RuleKeyOfFileFormat", {})),
        "rules": plain(plist.get("Rules", {})),
    }


def extract_passthrough(root: ET.Element) -> dict:
    """
    LossLess_xml.xml: por container, quais codecs de video/audio podem ser
    copiados direto (-c copy) em vez de reencodados.
    """
    out: dict[str, dict[str, list[str]]] = {}
    output_map = root.find("OUTPUT_MAP")
    if output_map is None:
        return out
    for container in output_map:
        entry: dict[str, list[str]] = {}
        for stream_kind in container:
            key = stream_kind.tag.lower()  # Video / Audio
            entry[key] = [codec.tag for codec in stream_kind]
        out[container.tag] = entry
    return out


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def write_json(path: Path, payload) -> None:
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(f"  {path.name:22s} {path.stat().st_size / 1024:8.1f} KB")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", type=Path, default=DEFAULT_APP,
                        help=f"bundle do app (default: {DEFAULT_APP})")
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).resolve().parent.parent / "data",
                        help="diretorio de saida (default: ../data)")
    args = parser.parse_args()

    resources = args.app / "Contents" / "Resources"
    if not resources.is_dir():
        print(f"erro: nao encontrei {resources}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    print(f"lendo  {resources}")
    print(f"escrevendo em {args.out}\n")

    categories, formats = extract_formats(read_xml(resources / "Format.pro"))
    format_index, profiles = extract_profiles(read_xml(resources / "preset_profiles.pro"))
    rules_plist = plistlib.loads((resources / "ParamterRules_Std.plist").read_bytes())
    passthrough = extract_passthrough(read_xml(resources / "LossLess_xml.xml"))

    write_json(args.out / "categories.json", categories)
    write_json(args.out / "formats.json", formats)
    write_json(args.out / "profiles.json",
               {"format_index": format_index, "profiles": profiles})
    write_json(args.out / "bitrate-model.json", extract_bitrate_model(rules_plist))
    write_json(args.out / "device-rules.json", extract_device_rules(rules_plist))
    write_json(args.out / "passthrough.json", passthrough)

    print(f"\n{len(categories)} categorias, {len(formats)} formatos, "
          f"{len(profiles)} presets, {len(passthrough)} containers com passthrough")
    return 0


if __name__ == "__main__":
    sys.exit(main())
