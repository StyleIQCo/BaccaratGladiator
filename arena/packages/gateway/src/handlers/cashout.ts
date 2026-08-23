import type { Socket } from 'socket.io';
import { ClientEvent, ServerEvent, type CashOutPayload } from '@bg/shared';
import { getLiveCrash, lockCashOut, settleLeaderboardScore, currentSeasonKey } from '@bg/persistence';
import { tryConsume } from '../ratelimit';

/** High-frequency CASH_OUT. NEVER trusts a client-sent multiplier. */
export function registerCashOut(socket: Socket) {
  socket.on(ClientEvent.CASH_OUT, async (p: CashOutPayload) => {
    // 1. Rate-limit panic taps.
    if (!tryConsume(socket.id)) return;

    // 2. The SERVER's latest authoritative crash tick decides the value.
    const crash = await getLiveCrash(p.roundId);
    if (!crash || crash.crashed) {
      return socket.emit(ServerEvent.ERROR, { code: 'TOO_LATE', roundId: p.roundId });
    }

    // 3. Atomic, idempotent lock: first cash-out for (user, round) wins.
    const locked = await lockCashOut(socket.data.userId, p.roundId, crash.multiplier);
    if (!locked) return; // duplicate tap or no crash bet

    socket.emit(ServerEvent.BALANCE, { balance: locked.balance });
    socket.emit(ServerEvent.CASHOUT_OK, {
      roundId: p.roundId, multiplier: locked.multiplier, won: locked.amount,
    });

    // 4. Net crash winnings feed the tier leaderboard (never blocks the payout).
    const net = locked.amount - locked.stake;
    if (net > 0) {
      settleLeaderboardScore(
        currentSeasonKey(),
        socket.data.tier ?? 1,
        {
          userId: socket.data.userId,
          handle: socket.data.name ?? 'Gladiator',
          avatarKey: socket.data.avatarKey ?? 'gladiator-01',
        },
        net,
      ).catch(() => {});
    }
  });
}
