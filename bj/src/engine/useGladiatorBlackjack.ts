/**
 * Gladiator Blackjack — Phase 2: Engine Hook
 *
 * Self-contained blackjack engine driven by a strict reducer. Provides a React
 * hook that exposes the full game API (place bet, hit, stand, double, split,
 * surrender, insurance) plus a derived read-only `GameState`.
 *
 * Rule implementation (matches Phase 1 `DEFAULT_RULES`):
 *   - 6-deck shoe, reshuffled when 75% of cards have been dealt
 *   - Dealer hits soft 17, stands on hard 17+
 *   - 3:2 blackjack, 2:1 insurance
 *   - Double on any initial two cards, double after split allowed
 *   - Split up to 3 hands total (i.e. maxSplits = 2)
 *   - Split aces receive one card each and auto-stand; 21 on a split hand is
 *     NOT counted as a blackjack
 *   - Late surrender on initial two cards of the only hand
 *   - American peek: on Ace up the player is offered insurance; on Ace OR
 *     ten-value up the dealer silently peeks for blackjack so that doubles
 *     and splits never lose extra to a dealer natural
 *
 * Persistence: chips, history metrics, and last-committed bet are mirrored to
 * `localStorage` under `STORAGE_KEY` after every state change.
 *
 * This file does not import anything from the Baccarat side of the project,
 * and it does not read or write any `localStorage` key other than the
 * blackjack namespace.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import {
  BetLimits,
  Card,
  DealerHand,
  GameState,
  Hand,
  HandValue,
  HistoryMetrics,
  InsuranceState,
  PersistedState,
  Rank,
  RoundResult,
  RoundResultEntry,
  RulesConfig,
  ShoeState,
  Suit,
  UseGladiatorBlackjackApi,
  DEFAULT_BET_LIMITS,
  DEFAULT_RULES,
  RANKS,
  STARTING_CHIPS,
  STORAGE_KEY,
  STORAGE_VERSION,
  SUITS,
} from './bjTypes';

// ═════════════════════════════════════════════════════════════════════════════
// Pure helpers — card / hand / shoe primitives
// ═════════════════════════════════════════════════════════════════════════════

function rankBaseValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
  return parseInt(rank, 10);
}

function shuffleInPlace<T>(arr: T[]): T[] {
  // Fisher–Yates. The caller passes a fresh array so we can mutate freely.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function buildShoeCards(decks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS as readonly Suit[]) {
      for (const rank of RANKS as readonly Rank[]) {
        cards.push({
          id: `d${d}-${suit[0]}-${rank}-${cards.length}`,
          suit,
          rank,
          value: rankBaseValue(rank),
          faceDown: false,
        });
      }
    }
  }
  return shuffleInPlace(cards);
}

function freshShoe(rules: RulesConfig): ShoeState {
  const cards = buildShoeCards(rules.decks);
  const cutCardIndex = Math.floor(cards.length * rules.cutPenetration);
  return {
    cards,
    cutCardIndex,
    cardsDealt: 0,
    needsShuffle: false,
    decks: rules.decks,
  };
}

interface DrawResult {
  card: Card;
  shoe: ShoeState;
}

function drawCard(shoe: ShoeState, faceDown: boolean, rules: RulesConfig): DrawResult {
  // Defensive: the cut-card logic prevents us from ever bottoming out, but if
  // some malformed external state slipped through we rebuild rather than crash.
  if (shoe.cards.length === 0) {
    const rebuilt = freshShoe({ ...rules, decks: shoe.decks });
    return drawCard(rebuilt, faceDown, rules);
  }
  const next = shoe.cards[0];
  const rest = shoe.cards.slice(1);
  const card: Card = { ...next, faceDown };
  const cardsDealt = shoe.cardsDealt + 1;
  const needsShuffle = shoe.needsShuffle || cardsDealt >= shoe.cutCardIndex;
  return {
    card,
    shoe: {
      ...shoe,
      cards: rest,
      cardsDealt,
      needsShuffle,
    },
  };
}

function evaluateHand(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += c.value;
    if (c.rank === 'A') aces++;
  }
  // Demote aces from 11 to 1 while we're over 21 and still have aces to demote.
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  const soft = aces > 0 && total <= 21;
  const isBlackjack = cards.length === 2 && total === 21;
  const isBust = total > 21;
  return { total, soft, isBlackjack, isBust };
}

function isPair(hand: Hand): boolean {
  return hand.cards.length === 2 && hand.cards[0].value === hand.cards[1].value;
}

function replaceAt<T>(arr: T[], index: number, item: T): T[] {
  const copy = arr.slice();
  copy[index] = item;
  return copy;
}

function clampBet(bet: number, limits: BetLimits, available: number): number {
  if (!Number.isFinite(bet) || bet < 0) return 0;
  const floored = Math.floor(bet);
  return Math.min(Math.max(0, floored), limits.max, available);
}

// ═════════════════════════════════════════════════════════════════════════════
// Pure helpers — dealer play & round settlement
// ═════════════════════════════════════════════════════════════════════════════

interface DealerPlayoutResult {
  dealer: DealerHand;
  shoe: ShoeState;
}

/**
 * Play out the dealer's hand to completion under the configured house rules.
 * Always reveals the hole card. Skips drawing entirely when every player hand
 * is already terminal (busted/surrendered), since dealer wins by default.
 */
