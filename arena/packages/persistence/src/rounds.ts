// Archive each concluded round so the public "Verify this hand" page (and B2B
// partners / auditors) can re-derive and check fairness long after the round.
import { data } from './redis';
import type { DealtHand } from '@bg/shared';

export async function archiveRound(ctx: {
  roundId: string; nonce: number;
  serverSeed: string; serverSeedHash: string; clientSeed: string;
  hand: DealtHand; crashPoint: number;
}): Promise<void> {
  // Store the full reveal — serverSeed included, since the round is over.
  await data.set(`round:${ctx.roundId}`, JSON.stringify(ctx)); // persist; no TTL
  await data.lpush('rounds:recent', ctx.roundId);
  await data.ltrim('rounds:recent', 0, 999);
}
