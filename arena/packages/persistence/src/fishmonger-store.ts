// ═══════════════════════════════════════════════════════════════════
//  WEEKLY FISHMONGER — Pike Place Fish Toss arcade leaderboard.
//  Hot path is Redis (same stance as leaderboard.ts): one ZSET per ISO
//  week, ZADD GT = "keep the highest single run" enforced atomically in
//  the store, so two gateways can never disagree about a weekly best.
//  Postgres mirrors durably (FishmongerScore) and holds the payout
//  audit trail (FishmongerPayout + ChipTransaction receipts); a missing
//  DATABASE_URL degrades to Redis-only, never blocks a submit or sweep.
//
//  Prize sweep: the engine leader calls sweepFishmongerPayout() every
//  minute; once the ISO week rolls over (Mon 00:00 UTC — i.e. right
//  after Sunday 23:59) the just-ended week pays its top 10 exactly
//  once. Guards, in order of authority:
//    1. Redis `ft:paid:{weekKey}` SET NX — the hot exactly-once lock.
//    2. creditChips idemKey `ft:{weekKey}:{userId}` — replay-safe credit.
//    3. FishmongerPayout.weekKey UNIQUE — the durable receipt.
// ═══════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto';
import {
  SOCIAL_PROTOCOL_VERSION,
  type FishTossEntry,
  type FishTossSnapshotPayload,
} from '@bg/shared';
import { data } from './redis';
import { creditChips } from './ledger';
import { hasDb, prisma } from './social-store';

// Rank 1..3 step down; ranks 4–10 share the consolation tier.
export const FT_PRIZES = [50_000, 25_000, 10_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000];

const ftKey = (weekKey: string) => `ft:lb:${weekKey}`;
const FT_PROFILES = 'ft:profiles'; // userId → JSON {handle, avatarKey}
const ZSET_TTL_S = 45 * 86_400;    // boards GC themselves ~6 weeks after the week ends

/** ISO-8601 week key, UTC: '2026-W35'. */
export function weekKeyOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;         // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // shift to this week's Thursday — handles year boundaries
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const currentWeekKey = () => weekKeyOf(new Date());

/** Epoch ms when the current ISO week locks: next Monday 00:00 UTC. */
export function weekEndMs(d = new Date()): number {
  const day = d.getUTCDay() || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - day));
}

interface FtUser { userId: string; handle: string; avatarKey: string }

// ── Run proof: single-use tokens gate score submits ────────────────
// Issued at run start, consumed (GETDEL) at submit. TTL covers a full
// run plus grace; ownership + elapsed time are checked at consume so a
// stolen or instant-replayed token buys nothing.

const FT_RUN_TTL_S = 180;

export async function startFishTossRun(userId: string): Promise<{ runId: string }> {
  const runId = randomUUID();
  await data.set(`ft:run:${runId}`, JSON.stringify({ userId, t0: Date.now() }), 'EX', FT_RUN_TTL_S, 'NX');
  return { runId };
}

/** Atomically claim a run token. ok:false = missing/expired/replayed/not yours. */
export async function consumeFishTossRun(
  runId: string, userId: string,
): Promise<{ ok: boolean; elapsedMs: number }> {
  if (!/^[0-9a-f][0-9a-f-]{30,40}$/i.test(runId)) return { ok: false, elapsedMs: 0 };
  const raw = await data.getdel(`ft:run:${runId}`);
  if (!raw) return { ok: false, elapsedMs: 0 };
  try {
    const rec = JSON.parse(raw) as { userId: string; t0: number };
    if (rec.userId !== userId) return { ok: false, elapsedMs: 0 };
    return { ok: true, elapsedMs: Date.now() - rec.t0 };
  } catch {
    return { ok: false, elapsedMs: 0 };
  }
}

async function profileOf(userId: string): Promise<{ handle: string; avatarKey: string }> {
  const raw = await data.hget(FT_PROFILES, userId);
  return raw ? JSON.parse(raw) : { handle: 'Gladiator', avatarKey: 'gladiator-01' };
}

/**
 * Record one run. ZADD GT is the whole "highest single run per week"
 * rule: Redis keeps the max atomically, replays and races included.
 */
export async function submitFishTossScore(
  weekKey: string, user: FtUser, score: number,
): Promise<{ improved: boolean; best: number; rank: number }> {
  if (!Number.isInteger(score) || score <= 0) throw new Error('score must be a positive integer');
  const key = ftKey(weekKey);
  const changed = Number(await data.zadd(key, 'GT', 'CH', score, user.userId));
  await data.expire(key, ZSET_TTL_S);
  await data.hset(FT_PROFILES, user.userId, JSON.stringify({ handle: user.handle, avatarKey: user.avatarKey }));
  const [bestStr, rank0] = await Promise.all([
    data.zscore(key, user.userId),
    data.zrevrank(key, user.userId),
  ]);
  const best = Number(bestStr ?? score);
  if (changed > 0) mirrorFishTossScore(weekKey, user.userId, best).catch(() => {});
  return { improved: changed > 0, best, rank: (rank0 ?? 0) + 1 };
}

