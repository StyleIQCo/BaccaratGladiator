#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# BaccaratGladiator Stripe Lambda — Deploy Script
# Usage: ./deploy.sh
# You will be prompted for your Stripe secret key and webhook secret.
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
read -s -p "  Stripe webhook secret (whsec_... — press Enter to skip for now): " WEBHOOK_SECRET
echo ""
echo ""

if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET="placeholder_set_after_deploy"
  echo "  ⚠  Webhook secret skipped — update the stack after registering"
  echo "     the webhook URL in your Stripe dashboard."
  echo ""
fi

# Create S3 bucket for SAM artifacts if it doesn't exist
echo "  Creating SAM artifact bucket if needed..."
aws s3 mb s3://$S3_BUCKET --region $REGION 2>/dev/null || true

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
echo "  NEXT STEPS:"
echo "  1. Copy the WebhookUrl above"
echo "  2. Go to stripe.com/dashboard → Developers → Webhooks"
echo "  3. Add endpoint: paste the WebhookUrl"
echo "  4. Select event: checkout.session.completed"
echo "  5. Copy the webhook signing secret (whsec_...)"
echo "  6. Re-run this script with the webhook secret to update"
echo ""
echo "  7. Copy the CreateCheckoutUrl into the game frontend"
echo "     (see stripe-lambda/frontend-snippet.js)"
echo ""
