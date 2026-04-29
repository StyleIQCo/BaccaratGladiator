#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# BaccaratGladiator Stripe Lambda — Deploy Script
# Usage: ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────

set -e

STACK_NAME="bg-stripe"
REGION="us-east-1"
S3_BUCKET="bg-stripe-deploy-$(aws sts get-caller-identity --query Account --output text)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  BaccaratGladiator Stripe Lambda Deploy"
echo "═══════════════════════════════════════════════════════"
echo ""

# Prompt for secrets (never stored in files)
read -s -p "  Stripe secret key (sk_live_... or sk_test_...): " STRIPE_SECRET
echo ""
read -s -p "  Stripe webhook secret (whsec_... — press Enter to skip): " WEBHOOK_SECRET
echo ""
echo ""

if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET="placeholder_set_after_deploy"
  echo "  ⚠  Webhook secret skipped — update after registering webhook URL."
  echo ""
fi

read -s -p "  Book PDF URL (S3 public URL — press Enter to keep existing): " BOOK_PDF_URL
echo ""
echo ""

if [ -z "$BOOK_PDF_URL" ]; then
  # Try to read existing value from the deployed stack
  BOOK_PDF_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query "Stacks[0].Parameters[?ParameterKey=='BookPdfUrl'].ParameterValue" \
    --output text 2>/dev/null || echo "")
  if [ -z "$BOOK_PDF_URL" ] || [ "$BOOK_PDF_URL" = "None" ]; then
    BOOK_PDF_URL="placeholder_set_book_pdf_url"
    echo "  ⚠  BookPdfUrl not set — book downloads will return 500 until configured."
    echo "     Upload the PDF to S3, then re-run this script with the public URL."
    echo ""
  else
    echo "  ✓  Keeping existing BookPdfUrl from deployed stack."
    echo ""
  fi
fi

# Create S3 bucket for SAM artifacts if it doesn't exist
echo "  Creating SAM artifact bucket if needed..."
aws s3 mb s3://$S3_BUCKET --region $REGION 2>/dev/null || true

# Install production dependencies
echo "  Installing dependencies..."
npm install --omit=dev 2>/dev/null || npm install

# Build
echo "  Building..."
sam build --region $REGION

# Deploy
echo "  Deploying stack: $STACK_NAME"
sam deploy \
  --stack-name $STACK_NAME \
  --s3-bucket $S3_BUCKET \
  --region $REGION \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    StripeSecretKey="$STRIPE_SECRET" \
    StripeWebhookSecret="$WEBHOOK_SECRET" \
    AllowedOrigin="https://baccaratgladiator.com" \
    BookPdfUrl="$BOOK_PDF_URL" \
  --no-confirm-changeset

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Deploy complete! Your endpoints:"
echo "═══════════════════════════════════════════════════════"
aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

echo ""
echo "  NEXT STEPS (if first deploy):"
echo "  1. Upload the PDF to S3:"
echo "       aws s3 cp Road_to_Nine.pdf s3://YOUR_BUCKET/Road_to_Nine.pdf --acl public-read"
echo "     Then re-run this script and paste:"
echo "       https://YOUR_BUCKET.s3.us-east-1.amazonaws.com/Road_to_Nine.pdf"
echo ""
echo "  2. Register the Stripe webhook:"
echo "       stripe.com → Developers → Webhooks → Add endpoint"
echo "       URL: (copy WebhookUrl from the table above)"
echo "       Event: checkout.session.completed"
echo "     Re-run with the whsec_ secret to activate chip crediting."
echo ""
echo "  3. Test the subscribe endpoint:"
echo "       curl -X POST (SubscribeUrl) \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"email\":\"test@example.com\",\"source\":\"test\"}'"
echo ""