/** Durable keep-the-highest mirror — same guarded-write pattern as social-store's flips. */
async function mirrorFishTossScore(weekKey: string, userId: string, score: number): Promise<void> {
  if (!hasDb()) return;
  const db = prisma();
  const bumped = await db.fishmongerScore.updateMany({
    where: { userId, weekKey, score: { lt: score } },
    data: { score, achievedAt: new Date() },
  });
  if (bumped.count === 0) {
    // No row yet → create. Swallows the benign failures: P2002 (raced
    // create / mirror already ≥ score) and FK misses for accounts that
    // only exist in Redis — the mirror simply lags until they register.
    await db.fishmongerScore.create({ data: { userId, weekKey, score } }).catch(() => {});
  }
}

/** Board snapshot: top N joined with profiles, plus the caller's own row. */
export async function fishTossSnapshot(
  weekKey: string, meId: string | null, topN = 10,
): Promise<FishTossSnapshotPayload> {
  const key = ftKey(weekKey);
  const flat = await data.zrevrange(key, 0, topN - 1, 'WITHSCORES');
  const top: FishTossEntry[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const p = await profileOf(flat[i]);
    top.push({
      userId: flat[i], handle: p.handle, avatarKey: p.avatarKey,
      score: Number(flat[i + 1]), rank: i / 2 + 1,
    });
  }
  let me: FishTossEntry | null = null;
  if (meId) {
    const rank0 = await data.zrevrank(key, meId);
    if (rank0 !== null) {
      const p = await profileOf(meId);
      me = {
        userId: meId, handle: p.handle, avatarKey: p.avatarKey,
        score: Number(await data.zscore(key, meId)), rank: rank0 + 1,
      };
    }
  }
  return {
    v: SOCIAL_PROTOCOL_VERSION, weekKey, ts: Date.now(), endsAt: weekEndMs(),
    top, me, totalPlayers: await data.zcard(key), prizes: FT_PRIZES,
  };
}

/**
 * Pay a finished week's top 10. The NX lock makes this exactly-once
 * across leader failovers; each credit's idemKey makes a partial-crash
 * retry safe per-user even if the lock were ever lost.
 */
export async function payoutFishmongerWeek(
  weekKey: string,
): Promise<{ paid: boolean; winners: number; totalPaid: number }> {
  const lock = await data.set(`ft:paid:${weekKey}`, '1', 'EX', 60 * 86_400, 'NX');
  if (lock !== 'OK') return { paid: false, winners: 0, totalPaid: 0 };

  const flat = await data.zrevrange(ftKey(weekKey), 0, FT_PRIZES.length - 1, 'WITHSCORES');
  const receipts: Array<{ userId: string; rank: number; score: number; amount: number; balanceAfter: number }> = [];
  let totalPaid = 0;
  for (let i = 0; i * 2 < flat.length; i++) {
    const userId = flat[i * 2];
    const score = Number(flat[i * 2 + 1]);
    const amount = FT_PRIZES[i];
    const balanceAfter = await creditChips(userId, amount, `ft:${weekKey}:${userId}`);
    receipts.push({ userId, rank: i + 1, score, amount, balanceAfter });
    totalPaid += amount;
  }
  mirrorFishmongerPayout(weekKey, receipts, totalPaid).catch(() => {});
  return { paid: true, winners: receipts.length, totalPaid };
}

/** Durable receipts: one FishmongerPayout row + one ChipTransaction per winner. */
async function mirrorFishmongerPayout(
  weekKey: string,
  receipts: Array<{ userId: string; rank: number; score: number; amount: number; balanceAfter: number }>,
  totalPaid: number,
): Promise<void> {
  if (!hasDb()) return;
  const db = prisma();
  await db.fishmongerPayout
    .create({ data: { weekKey, winners: receipts.length, totalPaid: BigInt(totalPaid) } })
    .catch(e => { if ((e as { code?: string })?.code !== 'P2002') throw e; });
  for (const r of receipts) {
    await db.chipTransaction.create({
      data: {
        userId: r.userId,
        amount: BigInt(r.amount),
        balanceAfter: BigInt(r.balanceAfter),
        reason: 'MINIGAME_PAYOUT',
        idemKey: `ft:${weekKey}:${r.userId}`, // same key as the Redis credit — one receipt per prize, ever
        meta: { game: 'fish-toss', weekKey, rank: r.rank, score: r.score },
      },
    }).catch(() => {}); // P2002 replay / FK miss for Redis-only accounts — credit is already safe
  }
}

/**
 * Leader tick (engine, every minute): settle the most recently COMPLETED
 * week — always the one containing now-7d — if it hasn't paid yet.
 */
export async function sweepFishmongerPayout(now = new Date()): Promise<void> {
  const wk = weekKeyOf(new Date(now.getTime() - 7 * 86_400_000));
  if (await data.exists(`ft:paid:${wk}`)) return;
  const r = await payoutFishmongerWeek(wk);
  if (r.paid) console.log(`[fishmonger] week ${wk} settled: ${r.winners} winners, ${r.totalPaid} chips`);
}
