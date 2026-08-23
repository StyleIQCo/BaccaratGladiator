// ═══════════════════════════════════════════════════════════════════
//  useLiveLeaderboard — MOCKED live socket for the tier leaderboard.
//
//  Emits state shaped exactly like the real wire contract
//  (LB_SNAPSHOT + LEADERBOARD_RANK_CHANGE from @bg/shared/social), so
//  swapping to the real gateway is: replace the interval with
//  socket.on(SocialServerEvent.LEADERBOARD_RANK_CHANGE, applyDelta).
//  Nothing in the component changes.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import type { LeaderboardRankChangePayload } from './socialTypes';

export interface LeaderboardRow {
  userId: string;
  handle: string;
  avatarKey: string;
  score: number;
  rank: number;
  bestStreak: number;
  /** transient theatrics flag — set on a rank move, auto-cleared ~1.4s later */
  flash: 'up' | 'down' | null;
  /** score gained in the latest event — drives the "+2,450" pop */
  lastDelta: number;
}

const MOCK_HANDLES = [
  'Late Bet Larry', 'NaturalNine Nina', 'Squeeze King', 'Macau Mike',
  'Banker Betty', 'DragonSlayer', 'Third Card Theo', 'High Limit Hana',
  'Chip Stack Charlie', 'Streaky Stella', 'Pit Boss Pam', 'Tie Guy Ty',
  'Fortune Frankie', 'Shoe Whisperer',
];

const FLASH_MS = 1400;

function seedRows(meId: string, meHandle: string): LeaderboardRow[] {
  const rows: LeaderboardRow[] = MOCK_HANDLES.map((handle, i) => ({
    userId: `u${i}`,
    handle,
    avatarKey: `gladiator-${(i % 8) + 1}`,
    score: 92_000 - i * 5_800 + Math.floor(Math.random() * 2_400),
    rank: 0,
    bestStreak: 3 + ((i * 7) % 9),
    flash: null,
    lastDelta: 0,
  }));
  rows.push({
    userId: meId, handle: meHandle, avatarKey: 'gladiator-you',
    score: 31_500, rank: 0, bestStreak: 5, flash: null, lastDelta: 0,
  });
  return rank(rows);
}

function rank(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export function useLiveLeaderboard(opts: {
  seasonKey: string;
  tier: number;
  meId: string;
  meHandle: string;
}) {
  const { seasonKey, tier, meId, meHandle } = opts;
  const [rows, setRows] = useState<LeaderboardRow[]>(() => seedRows(meId, meHandle));
  const [lastEvent, setLastEvent] = useState<LeaderboardRankChangePayload | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let alive = true;

    function tick() {
      if (!alive) return;
      setRows(prev => {
        // Weighted pick: the current user surges ~1 in 5 ticks so rank-up
        // theatrics on "your" row are demo-visible.
        const pickMe = Math.random() < 0.2;
        const pool = pickMe ? prev.filter(r => r.userId === meId) : prev;
        const mover = pool[Math.floor(Math.random() * pool.length)];
        const delta = 400 + Math.floor(Math.random() * (pickMe ? 6_500 : 3_800));

        const bumped = prev.map(r =>
          r.userId === mover.userId
            ? { ...r, score: r.score + delta, lastDelta: delta }
            : r,
        );
        const reRanked = rank(bumped);

        // Diff old→new ranks to build flash flags + the wire-shaped event
        const oldRank = new Map<string, number>(prev.map(r => [r.userId, r.rank]));
        const displaced: LeaderboardRankChangePayload['displaced'] = [];
        const withFlash = reRanked.map(r => {
          const was = oldRank.get(r.userId) ?? null;
          if (was !== null && was !== r.rank) {
            if (r.userId !== mover.userId) displaced.push({ userId: r.userId, from: was, to: r.rank });
            return { ...r, flash: (r.rank < was ? 'up' : 'down') as 'up' | 'down' };
          }
          return { ...r, flash: null };
        });

        const moverNew = withFlash.find(r => r.userId === mover.userId)!;
        const moverOld = oldRank.get(mover.userId) ?? null;
        if (moverOld !== moverNew.rank) {
          setLastEvent({
            v: 1, seasonKey, tier, ts: Date.now(),
            user: { userId: mover.userId, handle: mover.handle, avatarKey: mover.avatarKey },
            score: moverNew.score, delta,
            from: moverOld, to: moverNew.rank,
            displaced,
          });
        }

        // Auto-clear the transient flash so re-renders settle
        const t = setTimeout(() => {
          if (alive) setRows(cur => cur.map(r => ({ ...r, flash: null, lastDelta: 0 })));
        }, FLASH_MS);
        timers.current.push(t);

        return withFlash;
      });

      const t = setTimeout(tick, 1_800 + Math.random() * 2_200);
      timers.current.push(t);
    }

    const t0 = setTimeout(tick, 1_200);
    timers.current.push(t0);
    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [seasonKey, tier, meId, meHandle]);

  const me = rows.find(r => r.userId === meId) ?? null;
  return { rows, me, lastEvent, totalPlayers: 1_204, connected: true };
}
