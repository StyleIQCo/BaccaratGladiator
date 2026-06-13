#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# cap-sync.sh — populate www/ with the runtime bundle, then sync into
#               iOS (and optionally Android) via Capacitor.
#
# Usage:
#   ./cap-sync.sh           — full build + sync to iOS
#   ./cap-sync.sh --dry-run — print what would be copied, copy nothing
#   ./cap-sync.sh --android — also sync to Android
#
# Why this exists:
#   The default `npx cap sync ios` just copies whatever is in webDir
#   (www/). Since this project's source files live at the repo root,
#   we need an explicit copy step. A whitelist is safer than rsync-
#   excludes here — the repo holds marketing assets, build scripts,
#   manuscripts, and trailer videos that have no business in the app
#   bundle.
# ─────────────────────────────────────────────────────────────────────────

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
WWW="$PROJECT_ROOT/www"
DRY_RUN=0
SYNC_ANDROID=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --android) SYNC_ANDROID=1 ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────────────────
copy_file() {
  local src="$PROJECT_ROOT/$1"
  local dst="$WWW/${2:-$1}"
  if [ ! -e "$src" ]; then
    echo "  ⚠ skip (missing): $1"
    return
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  + $1 → www/${2:-$1}"
  else
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  fi
}

copy_glob() {
  local pattern="$1"
  shopt -s nullglob
  for f in $PROJECT_ROOT/$pattern; do
    [ -f "$f" ] || continue
    local rel="${f#$PROJECT_ROOT/}"
    copy_file "$rel"
  done
  shopt -u nullglob
}

copy_dir() {
  local src="$PROJECT_ROOT/$1"
  local dst="$WWW/$1"
  if [ ! -d "$src" ]; then
    echo "  ⚠ skip (missing dir): $1/"
    return
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    local count=$(find "$src" -type f | wc -l | tr -d ' ')
    echo "  + $1/  ($count files)"
  else
    rm -rf "$dst"
    cp -R "$src" "$dst"
  fi
}

# ── 0. Reset www/ ──────────────────────────────────────────────────────
echo "═══ Cap Sync Build ═══"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry run — no files written)"
fi
echo ""

if [ "$DRY_RUN" -eq 0 ]; then
  rm -rf "$WWW"
  mkdir -p "$WWW"
fi

# ── 1. Game runtime HTML pages ─────────────────────────────────────────
echo "── HTML pages ──"
copy_file "index.html"
copy_file "stage-select.html"
copy_file "baccarat-game.html"
copy_file "baccarat-scoreboard.html"
copy_file "baccarat-guide.html"
copy_file "baccarat-odds.html"
copy_file "tutorial.html"
copy_file "tournament.html"
copy_file "casino-map.html"
copy_file "guide-download.html"
copy_file "privacy.html"
copy_file "terms.html"
copy_file "support.html"
copy_file "responsible-play.html"  # linked from privacy.html + terms.html
copy_file "baccarat-gladiator-logo.svg"

# ── 2. Per-stage pages — handled by step 8 below ──────────────────────
# (Skipped here so we don't accidentally ship orphan road-to-*.html
#  files for stages that have been removed from the carousel, e.g.
#  cat-cafe. Step 8 walks the live carousel and pulls each slug from
#  local repo if present, else from prod.)

# ── 3. Game runtime JS ────────────────────────────────────────────────
echo ""
echo "── JS modules ──"
copy_file "themes-extended.js"
copy_file "three.module.js"
copy_file "sw.js"
copy_file "book-promo.js"
copy_file "visit-beacon.js"   # anonymous visit beacon (loaded on entry pages)
copy_file "feedback-widget.js" # in-game feedback/bug reporter (loaded on game page)

# ── 4. PWA + manifest + runtime config + supporting pages ────────────
echo ""
echo "── PWA assets + supporting pages ──"
copy_file "manifest.json"
copy_file "baccarat-link-preview.png"
copy_file "bg-card.png"
copy_file "bg-playstore-icon.png"
copy_file "config.js"          # runtime API + Cognito config (critical)
copy_file "book.html"          # linked from casino-map
copy_file "roulette.html"      # linked from baccarat-scoreboard
copy_file "drill.html"         # linked from baccarat-scoreboard
copy_file "leaflet.min.css"    # casino-map.html dependency
copy_file "leaflet.min.js"     # casino-map.html dependency
copy_file "simulator.html"     # linked from baccarat-scoreboard
copy_file "qr-game.png"        # in-game share-card QR
copy_file "qr-book.png"        # in-game share-card QR

