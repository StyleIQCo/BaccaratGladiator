// Durable social data — the Prisma/Postgres side. Redis stays the hot
// path (leaderboard.ts, ledger.ts); everything here can lag or be down
// without affecting live play. Same money-integrity stance as ledger.ts:
// every mutation is guarded to be exactly-once.
//
// Chip/gem CREDITS are not written here — they flow through the Redis
// ledger (creditChips) with an idempotency key derived from the row that
// authorized them, e.g. `mission:{missionProgressId}`.
import { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient | null = null;
export const hasDb = () => Boolean(process.env.DATABASE_URL);

/** Lazy singleton — importing this module never requires a database. */
export function prisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

const seasonBounds = (seasonKey: string) => {
  const [y, m] = seasonKey.split('-').map(Number);
  return {
    startsAt: new Date(Date.UTC(y, m - 1, 1)),
    endsAt: new Date(Date.UTC(y, m, 1)),
  };
};

/** Durable mirror of a Redis score write. Absolute score, monotonic bestStreak. */
export async function mirrorScore(
  seasonKey: string, tier: number, userId: string, score: number, bestStreak: number,
): Promise<void> {
  if (!hasDb()) return;
  const db = prisma();
  const season = await db.leaderboardSeason.upsert({
    where: { key: seasonKey },
    update: {},
    create: { key: seasonKey, ...seasonBounds(seasonKey) },
  });
  await db.leaderboardScore.upsert({
    where: { seasonId_tier_userId: { seasonId: season.id, tier, userId } },
    update: { score: BigInt(score) },
    create: { seasonId: season.id, tier, userId, score: BigInt(score), bestStreak },
  });
  if (bestStreak > 0) {
    await db.leaderboardScore.updateMany({
      where: { seasonId: season.id, tier, userId, bestStreak: { lt: bestStreak } },
      data: { bestStreak },
    });
  }
}

export type RedeemResult =
  | { ok: true; referralId: string; referrerId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'EXHAUSTED' | 'SELF_REFERRAL' | 'ALREADY_REFERRED' };

/**
 * Redeem a Buddy Pass for a freshly signed-up user. Transactional:
 * the unique constraint on Referral.refereeId is the hard guarantee that
 * an account can only ever be referred once, even under concurrent calls.
 */
export async function redeemBuddyPass(code: string, refereeId: string): Promise<RedeemResult> {
  const db = prisma();
  try {
    return await db.$transaction(async tx => {
      const pass = await tx.buddyPass.findUnique({ where: { code: code.toUpperCase() } });
      if (!pass) return { ok: false as const, reason: 'NOT_FOUND' as const };
      if (pass.expiresAt && pass.expiresAt < new Date()) return { ok: false as const, reason: 'EXPIRED' as const };
      if (pass.uses >= pass.maxUses) return { ok: false as const, reason: 'EXHAUSTED' as const };
      if (pass.ownerId === refereeId) return { ok: false as const, reason: 'SELF_REFERRAL' as const };

      const referral = await tx.referral.create({
        data: { passId: pass.id, referrerId: pass.ownerId, refereeId },
      });
      await tx.buddyPass.update({ where: { id: pass.id }, data: { uses: { increment: 1 } } });
      return { ok: true as const, referralId: referral.id, referrerId: pass.ownerId };
    });
  } catch (e: unknown) {
    // P2002 = unique violation on refereeId — this account was already referred.
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return { ok: false, reason: 'ALREADY_REFERRED' };
    }
    throw e;
  }
}

/**
 * Claim a completed mission exactly once. The guarded updateMany IS the
 * lock: only one concurrent claim can flip claimedAt from null. Returns
 * the reward to credit (via creditChips with idemKey `mission:{id}`),
 * or null if not completed / already claimed / not yours.
 */
export async function claimMission(
  missionProgressId: string, userId: string,
): Promise<{ rewardChips: number; rewardGems: number } | null> {
  const db = prisma();
  const flipped = await db.missionProgress.updateMany({
    where: { id: missionProgressId, userId, completedAt: { not: null }, claimedAt: null },
    data: { claimedAt: new Date() },
  });
  if (flipped.count !== 1) return null;
  const row = await db.missionProgress.findUniqueOrThrow({
    where: { id: missionProgressId },
    include: { template: { select: { rewardChips: true, rewardGems: true } } },
  });
  return { rewardChips: row.template.rewardChips, rewardGems: row.template.rewardGems };
}
