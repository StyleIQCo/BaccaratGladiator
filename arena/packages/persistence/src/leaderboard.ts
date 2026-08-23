// Live leaderboard hot path — Redis ZSETs, one per (season, tier) bracket.
// The durable Postgres mirror is social-store.ts; this file is the source
// of truth for live ranks and the producer of lb:rank_change events.
import {
  SOCIAL_PROTOCOL_VERSION,
  type LeaderboardEntry,
  type LeaderboardRankChangePayload,
  type LeaderboardScoreTickPayload,
  type LeaderboardSnapshotPayload,
} from '@bg/shared';
import { data, pub, loadScript } from './redis';
import { mirrorScore } from './social-store';

export const LB_BUMP_SHA = await loadScript('leaderboard.lua');

/** Monthly seasons, UTC: '2026-08'. */
export const currentSeasonKey = () => new Date().toISOString().slice(0, 7);

export const lbKey  = (seasonKey: string, tier: number) => `lb:${seasonKey}:t${tier}`;
export const lbRoom = lbKey; // socket.io room name === redis key, by convention
const PROFILES = 'lb:profiles'; // userId → JSON {handle, avatarKey, bestStreak}

/** Redis pub/sub channel every gateway relays to its bracket rooms. */
export const LB_CHANNEL = 'arena:lb';
export interface LbBusEnvelope {
  kind: 'rank_change' | 'score_tick';
  payload: LeaderboardRankChangePayload | LeaderboardScoreTickPayload;
}

interface LbUser { userId: string; handle: string; avatarKey: string; bestStreak?: number }

async function profileOf(userId: string): Promise<{ handle: string; avatarKey: string; bestStreak: number }> {
  const raw = await data.hget(PROFILES, userId);
  return raw ? JSON.parse(raw) : { handle: 'Gladiator', avatarKey: 'gladiator-01', bestStreak: 0 };
}

/**
 * Atomically add chips to a user's bracket score. Returns the rank movement;
 * `displaced` is capped to the 20 rows nearest the mover — clients only render
 * a top-10 window plus their own row, so a deep shift list is wasted bytes.
 */
export async function bumpScore(
  seasonKey: string, tier: number, user: LbUser, delta: number,
): Promise<{ changed: boolean; from: number | null; to: number; score: number; displaced: LeaderboardRankChangePayload['displaced'] }> {
  if (!Number.isFinite(delta) || delta <= 0) throw new Error('delta must be a positive number');
  const prev = await profileOf(user.userId);
  await data.hset(PROFILES, user.userId, JSON.stringify({
    handle: user.handle,
    avatarKey: user.avatarKey,
    bestStreak: Math.max(prev.bestStreak ?? 0, user.bestStreak ?? 0),
  }));

  const key = lbKey(seasonKey, tier);
  const [before0, after0, scoreStr] = await data.evalsha(
    LB_BUMP_SHA, 1, key, user.userId, String(Math.floor(delta)),
  ) as [number, number, string];

  const from = before0 < 0 ? null : before0 + 1; // → 1-based
  const to = after0 + 1;
  const changed = from !== to;

  let displaced: LeaderboardRankChangePayload['displaced'] = [];
  if (changed) {
    // Scores only increase, so the mover rose: rows now at ranks (to+1 .. old
    // position) each slid down exactly one. New entrants shift the tail too —
    // cap the window either way.
    const floor = Math.min(from ?? to + 20, to + 20);
    if (floor > to) {
      const ids = await data.zrevrange(key, to, floor - 1); // 0-based idx to..floor-1 = ranks to+1..floor
      displaced = ids.map((userId, i) => ({ userId, from: to + i, to: to + 1 + i }));
    }
  }
  return { changed, from, to, score: Number(scoreStr), displaced };
}

/** Full bracket snapshot for LB_SNAPSHOT — top N joined with profiles, plus the caller's own row. */
export async function snapshot(
  seasonKey: string, tier: number, meId: string | null, topN = 10,
): Promise<LeaderboardSnapshotPayload> {
  const key = lbKey(seasonKey, tier);
  const flat = await data.zrevrange(key, 0, topN - 1, 'WITHSCORES');
  const top: LeaderboardEntry[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const p = await profileOf(flat[i]);
    top.push({
      userId: flat[i], handle: p.handle, avatarKey: p.avatarKey,
      score: Number(flat[i + 1]), rank: i / 2 + 1, bestStreak: p.bestStreak ?? 0,
    });
  }
  let me: LeaderboardEntry | null = null;
  if (meId) {
    const rank0 = await data.zrevrank(key, meId);
    if (rank0 !== null) {
      const p = await profileOf(meId);
      me = {
        userId: meId, handle: p.handle, avatarKey: p.avatarKey,
        score: Number(await data.zscore(key, meId)), rank: rank0 + 1, bestStreak: p.bestStreak ?? 0,
      };
    }
  }
  return {
    v: SOCIAL_PROTOCOL_VERSION, seasonKey, tier, ts: Date.now(),
    top, me, totalPlayers: await data.zcard(key),
  };
}

/**
 * THE integration point for the engine's hand-settlement loop: one call per
 * winning settlement. Bumps Redis atomically, publishes the right bus event
 * (rank_change vs score_tick), and mirrors to Postgres fire-and-forget —
 * a missing DATABASE_URL degrades to Redis-only, never blocks settlement.
 */
export async function settleLeaderboardScore(
  seasonKey: string, tier: number, user: LbUser, delta: number,
): Promise<void> {
  const r = await bumpScore(seasonKey, tier, user, delta);
  const base = { v: SOCIAL_PROTOCOL_VERSION, seasonKey, tier, ts: Date.now() };
  const envelope: LbBusEnvelope = r.changed
    ? {
        kind: 'rank_change',
        payload: {
          ...base,
          user: { userId: user.userId, handle: user.handle, avatarKey: user.avatarKey },
          score: r.score, delta, from: r.from, to: r.to, displaced: r.displaced,
        },
      }
    : {
        kind: 'score_tick',
        payload: { ...base, userId: user.userId, score: r.score, delta },
      };
  await pub.publish(LB_CHANNEL, JSON.stringify(envelope));
  mirrorScore(seasonKey, tier, user.userId, r.score, user.bestStreak ?? 0).catch(() => {});
}
