-- Lore collectibles: 62 stages, one story. Collectible is the authored
-- library; UserCollectible is the per-player unlock fact. The unique
-- (userId, collectibleId) index is the exactly-once award lock — the
-- store treats a P2002 on insert as "already owned", never an error.

-- CreateEnum
CREATE TYPE "UnlockTrigger" AS ENUM ('STAGE_CLEAR', 'TIE_WIN', 'NATURAL_WIN', 'BANKER_WIN', 'PLAYER_WIN', 'WIN_STREAK');

-- CreateTable
CREATE TABLE "Collectible" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "characterName" TEXT NOT NULL,
    "loreText" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🔶',
    "stageSlug" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "trigger" "UnlockTrigger" NOT NULL,
    "triggerValue" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Collectible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCollectible" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectibleId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roundId" TEXT,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "UserCollectible_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Collectible_slug_key" ON "Collectible"("slug");

-- CreateIndex
CREATE INDEX "Collectible_stageSlug_active_idx" ON "Collectible"("stageSlug", "active");

-- CreateIndex
CREATE INDEX "Collectible_characterName_idx" ON "Collectible"("characterName");

-- CreateIndex
CREATE INDEX "UserCollectible_userId_seenAt_idx" ON "UserCollectible"("userId", "seenAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserCollectible_userId_collectibleId_key" ON "UserCollectible"("userId", "collectibleId");

-- AddForeignKey
ALTER TABLE "UserCollectible" ADD CONSTRAINT "UserCollectible_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCollectible" ADD CONSTRAINT "UserCollectible_collectibleId_fkey" FOREIGN KEY ("collectibleId") REFERENCES "Collectible"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
