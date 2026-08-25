import type { Socket } from 'socket.io';
import { SocialClientEvent, type LoreSeenPayload } from '@bg/shared';
import { markLoreSeen } from '@bg/persistence';

/** Acks the unlock cinematic so it never replays. Exactly-once lives
 *  server-side (guarded flip in markLoreSeen); identity is the socket's
 *  user, so a forged unlockId belonging to someone else flips nothing. */
export function registerLore(socket: Socket) {
  socket.on(SocialClientEvent.LORE_SEEN, (p: LoreSeenPayload) => {
    const unlockId = typeof p?.unlockId === 'string' ? p.unlockId : '';
    if (!unlockId || unlockId.length > 64) return;
    void markLoreSeen(unlockId, socket.data.userId).catch(() => {});
  });
}