function dealerPlayout(
  dealer: DealerHand,
  shoe: ShoeState,
  rules: RulesConfig,
  allPlayerHandsTerminal: boolean,
): DealerPlayoutResult {
  let d: DealerHand = {
    cards: dealer.cards.map(c => ({ ...c, faceDown: false })),
    revealed: true,
  };
  let s = shoe;
  if (allPlayerHandsTerminal) {
    return { dealer: d, shoe: s };
  }
  // Bounded loop — dealer either reaches a standing total, busts, or the shoe
  // exhausts (the drawCard fallback rebuilds rather than throwing). Max
  // theoretical draws is small (under 10 cards from any 2-card start), so we
  // cap defensively at 21 iterations to satisfy static-analysis without
  // affecting valid gameplay.
  for (let guard = 0; guard < 21; guard++) {
    const v = evaluateHand(d.cards);
    if (v.isBust) break;
    if (v.total > 17) break;
    if (v.total === 17 && !(v.soft && rules.hitSoft17)) break;
    const drawn = drawCard(s, false, rules);
    d = { ...d, cards: [...d.cards, drawn.card] };
    s = drawn.shoe;
  }
  return { dealer: d, shoe: s };
}

interface SettlementResult {
  entries: RoundResultEntry[];
  /** Sum of per-hand payouts plus insurance payout (positive = player won net). */
  totalNet: number;
  /** Net change from insurance only (positive on dealer-BJ win, negative on loss). */
  insurancePayout: number;
  /** Chips to credit back to the player (includes returned bet + winnings). */
  chipsCredit: number;
}

/**
 * Settle every player hand against the dealer's final hand and the insurance
 * side-bet. Returns both the per-hand outcome list (for history) and the
 * total chip credit to apply to the player's stack.
 */
function settleRound(
  hands: Hand[],
  dealer: DealerHand,
  insurance: InsuranceState,
  rules: RulesConfig,
): SettlementResult {
  const dealerVal = evaluateHand(dealer.cards);
  const entries: RoundResultEntry[] = [];
  let totalNet = 0;
  let chipsCredit = 0;

  for (const h of hands) {
    const v = evaluateHand(h.cards);
    // A 21 on a split-derived hand is NOT a blackjack — it pays even money.
    const isPlayerBJ = v.isBlackjack && h.splitGeneration === 0;
    let outcome: RoundResultEntry['outcome'];
    let net = 0;
    let credit = 0;

    if (h.surrendered) {
      // Half the bet is forfeited; half is returned.
      outcome = 'surrender';
      credit = Math.floor(h.bet / 2);
      net = credit - h.bet;
    } else if (v.isBust) {
      outcome = 'loss';
      credit = 0;
      net = -h.bet;
    } else if (dealerVal.isBlackjack && !isPlayerBJ) {
      // Dealer natural — every non-BJ hand loses its initial stake. The
      // engine's American-peek protects doubles/splits from forming in this
      // scenario, so `h.bet` here equals the initial bet.
      outcome = 'loss';
      credit = 0;
      net = -h.bet;
    } else if (isPlayerBJ && dealerVal.isBlackjack) {
      outcome = 'push';
      credit = h.bet;
      net = 0;
    } else if (isPlayerBJ) {
      outcome = 'blackjack';
      const win = Math.floor(
        (h.bet * rules.blackjackPayoutNumerator) / rules.blackjackPayoutDenominator,
      );
      credit = h.bet + win;
      net = win;
    } else if (dealerVal.isBust) {
      outcome = 'win';
      credit = h.bet * 2;
      net = h.bet;
    } else if (v.total > dealerVal.total) {
      outcome = 'win';
      credit = h.bet * 2;
      net = h.bet;
    } else if (v.total < dealerVal.total) {
      outcome = 'loss';
      credit = 0;
      net = -h.bet;
    } else {
      outcome = 'push';
      credit = h.bet;
      net = 0;
    }

    entries.push({
      handId: h.id,
      outcome,
      bet: h.bet,
      payout: net,
      finalTotal: v.total,
      dealerTotal: dealerVal.total,
    });
    totalNet += net;
    chipsCredit += credit;
  }

  let insurancePayout = 0;
  if (insurance.taken) {
    if (dealerVal.isBlackjack) {
      const win = Math.floor(
        (insurance.bet * rules.insurancePayoutNumerator) / rules.insurancePayoutDenominator,
      );
      insurancePayout = win;
      chipsCredit += insurance.bet + win;
      totalNet += win;
    } else {
      insurancePayout = -insurance.bet;
      totalNet += -insurance.bet;
    }
  }

  return { entries, totalNet, insurancePayout, chipsCredit };
}

