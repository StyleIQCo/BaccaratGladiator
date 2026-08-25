// Lore collectibles — the durable Postgres side of the "62 stages, one
// story" progression layer. Same stance as social-store.ts: Redis owns
// the hot gameplay path; everything here can lag or be down without
// affecting live play. Callers on the settle path MUST invoke
// evaluateLoreUnlocks fire-and-forget — a lore outage never blocks a
// payout.
//
// AUTHORITY: a HandSettleEvent is assembled SERVER-SIDE (the arena
// gateway/engine at settle, or the solo-game backend at PAYOUT).
// Client claims never reach evaluateLoreUnlocks — same anti-fraud
// stance as referral-engine's /api/referrals/validate.
import { hasDb, prisma } from './social-store';

export type LoreSide = 'player' | 'banker' | 'tie';

export interface HandSettleEvent {
  userId: string;
  roundId: string;
  /** Stage the hand was played on — themes-extended.js slug (same
   *  registry as StageClear.stageSlug), supplied by the game server. */
  stageSlug: string;
  bet: { side: LoreSide; amount: number };
  hand: { outcome: LoreSide; natural: boolean };
  /** Consecutive wins INCLUDING this hand — the engine already tracks
   *  this for STREAK_REACHED missions. Omit when unavailable. */
  winStreak?: number;
  /** True when this hand completed the stage's clear condition (the
   *  engine writes the StageClear stamp in the same settle). */
  stageCleared?: boolean;
}

/** What the unlock cinematic needs — pushed over `lore:unlock` or
 *  served by getUnseenLore on session bootstrap. */
export interface LoreUnlock {
  unlockId: string; // UserCollectible.id — the client acks it via markLoreSeen
  slug: string;
  title: string;
  characterName: string;
  loreText: string;
  icon: string;
  stageSlug: string;
  tier: number;
  /** Completionist bar for this character's set, e.g. { collected: 3, total: 5 }. */
  progress: { collected: number; total: number };
}

/** Does this settle event satisfy a collectible's unlock trigger? */
function triggerMet(c: { trigger: string; triggerValue: number }, ev: HandSettleEvent): boolean {
  const won = ev.bet.side === ev.hand.outcome;
  switch (c.trigger) {
    case 'STAGE_CLEAR': return ev.stageCleared === true;
    case 'TIE_WIN':     return won && ev.hand.outcome === 'tie';
    case 'NATURAL_WIN': return won && ev.hand.natural;
    case 'BANKER_WIN':  return won && ev.hand.outcome === 'banker';
    case 'PLAYER_WIN':  return won && ev.hand.outcome === 'player';
    case 'WIN_STREAK':  return won && (ev.winStreak ?? 0) >= c.triggerValue;
    default:            return false; // trigger from a newer schema — never award blind
  }
}

/**
 * Runs after a baccarat hand resolves. Checks the settle event against
 * every still-locked collectible on the stage and awards the matches
 * — e.g. a won TIE bet on 'wild-west' drops the Lone Star Sheriff's
 * Badge if the player doesn't own it yet.
 *
 * Exactly-once: the unique (userId, collectibleId) constraint is the
 * lock. A racing duplicate settle hits P2002 and is treated as
 * "already owned", not an error. Returns only NEWLY awarded items,
 * each carrying the character's completionist progress for the UI.
 */
export async function evaluateLoreUnlocks(ev: HandSettleEvent): Promise<LoreUnlock[]> {
  if (!hasDb()) return [];
  const db = prisma();

  // Still locked = active on this stage, no unlock row for this user.
  const candidates = await db.collectible.findMany({
    where: { stageSlug: ev.stageSlug, active: true, unlocks: { none: { userId: ev.userId } } },
    orderBy: { sortOrder: 'asc' },
  });

  const awarded: LoreUnlock[] = [];
  for (const c of candidates.filter(c => triggerMet(c, ev))) {
    try {
      const row = await db.userCollectible.create({
        data: { userId: ev.userId, collectibleId: c.id, roundId: ev.roundId },
      });
      awarded.push({
        unlockId: row.id,
        slug: c.slug, title: c.title, characterName: c.characterName,
        loreText: c.loreText, icon: c.icon, stageSlug: c.stageSlug, tier: c.tier,
        progress: await characterProgress(ev.userId, c.characterName),
      });
    } catch (e: unknown) {
      // P2002 = a concurrent settle already awarded it — silence is correct.
      if (typeof e !== 'object' || e === null || (e as { code?: string }).code !== 'P2002') throw e;
    }
  }
  return awarded;
}

/** "Texas Backstory: 3/5" — collected vs authored for one character's set. */
export async function characterProgress(
  userId: string, characterName: string,
): Promise<{ collected: number; total: number }> {
  const db = prisma();
  const [total, collected] = await Promise.all([
    db.collectible.count({ where: { characterName, active: true } }),
    db.userCollectible.count({ where: { userId, collectible: { characterName, active: true } } }),
  ]);
  return { collected, total };
}

/**
 * Unlocks whose cinematic hasn't been acked — served on session
 * bootstrap so a killed app or missed socket push still gets its
 * moment instead of losing it.
 */
export async function getUnseenLore(userId: string): Promise<LoreUnlock[]> {
  if (!hasDb()) return [];
  const rows = await prisma().userCollectible.findMany({
    where: { userId, seenAt: null },
    include: { collectible: true },
    orderBy: { unlockedAt: 'asc' },
  });
  return Promise.all(rows.map(async r => ({
    unlockId: r.id,
    slug: r.collectible.slug, title: r.collectible.title,
    characterName: r.collectible.characterName, loreText: r.collectible.loreText,
    icon: r.collectible.icon, stageSlug: r.collectible.stageSlug, tier: r.collectible.tier,
    progress: await characterProgress(userId, r.collectible.characterName),
  })));
}

/**
 * Ack the unlock cinematic exactly once — the guarded updateMany IS
 * the lock (same pattern as claimMission). Returns false when already
 * seen / not this user's row.
 */
export async function markLoreSeen(unlockId: string, userId: string): Promise<boolean> {
  if (!hasDb()) return false;
  const flipped = await prisma().userCollectible.updateMany({
    where: { id: unlockId, userId, seenAt: null },
    data: { seenAt: new Date() },
  });
  return flipped.count === 1;
}
