import type { Socket } from 'socket.io';
import { ClientEvent, type ChatMessage } from '@bg/shared';
import { pub } from '@bg/persistence';
import { tryConsume } from '../ratelimit';

/** Client → validated → PUBLISH arena:chat → all gateways relay to their sockets. */
export function registerChat(socket: Socket) {
  socket.on(ClientEvent.CHAT_SEND, async ({ text }: { text: string }) => {
    if (!tryConsume(`chat:${socket.id}`, 3, 2000)) return; // 3 msgs / 2s
    const clean = String(text ?? '').slice(0, 240).trim();
    if (!clean) return;
    const msg: ChatMessage = {
      id: `${socket.id}:${socket.data.seq = (socket.data.seq ?? 0) + 1}`,
      userId: socket.data.userId, name: socket.data.name ?? 'Gladiator',
      text: clean, ts: Date.now(),
    };
    await pub.publish('arena:chat', JSON.stringify(msg));
  });
}
