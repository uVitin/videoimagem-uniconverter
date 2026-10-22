#!/usr/bin/env bash
# Gera build/icon.icns a partir de nada alem do ffmpeg e das ferramentas do macOS.
#
# E um icone PLACEHOLDER: quadrado com cantos arredondados no estilo macOS,
# gradiente da cor de destaque da UI e um triangulo de "play". Troque por uma
# arte de verdade quando tiver uma -- basta substituir build/icon.png e rodar
# este script de novo (ou so colocar seu proprio build/icon.icns).
set -euo pipefail

cd "$(dirname "$0")/.."
OUT_DIR="build"
PNG="$OUT_DIR/icon.png"
ICONSET="$OUT_DIR/icon.iconset"
ICNS="$OUT_DIR/icon.icns"

mkdir -p "$OUT_DIR"

# Geometria do "squircle" da Apple num canvas de 1024:
#   a arte ocupa 824px centrados (margem de 100), raio de canto 229.
#   O teste de dentro/fora e a distancia ate o centro do canto mais proximo.
HALF=412        # metade da aresta da arte
RADIUS=229      # raio do canto
INNER=$((HALF - RADIUS))   # 183

# Triangulo de play: da esquerda (420) ate a ponta (650), meia-altura 132.
MASK="lte(hypot(max(0\,abs(X-512)-${INNER})\,max(0\,abs(Y-512)-${INNER}))\,${RADIUS})"
TRI="gte(X\,420)*lte(X\,650)*lte(abs(Y-512)\,(650-X)*0.574)"

if [ ! -f "$PNG" ]; then
  echo "gerando $PNG"
  ffmpeg -hide_banner -loglevel error \
    -f lavfi -i "gradients=s=1024x1024:c0=0x4d9fff:c1=0x8b5cf6:x0=120:y0=120:x1=904:y1=904:nb_colors=2:d=1" \
    -frames:v 1 \
    -vf "format=rgba,geq=\
r='if(${TRI}\,255\,r(X\,Y))':\
g='if(${TRI}\,255\,g(X\,Y))':\
b='if(${TRI}\,255\,b(X\,Y))':\
a='if(${MASK}\,255\,0)'" \
    -y "$PNG"
else
  echo "usando $PNG que ja existe"
fi

echo "montando $ICONSET"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Os tamanhos que o iconutil espera num .iconset
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
            "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  size="${spec%% *}"
  name="${spec##* }"
  sips -z "$size" "$size" "$PNG" --out "$ICONSET/${name}.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"
echo "pronto: $ICNS"
