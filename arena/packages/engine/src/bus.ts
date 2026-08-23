// Engine → gateways fan-out. The engine NEVER touches sockets; it only publishes
// to Redis channels. Gateways SUBSCRIBE and relay. This keeps the single
// authority cheap and the fan-out horizontally scalable.
import { pub } from '@bg/persistence';
import type { GameStatePayload } from '@bg/shared';

export type BusChannel = 'arena:state' | 'arena:crash' | 'arena:chat' | 'arena:rain';

export function publish(channel: BusChannel, payload: GameStatePayload | object): void {
  // Fire-and-forget; Redis pub/sub is at-most-once, which is correct here —
  // every state blob is self-contained, so a dropped packet self-heals on the
  // next phase/tick broadcast.
  void pub.publish(channel, JSON.stringify(payload));
}
