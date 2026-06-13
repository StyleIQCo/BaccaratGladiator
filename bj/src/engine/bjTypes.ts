/**
 * Gladiator Blackjack — Phase 1: Type Contracts & Constants
 *
 * Pure structural definitions for the blackjack module. No runtime behavior
 * lives here; the engine in `useGladiatorBlackjack.ts` consumes these contracts.
 *
 * This module is sibling-isolated from the Baccarat code in the parent project:
 * nothing here imports from, or mutates, any Baccarat state, namespace, or
 * `localStorage` key. The blackjack persistence namespace is the single
 * constant `STORAGE_KEY` defined below.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Card primitives
// ─────────────────────────────────────────────────────────────────────────────

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export type Rank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K';

/**
 * A single physical card in the shoe / on the table.
 *
 * `value` is the BASE blackjack value the card was minted with: Aces are stored
 * as 11 (the evaluator dynamically demotes them to 1 when total > 21). Face
 * cards are stored as 10. `faceDown` is a presentation flag — the dealer's hole
 * card is dealt face-down and later revealed in place.
 */
export interface Card {
  readonly id: string;
  readonly suit: Suit;
  readonly rank: Rank;
  readonly value: number;
  faceDown: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hand model
// ─────────────────────────────────────────────────────────────────────────────

export type HandStatus =
  | 'active'        // player can still act on this hand
  | 'standing'      // hand is settled at its current total
  | 'busted'        // hand total exceeded 21
  | 'blackjack'     // natural 21 on the initial two cards (no split derivation)
  | 'surrendered'   // late-surrender invoked; bet half forfeited
  | 'doubled'       // doubled-down (also implies standing)
  | 'split-pending' // structural placeholder used between split steps (UI hook)
  | 'resolved-win'
  | 'resolved-loss'
  | 'resolved-push';

/**
 * Evaluation output for a card list. The engine recomputes this on every
 * mutation; nothing here is cached on the hand itself.
 *
 * - `total` is the best non-bust total ≤ 21 when possible, otherwise the
 *   lowest hard total (which will be > 21 → `isBust = true`).
 * - `soft` indicates an Ace is still being counted as 11 in `total`.
 * - `isBlackjack` is a structural condition (exactly 2 cards totaling 21). It
 *   does NOT account for split-derivation: callers must additionally check
 *   `splitGeneration === 0` before paying blackjack odds.
 */
export interface HandValue {
  total: number;
  soft: boolean;
  isBlackjack: boolean;
  isBust: boolean;
}

/**
 * A player hand. Split products are full peers of the original — the engine
 * tracks focus via `isActive` and `splitGeneration` so the UI never needs to
 * special-case "is this the parent hand?".
 */
export interface Hand {
  id: string;
  cards: Card[];
  /** Bet currently in escrow on this hand. After a double, this is 2× initial. */
  bet: number;
  status: HandStatus;
  /** True once the player has doubled this hand. Locks further hits. */
  doubled: boolean;
  /** UI focus marker — exactly one hand is active at a time during player turn. */
  isActive: boolean;
  /** Id of the parent hand this was produced from, if any. */
  splitFrom?: string;
  /** 0 = original hand, 1 = product of one split, 2 = product of two splits. */
  splitGeneration: number;
  /** True if late-surrender was invoked on this hand. */
  surrendered: boolean;
}

export interface DealerHand {
  cards: Card[];
  /**
   * True once the hole card has been flipped. While `revealed` is false the
   * dealer's second card carries `faceDown: true`.
   */
  revealed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shoe model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Immutable snapshot of the shoe. The engine produces a new `ShoeState` on
 * every draw — never mutates in place.
 *
 * `cutCardIndex` is the count at which the cutting card sits. Once
 * `cardsDealt >= cutCardIndex`, `needsShuffle` flips to true and the next
 * `DEAL` action rebuilds the shoe.
 */
export interface ShoeState {
  cards: Card[];
  cutCardIndex: number;
  cardsDealt: number;
  needsShuffle: boolean;
  decks: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game state machine
// ─────────────────────────────────────────────────────────────────────────────

export type GameStateMachine =
  | 'idle'         // awaiting wager
  | 'shuffling'    // shoe being rebuilt (transient; the reducer rebuilds atomically)
  | 'dealing'      // initial deal in flight (transient; flagged for animation hooks)
  | 'insurance'    // dealer shows ace, awaiting insurance decision
  | 'player-turn'  // active hand awaiting player action
  | 'dealer-turn'  // dealer drawing per house rules
  | 'payout'       // payouts computed (transient; flagged for animation hooks)
  | 'round-over';  // results visible, awaiting `NEW_ROUND`

export interface InsuranceState {
  /** True if dealer up-card is an Ace and the insurance prompt is/was active. */
  offered: boolean;
  /** True if the player accepted insurance. */
  taken: boolean;
  /** Insurance side-bet amount (half of base hand bet). */
  bet: number;
  /** True once insurance has been settled (won or lost). */
  resolved: boolean;
  /** Net change to chips from the insurance bet (positive = won, negative = lost). */
  paid: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules & limits
// ─────────────────────────────────────────────────────────────────────────────

export interface RulesConfig {
  decks: number;
  /** True = H17 (dealer hits soft 17). False = S17. Spec requires H17. */
  hitSoft17: boolean;
  blackjackPayoutNumerator: number;
  blackjackPayoutDenominator: number;
  /** Maximum number of SPLITS — total hands cap is `maxSplits + 1`. */
  maxSplits: number;
  doubleAfterSplit: boolean;
  lateSurrender: boolean;
  insurancePayoutNumerator: number;
  insurancePayoutDenominator: number;
  /** Fraction of shoe dealt before the cutting card is reached (0..1). */
  cutPenetration: number;
}

export interface BetLimits {
  min: number;
  max: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Round results & history
// ─────────────────────────────────────────────────────────────────────────────

export interface RoundResultEntry {
  handId: string;
  outcome: 'win' | 'loss' | 'push' | 'blackjack' | 'surrender';
  /** Final bet in escrow on this hand at settle time (post-double if applicable). */
  bet: number;
  /** Net change to chips for this hand (positive = won, negative = lost). */
  payout: number;
  finalTotal: number;
  dealerTotal: number;
}

export interface RoundResult {
  hands: RoundResultEntry[];
  insurance: {
    taken: boolean;
    bet: number;
    /** Net change to chips from insurance (positive on dealer-BJ, negative otherwise). */
    payout: number;
  };
  /** Sum of all hand payouts + insurance payout for this round. */
  totalNet: number;
  dealerFinalTotal: number;
  dealerBlackjack: boolean;
}

export interface HistoryMetrics {
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  handsPushed: number;
  blackjacks: number;
  surrenders: number;
  /** Cumulative insurance winnings across all rounds (only positive values). */
  insurancePaid: number;
  /** Current consecutive net-winning rounds. Resets to 0 on a net loss; pushes preserve. */
  currentNetStreak: number;
  /** Highest `currentNetStreak` ever observed. */
  highestNetStreak: number;
  /** Cumulative net profit across all rounds (negative if down on the session). */
  netProfit: number;
  /** Cumulative chips committed across all rounds (initial + doubles + splits + insurance). */
  totalWagered: number;
  /** Number of times the shoe has been rebuilt. */
  shoesPlayed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

export interface PersistedState {
  chips: number;
  metrics: HistoryMetrics;
  lastBet: number;
  version: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate engine state & API surface
// ─────────────────────────────────────────────────────────────────────────────

export interface GameState {
  phase: GameStateMachine;
  /** Player's available chip stack (excluding any chips currently in escrow on hands). */
  chips: number;
  /** Chips currently staged as the next wager; debited from `chips` on staging. */
  currentBet: number;
  /** Last bet that was actually committed at DEAL time, for repeat-bet UX. */
  lastBet: number;
  hands: Hand[];
  /** Index into `hands` of the hand the player is currently acting on (-1 if none). */
  activeHandIndex: number;
  dealer: DealerHand;
  shoe: ShoeState;
  rules: RulesConfig;
  betLimits: BetLimits;
  insurance: InsuranceState;
  metrics: HistoryMetrics;
  lastRound: RoundResult | null;
  /** Short human-readable status string for the HUD. */
  message: string;
  // ── Action permission flags. Computed by the engine; UI should treat as read-only.
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
}

export interface UseGladiatorBlackjackApi {
  state: GameState;
  /** Set the staged wager to an absolute amount (clamped to chips + currentBet, bet limits). */
  placeBet: (amount: number) => void;
  /** Increment/decrement the staged wager by `delta` (clamped). */
  adjustBet: (delta: number) => void;
  /** Clear the staged wager and return chips. */
  clearBet: () => void;
  /** Commit the staged wager and start a round. */
  deal: () => void;
  hit: () => void;
  stand: () => void;
  double: () => void;
  split: () => void;
  surrender: () => void;
  takeInsurance: () => void;
  declineInsurance: () => void;
  /** Tear down the finished round and return to `idle` so the next bet can be staged. */
  newRound: () => void;
  /** Restore starting chips and zero out all metrics. Use with confirmation. */
  resetBankroll: () => void;
  /** Add chips to the bankroll without resetting metrics (e.g. test-mode top-up). */
  rebuyChips: (amount: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Single source of truth for blackjack `localStorage` namespacing. */
export const STORAGE_KEY = 'gladiator_blackjack_state';

/**
 * Bump when `PersistedState` shape changes. Mismatched versions are discarded
 * on load (the player keeps a fresh bankroll rather than corrupted state).
 */
export const STORAGE_VERSION = 1;

export const DEFAULT_RULES: RulesConfig = {
  decks: 6,
  hitSoft17: true,
  blackjackPayoutNumerator: 3,
  blackjackPayoutDenominator: 2,
  maxSplits: 2,
  doubleAfterSplit: true,
  lateSurrender: true,
  insurancePayoutNumerator: 2,
  insurancePayoutDenominator: 1,
  cutPenetration: 0.75,
};

export const DEFAULT_BET_LIMITS: BetLimits = {
  min: 25,
  max: 5000,
};

export const STARTING_CHIPS = 2500;

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export const RANKS: readonly Rank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];
