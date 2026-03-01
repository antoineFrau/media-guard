#!/usr/bin/env bash
# Build MediaGuard Firefox extension as .xpi for installation

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${ROOT}/extension"
OUT_DIR="${ROOT}/dist"
XPI_NAME="mediaguard-1.0.0.xpi"

mkdir -p "$OUT_DIR"

if command -v web-ext &>/dev/null; then
  echo "Building with web-ext..."
  cd "$ROOT"
  web-ext build --source-dir=extension --artifacts-dir=dist --overwrite-dest
  # web-ext produces .zip; rename to .xpi for Firefox
  ZIP_FILE=$(ls -1 "$OUT_DIR"/*.zip 2>/dev/null | head -1)
  if [[ -n "$ZIP_FILE" ]]; then
    mv "$ZIP_FILE" "$OUT_DIR/$XPI_NAME"
    echo "Built: $OUT_DIR/$XPI_NAME"
  fi
else
  echo "Building with zip (install web-ext for better packaging: npm i -g web-ext)..."
  cd "$EXT_DIR"
  zip -rq "$OUT_DIR/$XPI_NAME" . -x "*.git*" -x "*.DS_Store" -x "*.map"
  cd "$ROOT"
  echo "Built: $OUT_DIR/$XPI_NAME"
fi

echo ""
echo "To install in Firefox:"
echo "  1. Open Firefox → about:addons"
echo "  2. Click the gear icon → Install Add-on From File"
echo "  3. Select: $OUT_DIR/$XPI_NAME"
echo ""
echo "Note: Release Firefox requires signed extensions. Options:"
echo "  - Use Firefox Developer Edition + set xpinstall.signatures.required = false"
echo "  - Sign via AMO (unlisted): web-ext sign --channel=unlisted"
