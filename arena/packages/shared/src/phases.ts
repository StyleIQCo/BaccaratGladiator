/** Canonical round phases. The engine is the ONLY authority on which is active. */
export enum Phase {
  BETTING = 'BETTING', // accept PLACE_BET; serverSeedHash committed & broadcast
  DEALING = 'DEALING', // cards reveal; crash multiplier ticks; CASH_OUT accepted
  PAYOUT  = 'PAYOUT',  // results + serverSeed REVEALED for verification
}

/** Default durations (ms). Prod overrides from config/round.json. */
export const PHASE_MS: Record<Phase, number> = {
  [Phase.BETTING]: 10_000,
  [Phase.DEALING]: 15_000,
  [Phase.PAYOUT]:  5_000,
};

export const PHASE_ORDER = [Phase.BETTING, Phase.DEALING, Phase.PAYOUT] as const;
export const ROUND_MS = Object.values(PHASE_MS).reduce((a, b) => a + b, 0);
