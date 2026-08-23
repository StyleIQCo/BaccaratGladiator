// ═══════════════════════════════════════════════════════════════════
//  useLiveLeaderboardSocket — the REAL hook. Drop-in replacement for
//  the mocked useLiveLeaderboard: same return shape, so
//  <LiveLeaderboard/> works with either.
//
//  Protocol: emit lb:subscribe → render lb:snapshot → apply
//  lb:rank_change / lb:score deltas. Any inconsistency (a delta whose
//  `from` doesn't match local state) or reconnect triggers a
//  re-subscribe, which heals with a fresh snapshot. Never diff locally.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  SocialClientEvent, SocialServerEvent,
  type LeaderboardRankChangePayload,
  type LeaderboardScoreTickPayload,
  type LeaderboardSnapshotPayload,
} from '@bg/shared';
import type { LeaderboardRow } from './useLiveLeaderboard';

const FLASH_MS = 1400;

export function useLiveLeaderboardSocket(opts: {
  seasonKey: string;
  tier: number;
  meId: string;
  /** ws endpoint origin; defaults to same-origin (CloudFront routes /arena/ws) */
  url?: string;
}) {
  const { seasonKey, tier, meId, url } = opts;
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<LeaderboardRankChangePayload | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const socket = io(url ?? '/', { path: '/arena/ws', transports: ['websocket'] });
    socketRef.current = socket;
    const subscribe = () => socket.emit(SocialClientEvent.LB_SUBSCRIBE, { seasonKey, tier });

    const scheduleFlashClear = () => {
      const t = setTimeout(
        () => setRows(cur => cur.map(r => ({ ...r, flash: null, lastDelta: 0 }))),
        FLASH_MS,
      );
      flashTimers.current.push(t);
    };

    socket.on('connect', () => { setConnected(true); subscribe(); });
    socket.on('disconnect', () => setConnected(false));

    socket.on(SocialServerEvent.LB_SNAPSHOT, (snap: LeaderboardSnapshotPayload) => {
      setTotalPlayers(snap.totalPlayers);
      const entries = [...snap.top];
      if (snap.me && !entries.some(e => e.userId === snap.me!.userId)) entries.push(snap.me);
      setRows(entries.map(e => ({ ...e, flash: null, lastDelta: 0 })));
    });

    socket.on(SocialServerEvent.LEADERBOARD_RANK_CHANGE, (ev: LeaderboardRankChangePayload) => {
      setLastEvent(ev);
      setRows(prev => {
        const known = prev.find(r => r.userId === ev.user.userId);
        // Gap check: our local rank for the mover should equal ev.from.
        // Unknown movers rising INTO our window are fine (they were off-list).
        if (known && ev.from !== null && known.rank !== ev.from) {
          subscribe(); // heal with a fresh snapshot
          return prev;
        }
        const byId = new Map(prev.map(r => [r.userId, { ...r }]));
        const mover: LeaderboardRow = {
          userId: ev.user.userId,
          handle: ev.user.handle,
          avatarKey: ev.user.avatarKey,
          bestStreak: known?.bestStreak ?? 0,
          score: ev.score,
          rank: ev.to,
          flash: ev.from === null || ev.to < ev.from ? 'up' : 'down',
          lastDelta: ev.delta,
        };
        byId.set(mover.userId, mover);
        for (const d of ev.displaced) {
          const row = byId.get(d.userId);
          if (row) { row.rank = d.to; row.flash = 'down'; }
        }
        scheduleFlashClear();
        return [...byId.values()].sort((a, b) => a.rank - b.rank);
      });
    });

    socket.on(SocialServerEvent.LB_SCORE_TICK, (ev: LeaderboardScoreTickPayload) => {
      setRows(prev => prev.map(r => (r.userId === ev.userId ? { ...r, score: ev.score } : r)));
    });

    return () => {
      flashTimers.current.forEach(clearTimeout);
      flashTimers.current = [];
      socket.close();
      socketRef.current = null;
    };
  }, [seasonKey, tier, url]);

  const me = rows.find(r => r.userId === meId) ?? null;
  return { rows, me, lastEvent, totalPlayers, connected };
}