# ── 5. Stage previews (carousel art) ──────────────────────────────────
echo ""
echo "── Carousel preview JPGs ──"
copy_glob "preview-*.jpg"

# ── 6. Runtime asset folders ──────────────────────────────────────────
echo ""
echo "── Asset directories ──"
copy_dir "dealer"
copy_dir "previews"
copy_dir "icons"
copy_dir "assets"
copy_dir "images"

# ── 7. Misc images referenced by stages or the table backdrop ─────────
echo ""
echo "── Backdrop / table images ──"
copy_file "scoreboard.png"
copy_file "table-layout.png"
copy_file "macau.png"
copy_file "macau-night.png"
copy_file "splash-card-source.png"
copy_file "bellagio.jpg"
copy_file "borgata-atlantic-city.jpg"
copy_file "marina-bay-sands.jpg"
copy_file "monte-carlo-casino.jpg"
copy_file "ocean-casino-atlantic-city.jpg"
copy_file "paradise-city-station.jpg"
copy_file "sarova-stanley-nairobi.jpg"
copy_file "venetian-las-vegas.jpg"
copy_file "wynn-las-vegas.jpg"
copy_file "wynn-macau.jpg"

# ── 8. Per-stage road-to pages, driven by the live carousel ──────────
# Drive the bundled stage list from stage-select.html so anything you
# remove from the carousel automatically stops shipping. For each slug
# in the carousel: prefer the local repo file, fall back to a prod
# fetch over HTTPS.
echo ""
echo "── Per-stage pages (carousel-driven, local first → prod fallback) ──"

SLUGS_FROM_CAROUSEL=$(grep "slug:'" "$PROJECT_ROOT/stage-select.html" | \
  sed -E "s/.*slug:'([^']+)'.*/\1/" | sort -u)

for slug in $SLUGS_FROM_CAROUSEL; do
  if [ -f "$PROJECT_ROOT/road-to-$slug.html" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  + road-to-$slug.html (local)"
    else
      cp "$PROJECT_ROOT/road-to-$slug.html" "$WWW/road-to-$slug.html"
    fi
    continue
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  + road-to-$slug.html (would fetch from prod)"
  else
    if curl -sf -o "$WWW/road-to-$slug.html" "https://baccaratgladiator.com/road-to-$slug.html"; then
      printf "  ↓ road-to-%s.html (%d bytes)\n" "$slug" "$(stat -f %z "$WWW/road-to-$slug.html")"
    else
      echo "  ⚠ FAIL fetching road-to-$slug.html"
      rm -f "$WWW/road-to-$slug.html"
    fi
  fi
done

# Same for any preview-*.jpg referenced by stage-select but not local
echo ""
echo "── Mirror preview JPGs from S3 (any not in local repo) ──"
for slug in $SLUGS_FROM_CAROUSEL; do
  if [ -f "$WWW/preview-$slug.jpg" ]; then
    continue
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  + preview-$slug.jpg (would fetch from prod)"
  else
    curl -sf -o "$WWW/preview-$slug.jpg" "https://baccaratgladiator.com/preview-$slug.jpg" \
      && printf "  ↓ preview-%s.jpg\n" "$slug" \
      || rm -f "$WWW/preview-$slug.jpg"
  fi
done

# ── 9. Sync into Capacitor native projects ────────────────────────────
echo ""
echo "── Capacitor sync ──"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  (would run: npx cap copy ios)"
  [ "$SYNC_ANDROID" -eq 1 ] && echo "  (would run: npx cap copy android)"
else
  cd "$PROJECT_ROOT"
  npx cap copy ios
  [ "$SYNC_ANDROID" -eq 1 ] && npx cap copy android
fi

# ── 10. Report ────────────────────────────────────────────────────────
echo ""
echo "═══ www/ summary ═══"
if [ "$DRY_RUN" -eq 0 ]; then
  printf "  %d files, %s total\n" \
    "$(find "$WWW" -type f | wc -l | tr -d ' ')" \
    "$(du -sh "$WWW" | cut -f1)"
fi
echo ""
echo "Done."
