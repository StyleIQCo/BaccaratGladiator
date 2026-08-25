-- Repair migration: backfill DDL that shipped schema-only (drift).
-- The referral-engine instant-payout fields and the durable chip ledger
-- (ChipTransaction / ChipTxReason) existed in schema.prisma but no
-- migration ever created them, so a fresh database failed on the first
-- migration that referenced them. Every statement is guarded so this
-- applies cleanly BOTH to fresh databases and to environments where
-- some of this DDL already exists (e.g. synced via `prisma db push`).

-- Durable chip-ledger reason enum, pre-fishmonger shape: MINIGAME_PAYOUT
-- is added by the next migration, keeping the history's intent.
DO $$ BEGIN
  CREATE TYPE "ChipTxReason" AS ENUM ('REFERRAL_WELCOME_GIFT', 'REFERRAL_BOUNTY', 'MISSION_REWARD', 'STAGE_REWARD', 'GAME_SETTLEMENT', 'ADMIN_ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Referral-engine instant-payout state (welcome gift at signup, bounty
-- auto-paid on Stage-1 clear).
ALTER TYPE "ReferralStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- Referral: audit trail of the literal code entered, and passId goes
-- nullable (User.referralCode signups have no BuddyPass ticket).
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "codeUsed" TEXT;
ALTER TABLE "Referral" ALTER COLUMN "passId" DROP NOT NULL;
ALTER TABLE "Referral" DROP CONSTRAINT IF EXISTS "Referral_passId_fkey";
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_passId_fkey" FOREIGN KEY ("passId") REFERENCES "BuddyPass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- User: evergreen personal invite code ("GLAD-7F3K" style).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

-- Durable append-only chip ledger (see schema comments: idemKey is the
-- audit-grade exactly-once guarantee).
CREATE TABLE IF NOT EXISTS "ChipTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "reason" "ChipTxReason" NOT NULL,
    "idemKey" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChipTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChipTransaction_idemKey_key" ON "ChipTransaction"("idemKey");
CREATE INDEX IF NOT EXISTS "ChipTransaction_userId_createdAt_idx" ON "ChipTransaction"("userId", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "ChipTransaction" ADD CONSTRAINT "ChipTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