function updateMetrics(
  prev: HistoryMetrics,
  settled: SettlementResult,
): HistoryMetrics {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let blackjacks = 0;
  let surrenders = 0;
  for (const e of settled.entries) {
    if (e.outcome === 'win') {
      wins++;
    } else if (e.outcome === 'blackjack') {
      wins++;
      blackjacks++;
    } else if (e.outcome === 'loss') {
      losses++;
    } else if (e.outcome === 'push') {
      pushes++;
    } else if (e.outcome === 'surrender') {
      losses++;
      surrenders++;
    }
  }
  const insurancePaid = settled.insurancePayout > 0 ? settled.insurancePayout : 0;

  // Streak is computed at ROUND granularity, not per-hand: a single round may
  // have produced multiple split hands but counts as one streak event.
  let currentNetStreak = prev.currentNetStreak;
  if (settled.totalNet > 0) {
    currentNetStreak += 1;
  } else if (settled.totalNet < 0) {
    currentNetStreak = 0;
  }
  // Pushes (totalNet === 0) preserve the streak.
  const highestNetStreak = Math.max(prev.highestNetStreak, currentNetStreak);

  return {
    handsPlayed: prev.handsPlayed + settled.entries.length,
    handsWon: prev.handsWon + wins,
    handsLost: prev.handsLost + losses,
    handsPushed: prev.handsPushed + pushes,
    blackjacks: prev.blackjacks + blackjacks,
    surrenders: prev.surrenders + surrenders,
    insurancePaid: prev.insurancePaid + insurancePaid,
    currentNetStreak,
    highestNetStreak,
    netProfit: prev.netProfit + settled.totalNet,
    // `totalWagered` is incremented at the point each stake is committed
    // (DEAL / DOUBLE / SPLIT / TAKE_INSURANCE), not here, so it is carried
    // forward unchanged.
    totalWagered: prev.totalWagered,
    shoesPlayed: prev.shoesPlayed,
  };
}

