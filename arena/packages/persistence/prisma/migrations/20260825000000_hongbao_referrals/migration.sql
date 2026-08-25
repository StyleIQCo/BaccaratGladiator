-- Hongbao referral skin: every Referral now carries a red envelope.
-- hongbaoValue = chips inside; hongbaoOpenedAt is the exactly-once
-- open gate (same claim pattern as MissionProgress.claimedAt).
ALTER TABLE "Referral"
  ADD COLUMN "hongbaoValue" INTEGER NOT NULL DEFAULT 8888,
  ADD COLUMN "hongbaoOpenedAt" TIMESTAMP(3),
  ADD COLUMN "blessing" VARCHAR(120);

-- Tetraphobia guard: no envelope amount may contain the digit 4
-- (四 ≈ 死). Enforced at the DB so ops scripts and future callers
-- can't ship an unlucky amount either — app-side mirrors this in
-- social-store.ts and i18n/lucky.ts.
ALTER TABLE "Referral"
  ADD CONSTRAINT "Referral_hongbaoValue_lucky"
  CHECK ("hongbaoValue" > 0 AND position('4' in "hongbaoValue"::text) = 0);
