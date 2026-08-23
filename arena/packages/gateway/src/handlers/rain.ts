import type { Socket } from 'socket.io';
import { ClientEvent, ServerEvent, type RainResultPayload } from '@bg/shared';
import { data, RAIN_CLAIM_SHA, creditChips } from '@bg/persistence';

/** First-N rain claim. The atomicity lives entirely in the Lua script. */
export function registerRain(socket: Socket) {
  socket.on(ClientEvent.RAIN_CLAIM, async ({ rainId, maxClaims, perUser }) => {
    const [granted, rank, amount] = (await data.evalsha(
      RAIN_CLAIM_SHA, 1, `rain:${rainId}:claims`,
      socket.data.userId, String(maxClaims), String(perUser),
    )) as [number, number, number];

    if (granted) await creditChips(socket.data.userId, amount, `rain:${rainId}`);

    socket.emit(ServerEvent.RAIN_RESULT, {
      rainId, granted: granted === 1, amount, rank: rank || undefined,
    } satisfies RainResultPayload);
  });
}
