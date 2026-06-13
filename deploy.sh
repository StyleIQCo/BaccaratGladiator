#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# BaccaratGladiator — Deploy to S3 + CloudFront invalidation
# Usage:
#   ./deploy.sh           — deploy all files
#   ./deploy.sh bj        — deploy bj/index.html only
#   ./deploy.sh baccarat  — deploy baccarat-scoreboard.html only
#   ./deploy.sh all       — deploy all files (same as no arg)
# ─────────────────────────────────────────────────────────────────────────

set -e

BUCKET="baccaratgladiator.com"
CF_DIST="E16CNCRHHS193O"
INVALIDATE_PATHS=()

TARGET="${1:-all}"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  BaccaratGladiator Deploy"
echo "═══════════════════════════════════════════════════════"

upload() {
  local src="$1"
  local dst="$2"
  local ct="${3:-text/html}"
  echo "  Uploading $src → s3://$BUCKET/$dst"
  aws s3 cp "$src" "s3://$BUCKET/$dst" --content-type "$ct"
  INVALIDATE_PATHS+=("/$dst")
}

case "$TARGET" in
  bj)
    upload "bj/index.html" "bj/index.html"
    ;;
  baccarat)
    upload "baccarat-scoreboard.html" "baccarat-scoreboard.html"
    ;;
  guide)
    upload "baccarat-guide.html"  "baccarat-guide.html"
    upload "guide-download.html"  "guide-download.html"
    upload "Road_to_Nine.pdf"     "downloads/road-to-nine.pdf" "application/pdf"
    ;;
  dragon7|short)
    # Natural-gameplay Dragon 7 YouTube Short
    upload "baccarat-gladiator-dragon7-natural.mp4"  "downloads/dragon7-natural-short.mp4" "video/mp4"
    ;;
  nine|road-to-nine)
    # Road to Nine stage loader (forwards into the main game)
    upload "road-to-nine.html"  "road-to-nine.html"
    ;;
  tournament|tnt)
    # Monthly tournament: landing page + macau game (seeded shoe) +
    # main scoreboard widget + sw.js cache bump.
    upload "tournament.html"     "tournament.html"
    upload "road-to-macau.html"  "road-to-macau.html"
    upload "baccarat-scoreboard.html" "baccarat-scoreboard.html"
    upload "sw.js"               "sw.js"             "application/javascript"
    ;;
  macau|road-to-macau)
    # Road to Macau VIP stage + roster updates + SW cache bump
    upload "road-to-macau.html"  "road-to-macau.html"
    upload "index.html"          "index.html"
    upload "stage-select.html"   "stage-select.html"
    upload "sw.js"               "sw.js"             "application/javascript"
    # Stage-select carousel reads /preview-${slug}.jpg from the bucket
    # root, while OG share-cards reference /previews/preview-${slug}.jpg
    # — keep both paths in sync.
    upload "previews/preview-macau.jpg"  "preview-macau.jpg"           "image/jpeg"
    upload "previews/preview-macau.jpg"  "previews/preview-macau.jpg"  "image/jpeg"
    ;;
  themes|extended-themes)
    # 42 new modular themed stages + 10 seasonal rotations.
    # Pushes the main game (with theme runtime + card/road safety CSS),
    # the stage-select carousel (with merge + seasonal logic), the
    # themes-extended.js data module, and bumps the SW cache.
    upload "baccarat-game.html"   "baccarat-game.html"
    upload "stage-select.html"    "stage-select.html"
    upload "themes-extended.js"   "themes-extended.js"  "application/javascript"
    upload "sw.js"                "sw.js"               "application/javascript"
    ;;
  legal|info)
    # Legal / info pages. responsible-play.html is linked from privacy + terms
    # but was never deployed (404 on live) — keep these four in sync.
    upload "privacy.html"            "privacy.html"
    upload "terms.html"              "terms.html"
    upload "support.html"            "support.html"
    upload "responsible-play.html"   "responsible-play.html"
    ;;
  feedback|fb)
    # In-game feedback widget: the widget script + the game page that loads
    # it, plus SW cache bump so cached HTML picks up the new <script> tag and
    # the widget is precached. Backend (/feedback route) ships via `sam deploy`.
    upload "feedback-widget.js"  "feedback-widget.js"  "application/javascript"
    upload "baccarat-game.html"  "baccarat-game.html"
    upload "sw.js"               "sw.js"               "application/javascript"
    ;;
  visits|visit)
    # Anonymous visit tracking: beacon script + the entry pages that load
    # it, plus SW cache bump so cached HTML picks up the new <script> tag.
    upload "visit-beacon.js"     "visit-beacon.js"   "application/javascript"
    upload "index.html"          "index.html"
    upload "stage-select.html"   "stage-select.html"
    upload "baccarat-game.html"  "baccarat-game.html"
    upload "book.html"           "book.html"
    upload "sw.js"               "sw.js"             "application/javascript"
    ;;
  all|*)
    upload "index.html"                "index.html"
    upload "baccarat-scoreboard.html"  "baccarat-scoreboard.html"
    upload "bj/index.html"             "bj/index.html"
    upload "baccarat-guide.html"       "baccarat-guide.html"
    upload "guide-download.html"       "guide-download.html"
    upload "responsible-play.html"     "responsible-play.html"
    upload "Road_to_Nine.pdf"          "downloads/road-to-nine.pdf" "application/pdf"
    ;;
esac

# CloudFront invalidation
echo ""
echo "  Invalidating CloudFront cache..."
PATHS_JSON=$(printf '%s\n' "${INVALIDATE_PATHS[@]}" | jq -R . | jq -s '{Paths:{Quantity:length,Items:.},CallerReference:("deploy-'$(date +%s)'")}')

INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DIST" \
  --invalidation-batch "$PATHS_JSON" \
  --query 'Invalidation.Id' --output text)

echo "  Invalidation started: $INVALIDATION_ID"
echo "  Waiting for completion..."

aws cloudfront wait invalidation-completed \
  --distribution-id "$CF_DIST" \
  --id "$INVALIDATION_ID"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Deploy complete!"
echo "  Paths deployed:"
for p in "${INVALIDATE_PATHS[@]}"; do
  echo "    https://$BUCKET$p"
done
echo "═══════════════════════════════════════════════════════"
echo ""
