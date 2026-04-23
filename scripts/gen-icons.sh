#!/bin/bash
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)/bg-card.png"
OUT="$(cd "$(dirname "$0")/.." && pwd)/ios/App/App/Assets.xcassets/AppIcon.appiconset"
mkdir -p "$OUT"

MASTER="/tmp/bg-icon-master.png"
magick "$SRC" -background "#071208" -gravity center -extent 1024x1024 -resize 1024x1024 "$MASTER"
echo "Master icon created"

resize(){ magick "$MASTER" -resize "${2}x${2}" "$OUT/$1"; echo "  ✓ $1 (${2}px)"; }

resize icon-20.png      20
resize icon-20@2x.png   40
resize icon-20@3x.png   60
resize icon-29.png      29
resize icon-29@2x.png   58
resize icon-29@3x.png   87
resize icon-40.png      40
resize icon-40@2x.png   80
resize icon-40@3x.png   120
resize icon-60@2x.png   120
resize icon-60@3x.png   180
resize icon-76.png      76
resize icon-76@2x.png   152
resize icon-83.5@2x.png 167
resize icon-1024.png    1024

cat > "$OUT/Contents.json" << 'EOF'
{
  "images": [
    {"size":"20x20","idiom":"iphone","filename":"icon-20@2x.png","scale":"2x"},
    {"size":"20x20","idiom":"iphone","filename":"icon-20@3x.png","scale":"3x"},
    {"size":"29x29","idiom":"iphone","filename":"icon-29@2x.png","scale":"2x"},
    {"size":"29x29","idiom":"iphone","filename":"icon-29@3x.png","scale":"3x"},
    {"size":"40x40","idiom":"iphone","filename":"icon-40@2x.png","scale":"2x"},
    {"size":"40x40","idiom":"iphone","filename":"icon-40@3x.png","scale":"3x"},
    {"size":"60x60","idiom":"iphone","filename":"icon-60@2x.png","scale":"2x"},
    {"size":"60x60","idiom":"iphone","filename":"icon-60@3x.png","scale":"3x"},
    {"size":"20x20","idiom":"ipad","filename":"icon-20.png","scale":"1x"},
    {"size":"20x20","idiom":"ipad","filename":"icon-20@2x.png","scale":"2x"},
    {"size":"29x29","idiom":"ipad","filename":"icon-29.png","scale":"1x"},
    {"size":"29x29","idiom":"ipad","filename":"icon-29@2x.png","scale":"2x"},
    {"size":"40x40","idiom":"ipad","filename":"icon-40.png","scale":"1x"},
    {"size":"40x40","idiom":"ipad","filename":"icon-40@2x.png","scale":"2x"},
    {"size":"76x76","idiom":"ipad","filename":"icon-76.png","scale":"1x"},
    {"size":"76x76","idiom":"ipad","filename":"icon-76@2x.png","scale":"2x"},
    {"size":"83.5x83.5","idiom":"ipad","filename":"icon-83.5@2x.png","scale":"2x"},
    {"size":"1024x1024","idiom":"ios-marketing","filename":"icon-1024.png","scale":"1x"}
  ],
  "info":{"version":1,"author":"xcode"}
}
EOF

echo "✅ Icon set complete → $OUT"
