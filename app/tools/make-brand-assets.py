#!/usr/bin/env python3
"""Gera os logotipos e o icone do app a partir do logo oficial (.ai = PDF).

Uso: python3 tools/make-brand-assets.py "/caminho/logo_Video_Imagem.ai"

Saidas:
  src/renderer/assets/logo-light.png  logotipo para fundo claro (original)
  src/renderer/assets/logo-dark.png   logotipo para fundo escuro (texto claro)
  src/renderer/assets/mark-light.png  so o quadro + "i", para fundo claro
  src/renderer/assets/mark-dark.png   idem, para fundo escuro
  build/icon.png                      icone 1024 (rode `npm run icon` depois)
Precisa de Pillow e do `sips` do macOS (renderiza o PDF).
"""
import subprocess, sys, tempfile, os
from PIL import Image, ImageDraw

src = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
assets = os.path.join(root, "src", "renderer", "assets")
os.makedirs(assets, exist_ok=True)

NAVY = (0x2D, 0x42, 0x68)
LIGHT = (0xEE, 0xF1, 0xF8)

# ---- logotipo completo --------------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    pdf = os.path.join(tmp, "logo.pdf")
    png = os.path.join(tmp, "logo.png")
    subprocess.run(["cp", src, pdf], check=True)
    subprocess.run(["sips", "-s", "format", "png", "--resampleHeightWidthMax", "2400", pdf, "--out", png],
                   check=True, capture_output=True)
    full = Image.open(png).convert("RGBA")

box = full.split()[3].getbbox()
pad = 40
full = full.crop((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad))
width = 720
logo_light = full.resize((width, round(full.height * width / full.width)), Image.LANCZOS)
logo_light.save(os.path.join(assets, "logo-light.png"))

dark = logo_light.copy()
px = dark.load()
for y in range(dark.height):
    for x in range(dark.width):
        r, g, b, a = px[x, y]
        if a and b > r and b > g and b - r > 30:  # o azul-marinho do texto
            px[x, y] = (*LIGHT, a)
        elif a and r > b and r > g:  # vermelho: clareia o lado vinho, que some no escuro
            px[x, y] = (min(255, r + 70), min(255, g + 38), min(255, b + 38), a)
        elif a and g > r and g > b and g < 140:  # verde escuro
            px[x, y] = (min(255, r + 25), min(255, g + 45), min(255, b + 25), a)
dark.save(os.path.join(assets, "logo-dark.png"))

# ---- so o quadro (marca) ------------------------------------------------------
# coordenadas medidas no logo (canvas 1200): quadro em perspectiva em volta do "i"
def quad(p0, c, p1, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
            for t in (i / n for i in range(n + 1))]

def line(p0, p1, n=20):
    return [(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t) for t in (i / n for i in range(n + 1))]

TOP = (line((533, 540), (533, 498)) + quad((533, 498), (533, 466), (562, 472)) +
       quad((562, 472), (690, 478), (818, 490)) + quad((818, 490), (833, 492), (833, 520)) +
       line((833, 520), (833, 540)))
BOTTOM = (line((533, 665), (533, 708)) + quad((533, 708), (533, 742), (562, 735)) +
          quad((562, 735), (690, 716), (820, 697)) + quad((820, 697), (833, 695), (833, 684)))
STEM = line((533, 567), (533, 632))
STROKE = 14

def lerp(c0, c1, t):
    return tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))

def draw_mark(dark_bg, scale=8, stroke=STROKE):
    x0, y0, x1, y1 = 500, 440, 870, 770
    img = Image.new("RGBA", ((x1 - x0) * scale, (y1 - y0) * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = stroke / 2 * scale
    red = ((0x8E, 0x3C, 0x3C), (0xE0, 0x5A, 0x5C)) if dark_bg else ((0x5E, 0x2E, 0x2D), (0xC7, 0x43, 0x45))
    green = ((0x5A, 0x92, 0x56), (0xB4, 0xD8, 0x6A)) if dark_bg else ((0x4B, 0x73, 0x48), (0x95, 0xBD, 0x5A))
    for pts, (c0, c1) in ((TOP, red), (BOTTOM, green)):
        for px_, py_ in pts:
            t = (px_ - 533) / (833 - 533)
            cx, cy = (px_ - x0) * scale, (py_ - y0) * scale
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*lerp(c0, c1, t), 255))
    stem = LIGHT if dark_bg else NAVY
    for px_, py_ in STEM:
        cx, cy = (px_ - x0) * scale, (py_ - y0) * scale
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*stem, 255))
    return img

for name, dark_bg in (("mark-light", False), ("mark-dark", True)):
    m = draw_mark(dark_bg)
    m = m.resize((m.width // 8 * 2, m.height // 8 * 2), Image.LANCZOS)  # 2x
    m.save(os.path.join(assets, f"{name}.png"))

# ---- icone do app -------------------------------------------------------------
S = 1024
base = Image.new("RGBA", (S * 2, S * 2), (0, 0, 0, 0))
bg = Image.new("RGBA", base.size)
bp = bg.load()
for y in range(bg.height):
    t = y / bg.height
    c = lerp((0x3E, 0x58, 0x8C), (0x1B, 0x28, 0x44), t)
    for x in range(bg.width):
        bp[x, y] = (*c, 255)
mask = Image.new("L", base.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((200, 200, S * 2 - 200, S * 2 - 200), radius=458, fill=255)
base.paste(bg, (0, 0), mask)
mark = draw_mark(True, stroke=26)
target = int(S * 2 * 0.60)
mark = mark.resize((target, round(mark.height * target / mark.width)), Image.LANCZOS)
base.alpha_composite(mark, ((S * 2 - mark.width) // 2, (S * 2 - mark.height) // 2))
os.makedirs(os.path.join(root, "build"), exist_ok=True)
base.resize((S, S), Image.LANCZOS).save(os.path.join(root, "build", "icon.png"))
print("ok")
