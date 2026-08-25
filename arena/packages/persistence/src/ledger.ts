// Chip balance mutations. Every mutation is atomic + idempotent: replaying the
// same (user, roundId) never double-credits. Balances are virtual social-casino
// chips — but the integrity rules are written as if they were real money.
import { data, loadScript } from './redis';
import { settleLeaderboardScore, currentSeasonKey } from './leaderboard';
import { settleLoreUnlocks, type LoreSide } from './collectibles-store';

const bal = (u: string) => `bal:${u}`;
const done = (scope: string) => `settled:${scope}`; // idempotency guard set

/** Credit chips once per idempotency key. Returns the new balance. */
export async function creditChips(userId: string, amount: number, idemKey: string): Promise<number> {
  const fresh = await data.sadd(done(idemKey), userId); // 1 if not seen before
  if (fresh === 0) return Number(await data.get(bal(userId)) ?? 0);
  await data.expire(done(idemKey), 86_400);
  return Number(await data.incrby(bal(userId), amount));
}

export const DEBIT_SHA = await loadScript('debit_chips.lua');

/**
 * Debit chips atomically with a balance floor. Idempotent per idemKey —
 * a replay is a no-op that reports success. `ok:false` = insufficient funds.
 */
export async function debitChips(
  userId: string, amount: number, idemKey: string,
): Promise<{ ok: boolean; balance: number }> {
  const [status, balStr] = await data.evalsha(
    DEBIT_SHA, 2, bal(userId), done(idemKey), String(Math.floor(amount)), userId,
  ) as [number, string];
  return { ok: status !== 0, balance: Number(balStr) };
}

/**
 * Crash cash-out: lock the SERVER-decided multiplier for (user, round) exactly
 * once. Returns the locked multiplier + credited amount, or null if the user
 * already cashed out / had no crash bet. The first call for a (user, round) wins.
 */
export async function lockCashOut(
  userId: string, roundId: string, serverMultiplier: number,
): Promise<{ multiplier: number; amount: number; stake: number; balance: number } | null> {
  const lockKey = `cashout:${roundId}:${userId}`;
  const locked = await data.set(lockKey, serverMultiplier, 'EX', 120, 'NX');
  if (locked !== 'OK') return null;                      // duplicate tap
  const stakeRaw = await data.get(`crashbet:${roundId}:${userId}`);
  if (!stakeRaw) return null;                            // no crash bet placed
  const stake = Number(stakeRaw);
  const amount = Math.floor(stake * serverMultiplier);
  const balance = await creditChips(userId, amount, lockKey);
  return { multiplier: serverMultiplier, amount, stake, balance };
}

/** Engine writes its authoritative crash tick here so gateways validate against it. */
export async function mirrorCrash(roundId: string, multiplier: number, crashed: boolean): Promise<void> {
  await data.set(`crash:${roundId}`, JSON.stringify({ multiplier, crashed }), 'EX', 60);
}

/** Read the engine's latest crash state — the source of truth for cash-out timing. */
export async function getLiveCrash(roundId: string): Promise<{ multiplier: number; crashed: boolean } | null> {
  const raw = await data.get(`crash:${roundId}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Settle main baccarat bets at PAYOUT. Idempotent by roundId.
 * Stakes were debited at placement (gateway bets handler), so:
 *   winners  → credit stake + winnings (player 1:1, banker 0.95:1, tie 8:1)
 *   tie hand → player/banker main bets PUSH: refund the stake
 *   losers   → nothing left to do
 * Each winning credit also feeds the tier leaderboard; a leaderboard or
 * mirror failure never blocks a payout.
 */
export async function settleRound(ctx: { roundId: string; hand: { outcome: string; natural?: boolean } }): Promise<void> {
  const guard = await data.set(`roundsettled:${ctx.roundId}`, '1', 'EX', 3600, 'NX');
  if (guard !== 'OK') return; // already settled (e.g. leader failover replay)

  const bets = await data.hgetall(`bets:${ctx.roundId}:main`);
  const outcome = ctx.hand.outcome;

  for (const [userId, raw] of Object.entries(bets)) {
    try {
      const bet = JSON.parse(raw) as {
        side: string; amount: number; handle?: string; avatarKey?: string; tier?: number; stageSlug?: string;
      };
      const amount = Math.floor(Number(bet.amount));
      if (!(amount > 0)) continue;
      const idem = `settle:${ctx.roundId}:${userId}:main`;

      if (bet.side === outcome) {
        const winnings = outcome === 'tie' ? amount * 8
          : outcome === 'banker' ? Math.floor(amount * 0.95)
          : amount;
        await creditChips(userId, amount + winnings, idem);
        await settleLeaderboardScore(
          currentSeasonKey(),
          bet.tier ?? 1,
          { userId, handle: bet.handle ?? 'Gladiator', avatarKey: bet.avatarKey ?? 'gladiator-01' },
          winnings,
        ).catch(() => {});
        // Win streak: INCR on win, reset on loss, untouched on push —
        // powers WIN_STREAK lore triggers. Runs once per round thanks to
        // the roundsettled guard above.
        const streak = await data.incr(`streak:${userId}`);
        await data.expire(`streak:${userId}`, 30 * 86_400);
        // Lore collectibles ride the settle, fire-and-forget: a lore/DB
        // outage never blocks a payout. No stage snapshot on the bet
        // (pre-lore client) → nothing stage-scoped can drop; skip.
        if (bet.stageSlug) {
          settleLoreUnlocks({
            userId, roundId: ctx.roundId, stageSlug: bet.stageSlug,
            bet: { side: bet.side as LoreSide, amount },
            hand: { outcome: outcome as LoreSide, natural: ctx.hand.natural === true },
            winStreak: streak,
          }).catch(() => {});
        }
      } else if (outcome === 'tie') {
        await creditChips(userId, amount, idem); // push — stake back, streak untouched
      } else {
        await data.del(`streak:${userId}`); // loss ends the run
      }
    } catch { /* one malformed row never blocks the rest of the table */ }
  }
}
