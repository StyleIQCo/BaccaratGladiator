import type { Socket } from 'socket.io';
import {
  SocialClientEvent, SocialServerEvent,
  type LeaderboardSubscribePayload,
} from '@bg/shared';
import { snapshot, lbRoom } from '@bg/persistence';
import { tryConsume } from '../ratelimit';

const SEASON_RE = /^\d{4}-\d{2}$/;

async function leaveBracketRooms(socket: Socket) {
  for (const room of socket.rooms) {
    if (room.startsWith('lb:')) await socket.leave(room);
  }
}

/**
 * lb:subscribe → join exactly one bracket room + reply with a snapshot.
 * All rank-change traffic then arrives via the room (see server.ts's
 * arena:lb relay). Re-subscribing is the client's gap-heal: cheap,
 * idempotent, always answers with fresh authoritative state.
 */
export function registerLeaderboard(socket: Socket) {
  socket.on(SocialClientEvent.LB_SUBSCRIBE, async (p: LeaderboardSubscribePayload) => {
    if (!tryConsume(`lb:${socket.id}`, 5, 10_000)) return; // 5 (re)subs / 10s
    const tier = Number(p?.tier);
    const seasonKey = String(p?.seasonKey ?? '');
    if (!Number.isInteger(tier) || tier < 1 || tier > 10 || !SEASON_RE.test(seasonKey)) return;

    await leaveBracketRooms(socket); // one bracket per socket
    await socket.join(lbRoom(seasonKey, tier));
    socket.emit(
      SocialServerEvent.LB_SNAPSHOT,
      await snapshot(seasonKey, tier, socket.data.userId ?? null),
    );
  });

  socket.on(SocialClientEvent.LB_UNSUBSCRIBE, () => leaveBracketRooms(socket));
}
