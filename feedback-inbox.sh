#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# feedback-inbox.sh — read in-game feedback / bug reports from DynamoDB.
#
# The FeedbackTable holds PII (emails, balances), so there is deliberately
# NO public read endpoint — you pull reports locally with your deploy creds.
#
# Usage:
#   ./feedback-inbox.sh              — newest 20 reports (all categories)
#   ./feedback-inbox.sh 50           — newest 50
#   ./feedback-inbox.sh bug          — only bug reports (newest 20)
#   ./feedback-inbox.sh feature 100  — only feature suggestions, newest 100
#   ./feedback-inbox.sh --json       — raw JSON (for piping into jq/scripts)
#
# Notes:
#   - Scans one DynamoDB page (≤1MB). Fine for a low-volume feedback table;
#     if it ever outgrows that, switch to a paginated query on the ByDay GSI.
# ─────────────────────────────────────────────────────────────────────────
set -e

STACK="${FEEDBACK_STACK:-baccarat-gladiator-prod-v2}"
REGION="${AWS_REGION:-us-east-1}"

# Parse args: optional category (bug|feature|general), optional limit, --json.
CATEGORY=""
LIMIT=20
RAW=0
for arg in "$@"; do
  case "$arg" in
    --json) RAW=1 ;;
    bug|feature|general) CATEGORY="$arg" ;;
    ''|*[!0-9]*) ;;            # ignore non-numeric junk
    *) LIMIT="$arg" ;;          # all-digits → limit
  esac
done

command -v jq >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }

# Resolve the table's physical name from the stack output so the random
# CloudFormation suffix never has to be hardcoded.
TABLE="${FEEDBACK_TABLE:-$(aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FeedbackTableName'].OutputValue" \
  --output text)}"

if [ -z "$TABLE" ] || [ "$TABLE" = "None" ]; then
  echo "Could not resolve FeedbackTable from stack '$STACK'." >&2
  exit 1
fi

# Pull the table (optionally server-side filtered by category).
if [ -n "$CATEGORY" ]; then
  ITEMS=$(aws dynamodb scan --table-name "$TABLE" --region "$REGION" \
    --filter-expression "category = :c" \
    --expression-attribute-values "{\":c\":{\"S\":\"$CATEGORY\"}}" \
    --output json)
else
  ITEMS=$(aws dynamodb scan --table-name "$TABLE" --region "$REGION" --output json)
fi

# Unwrap DynamoDB attribute-value JSON → plain objects, newest first.
FLAT=$(echo "$ITEMS" | jq '[.Items[] | with_entries(.value |= (.S // .N // .BOOL))]
                            | sort_by(.createdAt) | reverse')

TOTAL=$(echo "$FLAT" | jq 'length')

if [ "$RAW" -eq 1 ]; then
  echo "$FLAT" | jq ".[:$LIMIT]"
  exit 0
fi

ICON_bug='🐞'; ICON_feature='💡'; ICON_general='💬'

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Feedback inbox — $TOTAL total${CATEGORY:+ (category: $CATEGORY)}, showing newest $LIMIT"
echo "  table: $TABLE"
echo "═══════════════════════════════════════════════════════"

echo "$FLAT" | jq -r ".[:$LIMIT] | .[] |
  \"\\n[\(.category // \"?\")] \(.createdAt // \"?\")\" +
  \"\\n  from: \(.userId // \"guest\")\(if .userEmail and .userEmail != \"\" then \" <\(.userEmail)>\" else \"\" end)\" +
  \"\\n  state: balance=\(.balance // \"?\") · table=\(.tableState // \"?\") · venue=\(.venue // \"?\") · page=\(.page // \"?\")\" +
  \"\\n  ua: \(.browserInfo // \"\" | .[0:90])\" +
  \"\\n  ┃ \(.message // \"\" | gsub(\"\\n\"; \"\\n  ┃ \"))\""

echo ""