function defaultMetrics(): HistoryMetrics {
  return {
    handsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    surrenders: 0,
    insurancePaid: 0,
    currentNetStreak: 0,
    highestNetStreak: 0,
    netProfit: 0,
    totalWagered: 0,
    shoesPlayed: 0,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// State helpers — flag derivation, dealer reveal, turn advancement
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Recompute the action-permission flags from the current state. Always called
 * after any state transition that could affect what the player can do.
 */
function computeFlags(state: GameState): GameState {
  const idx = state.activeHandIndex;
  const hand = idx >= 0 && idx < state.hands.length ? state.hands[idx] : null;
  const inPlay = state.phase === 'player-turn';

  let canHit = false;
  let canStand = false;
  let canDouble = false;
  let canSplit = false;
  let canSurrender = false;

  if (inPlay && hand && hand.status === 'active') {
    canHit = true;
    canStand = true;

    canDouble =
      hand.cards.length === 2 &&
      !hand.doubled &&
      state.chips >= hand.bet &&
      (hand.splitGeneration === 0 || state.rules.doubleAfterSplit);

    canSplit =
      isPair(hand) &&
      state.hands.length < state.rules.maxSplits + 1 &&
      state.chips >= hand.bet;

    canSurrender =
      state.rules.lateSurrender &&
      hand.cards.length === 2 &&
      hand.splitGeneration === 0 &&
      state.hands.length === 1 &&
      !hand.doubled;
  }

  return { ...state, canHit, canStand, canDouble, canSplit, canSurrender };
}

function revealDealer(state: GameState): GameState {
  if (state.dealer.revealed) return state;
  return {
    ...state,
    dealer: {
      cards: state.dealer.cards.map(c => ({ ...c, faceDown: false })),
      revealed: true,
    },
  };
}

function buildOutcomeMessage(settled: SettlementResult): string {
  if (settled.totalNet > 0) return `Victory — net +${settled.totalNet}`;
  if (settled.totalNet < 0) return `Defeat — net ${settled.totalNet}`;
  return 'Push — bets returned.';
}

/**
 * Settle the round and transition into `round-over`. Caller must have already
 * applied any dealer reveal / dealer play; this just computes payouts and
 * commits them.
 */
function finalizeRound(state: GameState, msgOverride: string): GameState {
  const revealed = revealDealer(state);
  const settled = settleRound(
    revealed.hands,
    revealed.dealer,
    revealed.insurance,
    revealed.rules,
  );
  const dealerVal = evaluateHand(revealed.dealer.cards);
  const metrics = updateMetrics(revealed.metrics, settled);

  // Annotate hand statuses with their final outcomes for the UI.
  const hands: Hand[] = revealed.hands.map((h, i) => {
    const e = settled.entries[i];
    let status = h.status;
    if (e.outcome === 'win' || e.outcome === 'blackjack') status = 'resolved-win';
    else if (e.outcome === 'loss') status = 'resolved-loss';
    else if (e.outcome === 'push') status = 'resolved-push';
    // 'surrender' keeps its 'surrendered' status for clarity.
    return { ...h, status, isActive: false };
  });

  const lastRound: RoundResult = {
    hands: settled.entries,
    insurance: {
      taken: revealed.insurance.taken,
      bet: revealed.insurance.bet,
      payout: revealed.insurance.taken ? settled.insurancePayout : 0,
    },
    totalNet: settled.totalNet,
    dealerFinalTotal: dealerVal.total,
    dealerBlackjack: dealerVal.isBlackjack,
  };

  return computeFlags({
    ...revealed,
    chips: revealed.chips + settled.chipsCredit,
    metrics,
    hands,
    activeHandIndex: -1,
    phase: 'round-over',
    lastRound,
    insurance: {
      ...revealed.insurance,
      resolved: true,
      paid: revealed.insurance.taken ? settled.insurancePayout : 0,
    },
    message: msgOverride || buildOutcomeMessage(settled),
  });
}

/**
 * Move focus to the next active hand, or — if none remain — reveal the dealer,
 * play out the dealer's hand (when needed), and finalize the round.
 */
function advanceTurn(state: GameState): GameState {
  const nextIdx = state.hands.findIndex(h => h.status === 'active');
  if (nextIdx >= 0) {
    const hands = state.hands.map((h, i) => ({ ...h, isActive: i === nextIdx }));
    const msg =
      hands.length > 1
        ? `Hand ${nextIdx + 1} of ${hands.length} — gladiator's move.`
        : state.message;
    return computeFlags({
      ...state,
      hands,
      activeHandIndex: nextIdx,
      message: msg,
    });
  }
  // No active hands left. Reveal dealer and play out if anything can still beat
  // the dealer (i.e. at least one player hand is not bust and not surrendered).
  const allTerminal = state.hands.every(
    h => h.status === 'busted' || h.status === 'surrendered',
  );
  let next: GameState = revealDealer({ ...state, phase: 'dealer-turn' });
  if (!allTerminal) {
    const played = dealerPlayout(next.dealer, next.shoe, next.rules, false);
    next = { ...next, dealer: played.dealer, shoe: played.shoe };
  }
  return finalizeRound(next, '');
}

/**
 * Resolve the insurance phase after the player has accepted or declined. Peeks
 * for dealer blackjack; settles immediately if found, otherwise transitions to
 * the player turn (or finalizes if the player has blackjack).
 */
function resolveAfterInsurance(state: GameState): GameState {
  const dealerVal = evaluateHand(state.dealer.cards);
  const playerVal = evaluateHand(state.hands[0].cards);
  if (dealerVal.isBlackjack) {
    const msg = playerVal.isBlackjack
      ? 'Push — both Blackjack.'
      : 'Dealer Blackjack. The arena turns silent.';
    return finalizeRound(revealDealer(state), msg);
  }
  if (playerVal.isBlackjack) {
    return finalizeRound(revealDealer(state), 'Blackjack! Glory is yours.');
  }
  return computeFlags({
    ...state,
    phase: 'player-turn',
    message: 'No dealer Blackjack. Play on.',
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Reducer
// ═════════════════════════════════════════════════════════════════════════════

type Action =
  | { type: 'LOAD_PERSISTED'; persisted: PersistedState }
  | { type: 'PLACE_BET'; amount: number }
  | { type: 'ADJUST_BET'; delta: number }
  | { type: 'CLEAR_BET' }
  | { type: 'DEAL' }
  | { type: 'HIT' }
  | { type: 'STAND' }
  | { type: 'DOUBLE' }
  | { type: 'SPLIT' }
  | { type: 'SURRENDER' }
  | { type: 'TAKE_INSURANCE' }
  | { type: 'DECLINE_INSURANCE' }
  | { type: 'NEW_ROUND' }
  | { type: 'RESET_BANKROLL' }
  | { type: 'REBUY'; amount: number };

function buildInitialState(
  rules: RulesConfig,
  betLimits: BetLimits,
): GameState {
  return computeFlags({
    phase: 'idle',
    chips: STARTING_CHIPS,
    currentBet: 0,
    lastBet: 0,
    hands: [],
    activeHandIndex: -1,
    dealer: { cards: [], revealed: false },
    shoe: freshShoe(rules),
    rules,
    betLimits,
    insurance: { offered: false, taken: false, bet: 0, resolved: false, paid: 0 },
    metrics: defaultMetrics(),
    lastRound: null,
    message: 'Place your wager to enter the arena.',
    canHit: false,
    canStand: false,
    canDouble: false,
    canSplit: false,
    canSurrender: false,
  });
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    // ── Persistence ──────────────────────────────────────────────────────────
    case 'LOAD_PERSISTED': {
      const p = action.persisted;
      const merged: HistoryMetrics = { ...defaultMetrics(), ...p.metrics };
      const chips =
        Number.isFinite(p.chips) && p.chips >= 0 ? Math.floor(p.chips) : STARTING_CHIPS;
      const stagedBet = clampBet(p.lastBet, state.betLimits, chips);
      return computeFlags({
        ...state,
        chips: chips - stagedBet,
        currentBet: stagedBet,
        lastBet: stagedBet,
        metrics: merged,
      });
    }

    // ── Bet staging ──────────────────────────────────────────────────────────
    case 'PLACE_BET': {
      if (state.phase !== 'idle' && state.phase !== 'round-over') return state;
      const desired = Math.max(0, Math.floor(action.amount));
      const totalAvailable = state.chips + state.currentBet;
      const newBet = Math.min(desired, totalAvailable, state.betLimits.max);
      return {
        ...state,
        chips: totalAvailable - newBet,
        currentBet: newBet,
        message: newBet > 0 ? `Wager staged: ${newBet}` : 'Choose your stake.',
      };
    }
    case 'ADJUST_BET': {
      if (state.phase !== 'idle' && state.phase !== 'round-over') return state;
      const target = state.currentBet + action.delta;
      return reducer(state, { type: 'PLACE_BET', amount: target });
    }
    case 'CLEAR_BET': {
      if (state.phase !== 'idle' && state.phase !== 'round-over') return state;
      if (state.currentBet === 0) return state;
      return {
        ...state,
        chips: state.chips + state.currentBet,
        currentBet: 0,
        message: 'Wager cleared.',
      };
    }

    // ── Deal a new round ────────────────────────────────────────────────────
    case 'DEAL': {
      if (state.phase !== 'idle' && state.phase !== 'round-over') return state;
      const bet = state.currentBet;
      if (bet < state.betLimits.min) {
        return {
          ...state,
          message: `Minimum wager is ${state.betLimits.min}.`,
        };
      }

      // Rebuild the shoe if the cutting card has been passed. Done HERE (not
      // mid-round) so cards already in play retain their identity.
      let shoe = state.shoe;
      let shoesPlayed = state.metrics.shoesPlayed;
      if (shoe.needsShuffle || shoe.cards.length < 20) {
        shoe = freshShoe(state.rules);
        shoesPlayed += 1;
      }

      const d1 = drawCard(shoe, false, state.rules);
      shoe = d1.shoe;
      const d2 = drawCard(shoe, false, state.rules);
      shoe = d2.shoe;
      const d3 = drawCard(shoe, false, state.rules);
      shoe = d3.shoe;
      const d4 = drawCard(shoe, true, state.rules);
      shoe = d4.shoe;

      const handId = `h-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const hand: Hand = {
        id: handId,
        cards: [d1.card, d3.card],
        bet,
        status: 'active',
        doubled: false,
        isActive: true,
        splitGeneration: 0,
        surrendered: false,
      };
      const dealer: DealerHand = {
        cards: [d2.card, d4.card],
        revealed: false,
      };

      const playerVal = evaluateHand(hand.cards);
      const dealerFullVal = evaluateHand([d2.card, d4.card]);
      const dealerUp = d2.card;

      const fresh: GameState = {
        ...state,
        phase: 'player-turn',
        currentBet: 0,
        lastBet: bet,
        hands: [hand],
        activeHandIndex: 0,
        dealer,
        shoe,
        insurance: {
          offered: false,
          taken: false,
          bet: 0,
          resolved: false,
          paid: 0,
        },
        metrics: {
          ...state.metrics,
          totalWagered: state.metrics.totalWagered + bet,
          shoesPlayed,
        },
        lastRound: null,
        message: 'Cards dealt. Choose your move.',
      };

      // Dealer ace up — offer insurance BEFORE peeking. The American-peek
      // happens inside `resolveAfterInsurance` once the player decides.
      if (dealerUp.rank === 'A') {
        const insuranceMax = Math.floor(bet / 2);
        return computeFlags({
          ...fresh,
          phase: 'insurance',
          insurance: {
            offered: true,
            taken: false,
            bet: 0,
            resolved: false,
            paid: 0,
          },
          message:
            insuranceMax > 0 && state.chips >= insuranceMax
              ? `Dealer shows an Ace. Insurance? (${insuranceMax})`
              : 'Dealer shows an Ace. (Insufficient chips for insurance.)',
        });
      }

      // Dealer ten-value up — silent peek. If dealer has BJ the round ends now;
      // this prevents doubles/splits from forming against an unrevealed natural.
      if (dealerUp.value === 10 && dealerFullVal.isBlackjack) {
        const msg = playerVal.isBlackjack
          ? 'Push — both Blackjack.'
          : 'Dealer Blackjack. The crowd gasps.';
        return finalizeRound(revealDealer(fresh), msg);
      }

      // Player natural with no dealer threat — instant 3:2.
      if (playerVal.isBlackjack) {
        return finalizeRound(revealDealer(fresh), 'Blackjack! Glory is yours.');
      }

      return computeFlags(fresh);
    }

    // ── Insurance decisions ─────────────────────────────────────────────────
    case 'TAKE_INSURANCE': {
      if (state.phase !== 'insurance') return state;
      if (state.hands.length !== 1) return state;
      const baseBet = state.hands[0].bet;
      const ins = Math.floor(baseBet / 2);
      if (ins <= 0) return reducer(state, { type: 'DECLINE_INSURANCE' });
      if (ins > state.chips) return state;
      return resolveAfterInsurance({
        ...state,
        chips: state.chips - ins,
        insurance: {
          offered: true,
          taken: true,
          bet: ins,
          resolved: false,
          paid: 0,
        },
        metrics: {
          ...state.metrics,
          totalWagered: state.metrics.totalWagered + ins,
        },
      });
    }
    case 'DECLINE_INSURANCE': {
      if (state.phase !== 'insurance') return state;
      return resolveAfterInsurance({
        ...state,
        insurance: {
          offered: true,
          taken: false,
          bet: 0,
          resolved: false,
          paid: 0,
        },
      });
    }

    // ── Player actions ──────────────────────────────────────────────────────
    case 'HIT': {
      if (state.phase !== 'player-turn') return state;
      const idx = state.activeHandIndex;
      const hand = state.hands[idx];
      if (!hand || hand.status !== 'active') return state;

      const drawn = drawCard(state.shoe, false, state.rules);
      const cards = [...hand.cards, drawn.card];
      const ev = evaluateHand(cards);
      const next: Hand = {
        ...hand,
        cards,
        status: ev.isBust ? 'busted' : 'active',
      };

      const intermediate: GameState = {
        ...state,
        shoe: drawn.shoe,
        hands: replaceAt(state.hands, idx, next),
      };

      // Auto-stand on 21 (no value to drawing more) and on bust (cannot act).
      if (ev.isBust || ev.total === 21) {
        const finalized: Hand = {
          ...next,
          status: ev.isBust ? 'busted' : 'standing',
          isActive: false,
        };
        return advanceTurn({
          ...intermediate,
          hands: replaceAt(intermediate.hands, idx, finalized),
        });
      }
      return computeFlags(intermediate);
    }

    case 'STAND': {
      if (state.phase !== 'player-turn') return state;
      const idx = state.activeHandIndex;
      const hand = state.hands[idx];
      if (!hand || hand.status !== 'active') return state;
      const finalized: Hand = { ...hand, status: 'standing', isActive: false };
      return advanceTurn({
        ...state,
        hands: replaceAt(state.hands, idx, finalized),
      });
    }

    case 'DOUBLE': {
      if (state.phase !== 'player-turn') return state;
      const idx = state.activeHandIndex;
      const hand = state.hands[idx];
      if (!hand || hand.status !== 'active') return state;
      if (hand.cards.length !== 2) return state;
      if (hand.doubled) return state;
      if (hand.bet > state.chips) return state;
      if (hand.splitGeneration > 0 && !state.rules.doubleAfterSplit) return state;

      const drawn = drawCard(state.shoe, false, state.rules);
      const cards = [...hand.cards, drawn.card];
      const ev = evaluateHand(cards);
      const finalized: Hand = {
        ...hand,
        cards,
        bet: hand.bet * 2,
        doubled: true,
        status: ev.isBust ? 'busted' : 'standing',
        isActive: false,
      };
      return advanceTurn({
        ...state,
        shoe: drawn.shoe,
        chips: state.chips - hand.bet,
        hands: replaceAt(state.hands, idx, finalized),
        metrics: {
          ...state.metrics,
          totalWagered: state.metrics.totalWagered + hand.bet,
        },
      });
    }

    case 'SPLIT': {
      if (state.phase !== 'player-turn') return state;
      const idx = state.activeHandIndex;
      const hand = state.hands[idx];
      if (!hand || hand.status !== 'active') return state;
      if (!isPair(hand)) return state;
      if (state.hands.length >= state.rules.maxSplits + 1) return state;
      if (hand.bet > state.chips) return state;

      const isAceSplit = hand.cards[0].rank === 'A';
      let shoe = state.shoe;
      const a = drawCard(shoe, false, state.rules);
      shoe = a.shoe;
      const b = drawCard(shoe, false, state.rules);
      shoe = b.shoe;

      const handA: Hand = {
        id: `${hand.id}-a`,
        cards: [hand.cards[0], a.card],
        bet: hand.bet,
        doubled: false,
        // Ace splits get one card and are forced to stand. Otherwise the player
        // gets to act on hand A first.
        status: isAceSplit ? 'standing' : 'active',
        isActive: !isAceSplit,
        splitFrom: hand.id,
        splitGeneration: hand.splitGeneration + 1,
        surrendered: false,
      };
      const handB: Hand = {
        id: `${hand.id}-b`,
        cards: [hand.cards[1], b.card],
        bet: hand.bet,
        doubled: false,
        status: isAceSplit ? 'standing' : 'active',
        isActive: false,
        splitFrom: hand.id,
        splitGeneration: hand.splitGeneration + 1,
        surrendered: false,
      };

      const hands = [
        ...state.hands.slice(0, idx),
        handA,
        handB,
        ...state.hands.slice(idx + 1),
      ];

      const next: GameState = {
        ...state,
        shoe,
        chips: state.chips - hand.bet,
        hands,
        activeHandIndex: idx,
        metrics: {
          ...state.metrics,
          totalWagered: state.metrics.totalWagered + hand.bet,
        },
        message: isAceSplit
          ? 'Aces split — one card to each.'
          : `Split! Playing hand ${idx + 1} of ${hands.length}.`,
      };
      if (isAceSplit) {
        // Both new hands are already 'standing'; advance to next active hand
        // (probably the dealer turn if there's no other un-played hand).
        return advanceTurn(next);
      }
      return computeFlags(next);
    }

    case 'SURRENDER': {
      if (state.phase !== 'player-turn') return state;
      if (!state.rules.lateSurrender) return state;
      const idx = state.activeHandIndex;
      const hand = state.hands[idx];
      if (!hand || hand.status !== 'active') return state;
      if (hand.cards.length !== 2) return state;
      if (hand.splitGeneration !== 0) return state;
      if (state.hands.length !== 1) return state;
      if (hand.doubled) return state;
      const finalized: Hand = {
        ...hand,
        status: 'surrendered',
        surrendered: true,
        isActive: false,
      };
      return advanceTurn({
        ...state,
        hands: [finalized],
        message: 'Surrendered — half the bet returned.',
      });
    }

    // ── Round teardown / bankroll ───────────────────────────────────────────
    case 'NEW_ROUND': {
      if (state.phase !== 'round-over') return state;
      return computeFlags({
        ...state,
        phase: 'idle',
        hands: [],
        activeHandIndex: -1,
        dealer: { cards: [], revealed: false },
        insurance: {
          offered: false,
          taken: false,
          bet: 0,
          resolved: false,
          paid: 0,
        },
        currentBet: 0,
        message: 'Place your wager to enter the arena.',
      });
    }

    case 'RESET_BANKROLL': {
      // Allowed only between rounds — refuses if a hand is in flight.
      if (state.phase !== 'idle' && state.phase !== 'round-over') return state;
      return computeFlags({
        ...state,
        chips: STARTING_CHIPS,
        currentBet: 0,
        lastBet: 0,
        hands: [],
        activeHandIndex: -1,
        dealer: { cards: [], revealed: false },
        insurance: {
          offered: false,
          taken: false,
          bet: 0,
          resolved: false,
          paid: 0,
        },
        phase: 'idle',
        metrics: defaultMetrics(),
        lastRound: null,
        shoe: freshShoe(state.rules),
        message: 'Bankroll restored. Begin anew.',
      });
    }

    case 'REBUY': {
      const amt = Math.max(0, Math.floor(action.amount));
      if (amt === 0) return state;
      return {
        ...state,
        chips: state.chips + amt,
        message: `+${amt} chips added to the war chest.`,
      };
    }

    default:
      return state;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Persistence I/O
// ═════════════════════════════════════════════════════════════════════════════

function safeReadPersisted(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedState> | null;
    if (!parsed) return null;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (typeof parsed.chips !== 'number') return null;
    if (typeof parsed.lastBet !== 'number') return null;
    if (!parsed.metrics || typeof parsed.metrics !== 'object') return null;
    return {
      chips: parsed.chips,
      lastBet: parsed.lastBet,
      metrics: parsed.metrics as HistoryMetrics,
      version: parsed.version,
    };
  } catch {
    return null;
  }
}

function safeWritePersisted(persisted: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage may be full, blocked (private mode), or disabled entirely. The
    // engine continues to function in-memory — we simply skip the write.
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// The React hook
// ═════════════════════════════════════════════════════════════════════════════

export interface UseGladiatorBlackjackOptions {
  rules?: Partial<RulesConfig>;
  betLimits?: Partial<BetLimits>;
}

export function useGladiatorBlackjack(
  options?: UseGladiatorBlackjackOptions,
): UseGladiatorBlackjackApi {
  // Merge user overrides with house defaults. Memoized so the reducer's initial
  // state isn't recomputed on every render.
  const rules: RulesConfig = useMemo(
    () => ({ ...DEFAULT_RULES, ...(options?.rules ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      options?.rules?.decks,
      options?.rules?.hitSoft17,
      options?.rules?.blackjackPayoutNumerator,
      options?.rules?.blackjackPayoutDenominator,
      options?.rules?.maxSplits,
      options?.rules?.doubleAfterSplit,
      options?.rules?.lateSurrender,
      options?.rules?.insurancePayoutNumerator,
      options?.rules?.insurancePayoutDenominator,
      options?.rules?.cutPenetration,
    ],
  );
  const betLimits: BetLimits = useMemo(
    () => ({ ...DEFAULT_BET_LIMITS, ...(options?.betLimits ?? {}) }),
    [options?.betLimits?.min, options?.betLimits?.max],
  );

  const initial = useMemo(
    () => buildInitialState(rules, betLimits),
    [rules, betLimits],
  );
  const [state, dispatch] = useReducer(reducer, initial);

  // Load persisted state exactly once on mount. We guard with a ref so a
  // re-render before the load completes doesn't double-apply.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current) return;
    const persisted = safeReadPersisted();
    loadedRef.current = true;
    if (persisted) {
      dispatch({ type: 'LOAD_PERSISTED', persisted });
    }
    // We deliberately depend on nothing — this is a one-shot bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever long-lived state (chips, metrics, last bet) changes.
  // Mid-round transitions are intentionally not persisted: only the moment a
  // round ends or a bet is committed do the numbers worth keeping change.
  useEffect(() => {
    if (!loadedRef.current) return;
    safeWritePersisted({
      chips: state.chips + state.currentBet, // include staged but uncommitted chips
      metrics: state.metrics,
      lastBet: state.lastBet,
      version: STORAGE_VERSION,
    });
  }, [state.chips, state.currentBet, state.metrics, state.lastBet]);

  const placeBet = useCallback(
    (amount: number) => dispatch({ type: 'PLACE_BET', amount }),
    [],
  );
  const adjustBet = useCallback(
    (delta: number) => dispatch({ type: 'ADJUST_BET', delta }),
    [],
  );
  const clearBet = useCallback(() => dispatch({ type: 'CLEAR_BET' }), []);
  const deal = useCallback(() => dispatch({ type: 'DEAL' }), []);
  const hit = useCallback(() => dispatch({ type: 'HIT' }), []);
  const stand = useCallback(() => dispatch({ type: 'STAND' }), []);
  const doubleAction = useCallback(() => dispatch({ type: 'DOUBLE' }), []);
  const splitAction = useCallback(() => dispatch({ type: 'SPLIT' }), []);
  const surrender = useCallback(() => dispatch({ type: 'SURRENDER' }), []);
  const takeInsurance = useCallback(
    () => dispatch({ type: 'TAKE_INSURANCE' }),
    [],
  );
  const declineInsurance = useCallback(
    () => dispatch({ type: 'DECLINE_INSURANCE' }),
    [],
  );
  const newRound = useCallback(() => dispatch({ type: 'NEW_ROUND' }), []);
  const resetBankroll = useCallback(() => dispatch({ type: 'RESET_BANKROLL' }), []);
  const rebuyChips = useCallback(
    (amount: number) => dispatch({ type: 'REBUY', amount }),
    [],
  );

  return {
    state,
    placeBet,
    adjustBet,
    clearBet,
    deal,
    hit,
    stand,
    double: doubleAction,
    split: splitAction,
    surrender,
    takeInsurance,
    declineInsurance,
    newRound,
    resetBankroll,
    rebuyChips,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Exports for downstream phases (UI layer) — pure helpers reused at render time
// ═════════════════════════════════════════════════════════════════════════════

export {
  evaluateHand,
  rankBaseValue,
  buildShoeCards,
  freshShoe,
  drawCard,
  dealerPlayout,
  settleRound,
  isPair,
};
