#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Grand Arena — deploy ONLY the /arena/* static frontend.
# Mirrors ../deploy.sh but is scoped entirely to the arena prefix, so it can
# NEVER overwrite a classic-game file. Backend (engine/gateway) deploys
# separately to ECS/ALB — this script does not touch it.
#
# Usage:
#   ./deploy-arena.sh            — build web/ and deploy the whole /arena/ app
#   ./deploy-arena.sh flags      — deploy ONLY config/flags.json (the kill switch)
#   ./deploy-arena.sh config     — deploy config/* (flags + round + themes)
# ─────────────────────────────────────────────────────────────────────────
set -e

BUCKET="baccaratgladiator.com"
CF_DIST="E16CNCRHHS193O"
PREFIX="arena"            # everything lands under s3://$BUCKET/arena/
INVALIDATE_PATHS=()

TARGET="${1:-all}"
HERE="$(cd "$(dirname "$0")" && pwd)"

upload() {
  local src="$1" dst="$2" ct="${3:-application/octet-stream}" cc="${4:-}"
  echo "  Uploading $src → s3://$BUCKET/$PREFIX/$dst"
  if [ -n "$cc" ]; then
    aws s3 cp "$src" "s3://$BUCKET/$PREFIX/$dst" --content-type "$ct" --cache-control "$cc"
  else
    aws s3 cp "$src" "s3://$BUCKET/$PREFIX/$dst" --content-type "$ct"
  fi
  INVALIDATE_PATHS+=("/$PREFIX/$dst")
}

# ── RELEASE GATE ──────────────────────────────────────────────────────────
# Per CLAUDE.md: the arena frontend publishes to a tester-facing surface, but
# the classic E2E scripts do not cover it. This guard refuses to run unless the
# arena E2E has been run and the operator confirms.
if [ "$ARENA_E2E_OK" != "1" ]; then
  echo ""
  echo "  ✋ Refusing to deploy: run 'node test-arena-e2e.js', report results,"
  echo "     then re-run with ARENA_E2E_OK=1 ./deploy-arena.sh $TARGET"
  exit 1
fi

case "$TARGET" in
  flags)
    # Fastest rollback lever — no-store so it's never cached stale.
    upload "config/flags.json" "config/flags.json" "application/json" "no-store"
    ;;
  config)
    upload "config/flags.json"          "config/flags.json"          "application/json" "no-store"
    upload "config/round.json"          "config/round.json"          "application/json" "no-store"
    upload "config/themes/default.json" "config/themes/default.json" "application/json"
    ;;
  all|*)
    echo "  Building web/ ..."
    ( cd "$HERE/web" && npm run build )   # vite build, base=/arena/, outputs web/dist
    # Sync the built static app under the arena prefix.
    echo "  Syncing web/dist → s3://$BUCKET/$PREFIX/"
    aws s3 sync "$HERE/web/dist/" "s3://$BUCKET/$PREFIX/" --delete \
      --exclude "config/*"   # never let a build wipe the live kill switch
    # Directory-index aliases. The distribution's URL-rewrite function
    # appends ".html" to extensionless viewer paths, so "/arena/" fetches
    # origin key "arena/.html" and "/arena" fetches "arena.html" (verified
    # via x-amz-error-detail-key). Publish index.html at BOTH keys — this
    # is what makes https://…/arena/ load. Re-created after every sync
    # because --delete removes them (they aren't in web/dist).
    aws s3api put-object --bucket "$BUCKET" --key "$PREFIX/.html" --body "$HERE/web/dist/index.html" --content-type "text/html" > /dev/null
    aws s3api put-object --bucket "$BUCKET" --key "$PREFIX.html"  --body "$HERE/web/dist/index.html" --content-type "text/html" > /dev/null
    INVALIDATE_PATHS+=("/$PREFIX/*" "/$PREFIX")
    # Configs deployed explicitly with no-store.
    upload "config/flags.json"          "config/flags.json"          "application/json" "no-store"
    upload "config/round.json"          "config/round.json"          "application/json" "no-store"
    upload "config/themes/default.json" "config/themes/default.json" "application/json"
    ;;
esac

echo ""
echo "  Invalidating CloudFront..."
PATHS_JSON=$(printf '%s\n' "${INVALIDATE_PATHS[@]}" | jq -R . | jq -s '{Paths:{Quantity:length,Items:.},CallerReference:("arena-'"$(date +%s)"'")}')
INVALIDATION_ID=$(aws cloudfront create-invalidation --distribution-id "$CF_DIST" \
  --invalidation-batch "$PATHS_JSON" --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed --distribution-id "$CF_DIST" --id "$INVALIDATION_ID"

echo ""
echo "  Arena deploy complete. Paths:"
for p in "${INVALIDATE_PATHS[@]}"; do echo "    https://$BUCKET$p"; done
