-- Weekly "Top Fishmonger" arcade leaderboard (Pike Place Fish Toss).
-- FishmongerScore: one row per (user, ISO week) — the week's highest
-- single run. The hot path is the Redis ZSET ft:lb:{weekKey} (ZADD GT);
-- this table is the durable mirror. FishmongerPayout: exactly-once
-- durable receipt for each week's prize sweep (the hot guard is the
-- Redis ft:paid:{weekKey} NX lock).

-- New ledger reason for arcade prize credits. Safe inside the migration
-- transaction (PG12+) because nothing in this migration uses the value.
ALTER TYPE "ChipTxReason" ADD VALUE IF NOT EXISTS 'MINIGAME_PAYOUT';

-- CreateTable
CREATE TABLE "FishmongerScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FishmongerScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FishmongerPayout" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "winners" INTEGER NOT NULL DEFAULT 0,
    "totalPaid" BIGINT NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FishmongerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FishmongerScore_userId_weekKey_key" ON "FishmongerScore"("userId", "weekKey");

-- CreateIndex
CREATE INDEX "FishmongerScore_weekKey_score_idx" ON "FishmongerScore"("weekKey", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FishmongerPayout_weekKey_key" ON "FishmongerPayout"("weekKey");

-- AddForeignKey
ALTER TABLE "FishmongerScore" ADD CONSTRAINT "FishmongerScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
