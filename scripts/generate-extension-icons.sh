#!/usr/bin/env bash
# Regenerate extension icons from logov4.svg

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/logov4.svg"
DEST="${ROOT}/extension/icons"

if [[ ! -f "$SRC" ]]; then
  echo "Error: $SRC not found" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC" "$DEST/icon.svg"

if command -v magick &>/dev/null; then
  for s in 16 32 48 128; do
    magick -background none "$SRC" -resize "${s}x${s}" "$DEST/icon${s}.png"
  done
elif command -v convert &>/dev/null; then
  for s in 16 32 48 128; do
    convert -background none "$SRC" -resize "${s}x${s}" "$DEST/icon${s}.png"
  done
else
  echo "Error: ImageMagick (magick or convert) required. Install with: sudo pacman -S imagemagick" >&2
  exit 1
fi

echo "Icons regenerated from logov4.svg → extension/icons/"
