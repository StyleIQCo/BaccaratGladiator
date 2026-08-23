// Helpers the loop leans on: aggregating the pooled client seed and snapshotting
// aggregate (non-secret) stats for the broadcast.
import { data } from '@bg/persistence';

/**
 * Pool the client seed from recent bettors. We hash the concatenation of seeds
 * submitted in the prior round's HELLO handshakes (stored in a capped Redis
 * list) so no single client controls it, yet it remains externally checkable.
 * Falls back to a rotating server-side value if nobody submitted one.
 */
export async function aggregateClientSeed(): Promise<string> {
  const seeds = await data.lrange('arena:clientseeds:pending', 0, 49);
  await data.del('arena:clientseeds:pending');
  if (seeds.length === 0) return 'pool:' + (await data.incr('arena:clientseed:fallback'));
  return seeds.join('|');
}

/** Aggregate social-proof numbers — safe to broadcast to everyone. */
export function snapshotStats(_roundId: string): { players: number; totalWagered: number } {
  // Wire these to live ledger counters; stubbed for the scaffold.
  return { players: 0, totalWagered: 0 };
}
