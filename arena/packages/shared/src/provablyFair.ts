// Provably Fair Baccarat. Pure functions, identical output in Node and browser.
// Commit/reveal: server broadcasts sha256(serverSeed) BEFORE bets, reveals
// serverSeed at PAYOUT; anyone re-derives the shoe and re-deals to verify.
import { createHash, createHmac } from 'crypto';
import type { Card } from './protocol';

const SUITS = 4, RANKS = 13, DECKS = 8;

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function freshShoe(): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < DECKS; d++)
    for (let s = 0; s < SUITS; s++)
      for (let r = 1; r <= RANKS; r++) shoe.push({ r, s: s as 0 | 1 | 2 | 3 });
  return shoe;
}

/** Chained HMAC byte stream — never runs short for a 416-card shuffle. */
function* hmacByteStream(serverSeed: string, clientSeed: string, nonce: number): Generator<number> {
  let round = 0;
  while (true) {
    const digest = createHmac('sha256', serverSeed)
      .update(`${clientSeed}:${nonce}:${round}`).digest();
    for (const byte of digest) yield byte;
    round++;
  }
}

/** Unbiased int in [0,max) via rejection sampling — `byte % max` would skew. */
function nextInt(stream: Generator<number>, max: number): number {
  const bytesNeeded = Math.ceil(Math.log2(max) / 8) || 1;
  const limit = Math.pow(256, bytesNeeded);
  const ceiling = limit - (limit % max);
  while (true) {
    let acc = 0;
    for (let i = 0; i < bytesNeeded; i++) acc = acc * 256 + stream.next().value;
    if (acc < ceiling) return acc % max;
  }
}

/** Provably-fair Fisher–Yates. Same inputs → same shoe, forever. */
export function generateShoe(serverSeed: string, clientSeed: string, nonce: number): Card[] {
  const shoe = freshShoe();
  const stream = hmacByteStream(serverSeed, clientSeed, nonce);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = nextInt(stream, i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

const cardValue = (c: Card) => (c.r >= 10 ? 0 : c.r);     // A=1, 10/J/Q/K=0
const handTotal = (cs: Card[]) => cs.reduce((s, c) => s + cardValue(c), 0) % 10;

export interface DealtHand {
  player: Card[]; banker: Card[];
  playerTotal: number; bankerTotal: number;
  outcome: 'player' | 'banker' | 'tie'; natural: boolean;
}

/** Standard baccarat third-card rules applied to the shuffled shoe. */
export function dealBaccarat(shoe: Card[]): DealtHand {
  let i = 0;
  const player = [shoe[i++], shoe[i++]];
  const banker = [shoe[i++], shoe[i++]];
  let pt = handTotal(player), bt = handTotal(banker);
  const natural = pt >= 8 || bt >= 8;

  if (!natural) {
    let playerThird: Card | undefined;
    if (pt <= 5) { playerThird = shoe[i++]; player.push(playerThird); pt = handTotal(player); }
    const draw = (cond: boolean) => { if (cond) banker.push(shoe[i++]); };
    if (playerThird === undefined) {
      draw(bt <= 5);
    } else {
      const p3 = cardValue(playerThird);
      if (bt <= 2) draw(true);
      else if (bt === 3) draw(p3 !== 8);
      else if (bt === 4) draw(p3 >= 2 && p3 <= 7);
      else if (bt === 5) draw(p3 >= 4 && p3 <= 7);
      else if (bt === 6) draw(p3 === 6 || p3 === 7);
    }
    bt = handTotal(banker);
  }
  const outcome = pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
  return { player, banker, playerTotal: pt, bankerTotal: bt, outcome, natural };
}

export interface VerifyInput {
  serverSeed: string; serverSeedHash: string;
  clientSeed: string; nonce: number; expectedHand: DealtHand;
}

/** What the frontend / B2B partner calls to prove the round was fair. */
export function verifyRound(input: VerifyInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (sha256Hex(input.serverSeed) !== input.serverSeedHash)
    reasons.push('serverSeed does not match committed hash');
  const replay = dealBaccarat(generateShoe(input.serverSeed, input.clientSeed, input.nonce));
  if (JSON.stringify(replay) !== JSON.stringify(input.expectedHand))
    reasons.push('re-dealt hand differs from reported result');
  return { ok: reasons.length === 0, reasons };
}

/** Crash point derived from the SAME fair hand — auditable, not separately tunable. */
export function crashPointFromHand(hand: DealtHand, base = 1.0): number {
  const cards = hand.player.length + hand.banker.length;
  if (hand.natural) return +(base + 0.18).toFixed(2);
  const ceiling = ({ 4: 1.5, 5: 4.0, 6: 12.0 } as Record<number, number>)[cards] ?? 2.0;
  const jitter = ((hand.playerTotal * 7 + hand.bankerTotal * 3) % 100) / 100;
  return +(base + jitter * (ceiling - base) + (ceiling - base) * 0.4).toFixed(2);
}
