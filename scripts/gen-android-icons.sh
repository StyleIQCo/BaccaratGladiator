#!/bin/bash
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)/bg-card.png"
RES="$(cd "$(dirname "$0")/.." && pwd)/android/app/src/main/res"

MASTER="/tmp/bg-android-master.png"
FGMASTER="/tmp/bg-android-fg.png"

# Square master — card centered on dark green
magick "$SRC" -background "#071208" -gravity center -extent 1024x1024 -resize 1024x1024 "$MASTER"

# Foreground adaptive layer — card within 66% safe zone, transparent bg
magick "$SRC" -resize 676x676 -gravity center -background none -extent 1024x1024 "$FGMASTER"

echo "Masters created"

gen_icon(){
  local SIZE=$1 DPI=$2 DIR="$RES/mipmap-${DPI}"
  magick "$MASTER" -resize "${SIZE}x${SIZE}" "$DIR/ic_launcher.png"
  # Round icon — circular mask
  magick "$MASTER" -resize "${SIZE}x${SIZE}" \
    \( +clone -alpha extract \
       -draw "fill white circle $((SIZE/2)),$((SIZE/2)) $((SIZE/2)),0" \
       -blur 0x1 \) \
    -alpha off -compose CopyOpacity -composite "$DIR/ic_launcher_round.png"
  echo "  ✓ $DPI (${SIZE}px)"
}

gen_fg(){
  local SIZE=$1 DPI=$2 DIR="$RES/mipmap-${DPI}"
  magick "$FGMASTER" -resize "${SIZE}x${SIZE}" "$DIR/ic_launcher_foreground.png"
}

gen_icon  48  mdpi
gen_icon  72  hdpi
gen_icon  96  xhdpi
gen_icon 144  xxhdpi
gen_icon 192  xxxhdpi

gen_fg 108  mdpi
gen_fg 162  hdpi
gen_fg 216  xhdpi
gen_fg 324  xxhdpi
gen_fg 432  xxxhdpi

# Play Store 512×512
magick "$MASTER" -resize 512x512 "$(cd "$(dirname "$0")/.." && pwd)/bg-playstore-icon.png"
echo "  ✓ bg-playstore-icon.png (512px) — upload this to Play Console"

echo "✅ Android icon set complete"
