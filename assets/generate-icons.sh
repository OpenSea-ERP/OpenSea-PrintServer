#!/usr/bin/env bash
#
# generate-icons.sh
# Converts icon.svg into platform-specific icon formats using ImageMagick.
#
# Usage: bash generate-icons.sh
#
# Requirements:
#   - ImageMagick 7+ (magick) or ImageMagick 6 (convert)
#   - For .icns generation on non-macOS: png2icns (from icnsutils) or iconutil (macOS only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Check for ImageMagick
# ---------------------------------------------------------------------------
MAGICK_CMD=""

if command -v magick &>/dev/null; then
  MAGICK_CMD="magick"
elif command -v convert &>/dev/null; then
  MAGICK_CMD="convert"
else
  echo "ERROR: ImageMagick is not installed."
  echo ""
  echo "Install it:"
  echo "  Windows (winget):  winget install ImageMagick.ImageMagick"
  echo "  Windows (choco):   choco install imagemagick"
  echo "  macOS (brew):      brew install imagemagick"
  echo "  Ubuntu/Debian:     sudo apt install imagemagick"
  echo "  Fedora:            sudo dnf install ImageMagick"
  echo ""
  echo "After installing, re-run this script."
  exit 1
fi

echo "Using ImageMagick command: $MAGICK_CMD"
echo ""

# ---------------------------------------------------------------------------
# 1. Generate icon.png (256x256)
# ---------------------------------------------------------------------------
if [ ! -f icon.svg ]; then
  echo "ERROR: icon.svg not found in $SCRIPT_DIR"
  exit 1
fi

echo "Generating icon.png (256x256)..."
$MAGICK_CMD -background none -density 300 icon.svg -resize 256x256 icon.png
echo "  -> icon.png created"

# ---------------------------------------------------------------------------
# 2. Generate tray-icon.png (16x16)
# ---------------------------------------------------------------------------
if [ -f tray-icon.svg ]; then
  echo "Generating tray-icon.png (16x16)..."
  $MAGICK_CMD -background none -density 300 tray-icon.svg -resize 16x16 tray-icon.png
  echo "  -> tray-icon.png created"

  echo "Generating tray-icon@2x.png (32x32)..."
  $MAGICK_CMD -background none -density 300 tray-icon.svg -resize 32x32 "tray-icon@2x.png"
  echo "  -> tray-icon@2x.png created"
fi

# ---------------------------------------------------------------------------
# 3. Generate icon.ico (Windows — multi-size)
# ---------------------------------------------------------------------------
echo "Generating icon.ico (16, 32, 48, 64, 128, 256)..."
$MAGICK_CMD icon.png \
  \( -clone 0 -resize 16x16 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \
  \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) \
  -delete 0 \
  icon.ico
echo "  -> icon.ico created"

# ---------------------------------------------------------------------------
# 4. Generate icon.icns (macOS)
# ---------------------------------------------------------------------------
echo ""
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Generating icon.icns (macOS)..."
  ICONSET_DIR="icon.iconset"
  mkdir -p "$ICONSET_DIR"

  for SIZE in 16 32 64 128 256 512; do
    $MAGICK_CMD icon.png -resize ${SIZE}x${SIZE} "$ICONSET_DIR/icon_${SIZE}x${SIZE}.png"
    DOUBLE=$((SIZE * 2))
    if [ $DOUBLE -le 1024 ]; then
      $MAGICK_CMD icon.png -resize ${DOUBLE}x${DOUBLE} "$ICONSET_DIR/icon_${SIZE}x${SIZE}@2x.png"
    fi
  done

  iconutil -c icns "$ICONSET_DIR" -o icon.icns
  rm -rf "$ICONSET_DIR"
  echo "  -> icon.icns created"
elif command -v png2icns &>/dev/null; then
  echo "Generating icon.icns using png2icns..."
  TEMP_DIR=$(mktemp -d)
  for SIZE in 16 32 48 128 256; do
    $MAGICK_CMD icon.png -resize ${SIZE}x${SIZE} "$TEMP_DIR/icon_${SIZE}.png"
  done
  png2icns icon.icns "$TEMP_DIR"/icon_*.png
  rm -rf "$TEMP_DIR"
  echo "  -> icon.icns created"
else
  echo "SKIPPING icon.icns — requires macOS (iconutil) or png2icns (icnsutils)."
  echo "  Install icnsutils:  sudo apt install icnsutils"
  echo "  Or generate on macOS with: iconutil -c icns icon.iconset"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "Done! Generated files:"
ls -la icon.png icon.ico icon.icns tray-icon.png "tray-icon@2x.png" 2>/dev/null || true
