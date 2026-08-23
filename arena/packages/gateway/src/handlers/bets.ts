import type { Socket } from 'socket.io';
import { ClientEvent, ServerEvent, type PlaceBetPayload } from '@bg/shared';
import { data, debitChips } from '@bg/persistence';

const SIDES = new Set(['player', 'banker', 'tie']);
const MAX_BET = 100_000;

const validAmount = (n: unknown): number | null => {
  const amt = Math.floor(Number(n));
  return Number.isFinite(amt) && amt >= 1 && amt <= MAX_BET ? amt : null;
};

/** Accept bets ONLY during BETTING for the current round. The gateway tracks the
 *  live phase/roundId from the bus (see server.ts → currentRound).
 *  Stakes are debited HERE, atomically and idempotently — settleRound then only
 *  ever credits. One bet per market per round: first placement is final. */
export function registerBets(socket: Socket, getRound: () => { roundId: string; betting: boolean }) {
  socket.on(ClientEvent.PLACE_BET, async (p: PlaceBetPayload) => {
    const r = getRound();
    if (!r.betting || p.roundId !== r.roundId) return; // stale / closed — reject silently
    const u = socket.data.userId;

    if (p.main) {
      const amount = validAmount(p.main.amount);
      if (amount === null || !SIDES.has(p.main.side)) return;
      // Snapshot identity into the bet so settlement + leaderboard need no lookups.
      const stored = JSON.stringify({
        side: p.main.side, amount,
        handle: socket.data.name ?? 'Gladiator',
        avatarKey: socket.data.avatarKey ?? 'gladiator-01',
        tier: socket.data.tier ?? 1,
      });
      const placed = await data.hsetnx(`bets:${r.roundId}:main`, u, stored);
      if (!placed) return; // one main bet per round — first placement is final
      await data.expire(`bets:${r.roundId}:main`, 3600);
      const deb = await debitChips(u, amount, `mainbet:${r.roundId}:${u}`);
      if (!deb.ok) {
        await data.hdel(`bets:${r.roundId}:main`, u);
        return socket.emit(ServerEvent.ERROR, { code: 'INSUFFICIENT_FUNDS', roundId: r.roundId });
      }
      socket.emit(ServerEvent.BALANCE, { balance: deb.balance });
    }

    if (p.crash) {
      const amount = validAmount(p.crash.amount);
      if (amount === null) return;
      const placed = await data.set(`crashbet:${r.roundId}:${u}`, String(amount), 'EX', 120, 'NX');
      if (placed !== 'OK') return; // one crash bet per round
      const deb = await debitChips(u, amount, `crashbet:${r.roundId}:${u}`);
      if (!deb.ok) {
        await data.del(`crashbet:${r.roundId}:${u}`);
        return socket.emit(ServerEvent.ERROR, { code: 'INSUFFICIENT_FUNDS', roundId: r.roundId });
      }
      socket.emit(ServerEvent.BALANCE, { balance: deb.balance });
    }
  });
}
