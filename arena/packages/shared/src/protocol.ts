// THE WIRE CONTRACT — imported by both server and client. Changing a field is a
// breaking protocol change; bump PROTOCOL_VERSION and gate on it in the handshake.
import { Phase } from './phases';

export const PROTOCOL_VERSION = 1;

export enum ServerEvent {
  STATE       = 'state',
  CRASH_TICK  = 'arena:crash',  // lighter high-freq channel for multiplier ticks
  CHAT        = 'chat:msg',
  RAIN_START  = 'rain:start',
  RAIN_RESULT = 'rain:result',
  CASHOUT_OK  = 'crash:locked',
  BALANCE     = 'balance',
  ERROR       = 'error',
}

export enum ClientEvent {
  HELLO      = 'hello',        // { clientSeed, protocolVersion }
  PLACE_BET  = 'bet:place',
  CASH_OUT   = 'crash:cashout',
  CHAT_SEND  = 'chat:send',
  RAIN_CLAIM = 'rain:claim',
}

export type Card = { r: number; s: 0 | 1 | 2 | 3 }; // r:1..13, s:suit
export type Side = 'player' | 'banker' | 'tie';

// ── GAME STATE BROADCAST (ServerEvent.STATE) ──────────────────────────────
export interface GameStatePayload {
  v: number;
  roundId: string;
  phase: Phase;
  /** Server epoch ms when the CURRENT phase ends. Clients render countdowns
   *  from this, drift-corrected — never from a local timer. */
  phaseEndsAt: number;
  serverTimeNow: number; // server clock at send; client derives drift offset

  fair: {
    serverSeedHash: string;   // committed at round start
    clientSeed: string;       // pooled client seed for this round
    nonce: number;
    serverSeed?: string;      // present ONLY in PAYOUT (the reveal)
  };

  hand?: {
    player: Card[]; banker: Card[];
    playerTotal: number; bankerTotal: number;
    outcome: Side; natural: boolean;
  };

  crash: {
    multiplier: number;
    crashed: boolean;
    crashPoint?: number;      // revealed at crash / PAYOUT
  };

  stats: { players: number; totalWagered: number };
}

export interface PlaceBetPayload {
  roundId: string;
  main?: { side: Side; amount: number };
  crash?: { amount: number; autoCashOut?: number };
}

/** No multiplier from the client — the SERVER decides value at receipt time. */
export interface CashOutPayload { roundId: string; }

export interface ChatMessage {
  id: string; userId: string; name: string; text: string; ts: number;
  badge?: 'vip' | 'whale' | 'mod';
}

export interface RainStartPayload {
  rainId: string; totalChips: number; maxClaims: number; closesAt: number; sponsor?: string;
}
export interface RainResultPayload {
  rainId: string; granted: boolean; amount: number; rank?: number;
}
