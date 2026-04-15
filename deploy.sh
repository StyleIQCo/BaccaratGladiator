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
  echo "  Uploading $src → s3://$BUCKET/$dst"
  aws s3 cp "$src" "s3://$BUCKET/$dst" --content-type "text/html"
  INVALIDATE_PATHS+=("/$dst")
}

case "$TARGET" in
  bj)
    upload "bj/index.html" "bj/index.html"
    ;;
  baccarat)
    upload "baccarat-scoreboard.html" "baccarat-scoreboard.html"
    ;;
  all|*)
    upload "index.html"                "index.html"
    upload "baccarat-scoreboard.html"  "baccarat-scoreboard.html"
    upload "bj/index.html"             "bj/index.html"
    # Add more files here as needed
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
