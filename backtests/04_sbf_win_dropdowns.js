'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Second Bank Frank EZ Baccarat Backtest
// Comparing three win drop-down factors: 1/4, 1/3, 1/2
// 1,000 simulations × 10,000 hands each
// ─────────────────────────────────────────────────────────────────────────────

const NUM_SIMS        = 1000;
const HANDS_PER_SIM   = 10000;
const STARTING_BK     = 10000;
const STARTING_BET    = 100;
const KELLY_CAP_FRAC  = 0.05;   // max bet = 5% of current bankroll
const MIN_BET         = 1;
const LOSS_MULTIPLIER = 1.5;    // half-martingale on loss
const RESHUFFLE_CARDS = 26;     // reshuffle when < 26 cards remain
const NUM_DECKS       = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Card / Shoe helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildShoe() {
  // Values 0-9 (tens/face = 0), 4 suits × 13 ranks × 8 decks
  const shoe = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        shoe.push(Math.min(rank, 10) % 10); // A=1,2-9=face,10/J/Q/K=0
      }
    }
  }
  return shoe;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function handValue(cards) {
  return cards.reduce((s, c) => (s + c) % 10, 0);
}

// Full EZ Baccarat draw rules (no commission; Dragon 7 = push for banker bets)
// Returns { result: 'P'|'B'|'T', bankerTotal, playerTotal, isDragon7 }
function playHand(shoe, idx) {
  const p = [shoe[idx], shoe[idx + 2]];
  const b = [shoe[idx + 1], shoe[idx + 3]];
  let next = idx + 4;

  const pv0 = handValue(p);
  const bv0 = handValue(b);

  // Natural check
  if (pv0 >= 8 || bv0 >= 8) {
    const pFinal = handValue(p);
    const bFinal = handValue(b);
    const isDragon7 = (bFinal === 7 && b.length === 3); // can't be natural+dragon7
    if (pFinal > bFinal) return { result: 'P', bankerTotal: bFinal, playerTotal: pFinal, isDragon7: false, cardsUsed: 4 };
    if (bFinal > pFinal) return { result: 'B', bankerTotal: bFinal, playerTotal: pFinal, isDragon7: false, cardsUsed: 4 };
    return { result: 'T', bankerTotal: bFinal, playerTotal: pFinal, isDragon7: false, cardsUsed: 4 };
  }

  // Player draw rule
  let pDraw = false;
  let pThird = null;
  if (pv0 <= 5) {
    pDraw = true;
    pThird = shoe[next++];
    p.push(pThird);
  }

  const pFinal = handValue(p);

  // Banker draw rule
  let bDraw = false;
  if (!pDraw) {
    // Player stood
    if (bv0 <= 5) { bDraw = true; }
  } else {
    // Player drew — banker draws based on pThird
    const pt = pThird;
    if (bv0 <= 2) { bDraw = true; }
    else if (bv0 === 3 && pt !== 8) { bDraw = true; }
    else if (bv0 === 4 && pt >= 2 && pt <= 7) { bDraw = true; }
    else if (bv0 === 5 && pt >= 4 && pt <= 7) { bDraw = true; }
    else if (bv0 === 6 && pt >= 6 && pt <= 7) { bDraw = true; }
  }

  if (bDraw) {
    b.push(shoe[next++]);
  }

  const bFinal = handValue(b);
  const cardsUsed = next - idx;

  // Dragon 7: banker wins with 3-card 7
  const isDragon7 = (bFinal === 7 && b.length === 3);

  if (pFinal > bFinal) return { result: 'P', bankerTotal: bFinal, playerTotal: pFinal, isDragon7: false, cardsUsed };
  if (bFinal > pFinal) return { result: 'B', bankerTotal: bFinal, playerTotal: pFinal, isDragon7, cardsUsed };
  return { result: 'T', bankerTotal: bFinal, playerTotal: pFinal, isDragon7: false, cardsUsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single simulation
// ─────────────────────────────────────────────────────────────────────────────

function runSim(winDropFraction) {
  let shoe = buildShoe();
  shuffle(shoe);
  let shoeIdx = 0;

  let bankroll = STARTING_BK;
  let bet = STARTING_BET;

  // SBF state
  let consecutivePlayerWins = 0;
  let awaitingBankerConfirm = false;
  let sbfActive = false;   // next hand is an SBF bet

  // Tracking
  let totalHands = 0;
  let sbfHands = 0;
  let sbfWins = 0;
  let sbfLosses = 0;
  let totalWagered = 0;
  let totalNetPnl = 0;

  // Drawdown tracking
  let peakBankroll = STARTING_BK;
  let maxDrawdown = 0;

  // Recovery tracking
  let recoverySamples = []; // number of SBF hands to recover after each loss
  let inRecovery = false;
  let recoveryStartBankroll = 0;
  let recoveryHandCount = 0;

  // Per-hand bankroll for best/worst
  const finalBankroll_ref = { val: STARTING_BK };

  for (let h = 0; h < HANDS_PER_SIM; h++) {
    // Reshuffle if needed
    if (shoe.length - shoeIdx < RESHUFFLE_CARDS + 6) {
      shoe = buildShoe();
      shuffle(shoe);
      shoeIdx = 0;
      // Reset streak counts on reshuffle
      consecutivePlayerWins = 0;
      awaitingBankerConfirm = false;
      sbfActive = false;
    }

    // Play the hand
    const handResult = playHand(shoe, shoeIdx);
    shoeIdx += handResult.cardsUsed;
    totalHands++;

    const result = handResult.result;

    // ── Update SBF state machine ──────────────────────────────────────────
    if (sbfActive) {
      // We are placing an SBF bet this hand
      sbfActive = false;
      sbfHands++;

      const cappedBet = Math.min(bet, bankroll * KELLY_CAP_FRAC);
      const actualBet = Math.max(MIN_BET, Math.round(cappedBet));

      totalWagered += actualBet;

      if (result === 'T') {
        // Tie — push on SBF hand (bet unchanged, no streak change)
        sbfActive = true; // re-bet same hand
        // Don't count this as a resolution
        sbfHands--; // undo the increment
        // Streak state unchanged for ties in SBF context
        continue;
      }

      let pnl = 0;
      if (result === 'B') {
        // Banker win — EZ: no commission UNLESS Dragon 7 (push)
        if (handResult.isDragon7) {
          pnl = 0; // Dragon 7 push
          sbfActive = true; // re-bet
          sbfHands--;
          continue;
        } else {
          pnl = actualBet; // full even money, no commission
          sbfWins++;
          totalNetPnl += pnl;
          bankroll += pnl;

          // Win: drop bet by winDropFraction
          bet = Math.max(MIN_BET, bet * winDropFraction);

          // Recovery check
          if (inRecovery) {
            recoveryHandCount++;
            if (bankroll >= recoveryStartBankroll) {
              recoverySamples.push(recoveryHandCount);
              inRecovery = false;
            }
          }
        }
      } else {
        // Player win — we lose our banker bet
        pnl = -actualBet;
        sbfLosses++;
        totalNetPnl += pnl;
        bankroll += pnl;

        // Loss: multiply by 1.5
        bet = Math.max(MIN_BET, bet * LOSS_MULTIPLIER);

        // Start recovery tracking
        if (!inRecovery) {
          inRecovery = true;
          recoveryStartBankroll = bankroll - pnl; // bankroll before this loss
          recoveryHandCount = 0;
        }
        recoveryHandCount++;
      }

      // Track drawdown
      if (bankroll > peakBankroll) peakBankroll = bankroll;
      const dd = peakBankroll - bankroll;
      if (dd > maxDrawdown) maxDrawdown = dd;

      // Bust check
      if (bankroll <= 0) {
        bankroll = 0;
        break;
      }

      // After SBF hand resolves (win or loss), update streak state for next hand
      // The result of this hand factors into next streak
      if (result === 'P') {
        consecutivePlayerWins = 1; // this hand was a Player win
        awaitingBankerConfirm = false;
      } else if (result === 'B') {
        consecutivePlayerWins = 0;
        awaitingBankerConfirm = false;
      }

    } else {
      // Not an SBF hand — update streak tracking
      if (result === 'T') {
        // Ties skipped for streak counting
        continue;
      }

      if (awaitingBankerConfirm) {
        if (result === 'B') {
          // Confirmation! Next hand is SBF bet
          sbfActive = true;
          awaitingBankerConfirm = false;
          consecutivePlayerWins = 0;
        } else {
          // Another Player win after the streak — reset
          consecutivePlayerWins = 1;
          awaitingBankerConfirm = false;
        }
      } else {
        if (result === 'P') {
          consecutivePlayerWins++;
          if (consecutivePlayerWins >= 3) {
            awaitingBankerConfirm = true;
          }
        } else {
          // Banker win — reset streak
          consecutivePlayerWins = 0;
        }
      }
    }
  }

  finalBankroll_ref.val = bankroll;

  return {
    finalBankroll: bankroll,
    sbfHands,
    sbfWins,
    sbfLosses,
    totalWagered,
    totalNetPnl,
    maxDrawdown,
    recoverySamples,
    avgBet: sbfHands > 0 ? totalWagered / sbfHands : 0,
    evPerHand: sbfHands > 0 ? totalNetPnl / sbfHands : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run all variants
// ─────────────────────────────────────────────────────────────────────────────

const VARIANTS = [
  { label: 'Variant A (drop to 1/4)', fraction: 1/4 },
  { label: 'Variant B (drop to 1/3)', fraction: 1/3 },
  { label: 'Variant C (drop to 1/2)', fraction: 1/2 },
];

console.log('='.repeat(72));
console.log('  SECOND BANK FRANK — EZ BACCARAT — WIN DROP-DOWN COMPARISON');
console.log(`  ${NUM_SIMS} simulations × ${HANDS_PER_SIM.toLocaleString()} hands | Starting bankroll: ${STARTING_BK.toLocaleString()}`);
console.log('='.repeat(72));

// ── Bet progression demo ──────────────────────────────────────────────────────
console.log('\n── BET PROGRESSION: 5 losses then 5 wins (starting bet = 100) ──\n');
console.log('  Step     | Event  | A (1/4)     | B (1/3)     | C (1/2)');
console.log('  ' + '-'.repeat(62));

for (const v of VARIANTS) {
  // Just compute sequences, print together
}

const seqResults = VARIANTS.map(v => {
  let b = 100;
  const seq = [];
  for (let i = 0; i < 5; i++) {
    seq.push({ event: `Loss ${i+1}`, bet: b });
    b = Math.max(MIN_BET, b * LOSS_MULTIPLIER);
  }
  for (let i = 0; i < 5; i++) {
    seq.push({ event: `Win  ${i+1}`, bet: b });
    b = Math.max(MIN_BET, b * v.fraction);
  }
  return seq;
});

// Print table
for (let step = 0; step < 10; step++) {
  const event = seqResults[0][step].event;
  const bets = VARIANTS.map((_, vi) => seqResults[vi][step].bet.toFixed(2).padStart(10));
  console.log(`  Step ${(step+1).toString().padStart(2)}   | ${event} | ${bets.join(' | ')}`);
}

// Show resulting bet AFTER the sequence
const finalBets = VARIANTS.map((v, vi) => {
  let b = 100;
  for (let i = 0; i < 5; i++) b = b * LOSS_MULTIPLIER;
  for (let i = 0; i < 5; i++) b = b * v.fraction;
  return b;
});
console.log('  ' + '-'.repeat(62));
console.log(`  Next bet |        | ${finalBets.map(b => b.toFixed(2).padStart(10)).join(' | ')}  ← bet entering hand 11`);

// ── Run simulations ───────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(72));
console.log('  Running simulations...');
console.log('='.repeat(72));

function percentile(sorted, p) {
  const idx = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

for (const variant of VARIANTS) {
  const results = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    results.push(runSim(variant.fraction));
  }

  const finals = results.map(r => r.finalBankroll).sort((a, b) => a - b);
  const drawdowns = results.map(r => r.maxDrawdown);
  const evs = results.map(r => r.evPerHand);
  const avgBets = results.map(r => r.avgBet);
  const recoveries = results.flatMap(r => r.recoverySamples);

  const meanFinal    = mean(finals);
  const medianFinal  = percentile(finals, 50);
  const pctProfit    = finals.filter(f => f > STARTING_BK).length / NUM_SIMS * 100;
  const pctBust      = finals.filter(f => f <= 0).length / NUM_SIMS * 100;
  const meanEV       = mean(evs);
  const meanDD       = mean(drawdowns);
  const bestFinal    = finals[finals.length - 1];
  const worstFinal   = finals[0];
  const meanAvgBet   = mean(avgBets);
  const meanRecovery = recoveries.length > 0 ? mean(recoveries) : NaN;

  console.log('\n' + '─'.repeat(72));
  console.log(`  ${variant.label}`);
  console.log('─'.repeat(72));
  console.log(`  Mean final bankroll   : ${meanFinal.toFixed(2).padStart(12)}`);
  console.log(`  Median final bankroll : ${medianFinal.toFixed(2).padStart(12)}`);
  console.log(`  % Profitable          : ${pctProfit.toFixed(1).padStart(12)}%`);
  console.log(`  % Bust                : ${pctBust.toFixed(1).padStart(12)}%`);
  console.log(`  EV per SBF hand       : ${meanEV.toFixed(4).padStart(12)}`);
  console.log(`  Mean max drawdown     : ${meanDD.toFixed(2).padStart(12)}`);
  console.log(`  Best sim outcome      : ${bestFinal.toFixed(2).padStart(12)}`);
  console.log(`  Worst sim outcome     : ${worstFinal.toFixed(2).padStart(12)}`);
  console.log(`  Avg bet per SBF hand  : ${meanAvgBet.toFixed(2).padStart(12)}`);
  console.log(`  Mean recovery (hands) : ${isNaN(meanRecovery) ? '       N/A' : meanRecovery.toFixed(2).padStart(12)}`);
}

// ── Side-by-side comparison table ────────────────────────────────────────────
console.log('\n\n' + '='.repeat(72));
console.log('  SIDE-BY-SIDE SUMMARY TABLE');
console.log('='.repeat(72));

const allStats = [];
for (const variant of VARIANTS) {
  const results = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    results.push(runSim(variant.fraction));
  }
  const finals = results.map(r => r.finalBankroll).sort((a, b) => a - b);
  const evs = results.map(r => r.evPerHand);
  const drawdowns = results.map(r => r.maxDrawdown);
  const avgBets = results.map(r => r.avgBet);
  const recoveries = results.flatMap(r => r.recoverySamples);
  allStats.push({
    label: variant.label,
    meanFinal: mean(finals),
    medianFinal: percentile(finals, 50),
    pctProfit: finals.filter(f => f > STARTING_BK).length / NUM_SIMS * 100,
    pctBust: finals.filter(f => f <= 0).length / NUM_SIMS * 100,
    meanEV: mean(evs),
    meanDD: mean(drawdowns),
    bestFinal: finals[finals.length - 1],
    worstFinal: finals[0],
    meanAvgBet: mean(avgBets),
    meanRecovery: recoveries.length > 0 ? mean(recoveries) : NaN,
  });
}

const col = 16;
const hdr = (s) => s.toString().padStart(col);

console.log('\n  Metric                    ' + VARIANTS.map(v => v.label.padStart(col)).join(''));
console.log('  ' + '-'.repeat(26 + VARIANTS.length * col));
const rows = [
  ['Mean final BK',    s => s.meanFinal.toFixed(0)],
  ['Median final BK',  s => s.medianFinal.toFixed(0)],
  ['% Profitable',     s => s.pctProfit.toFixed(1) + '%'],
  ['% Bust',           s => s.pctBust.toFixed(1) + '%'],
  ['EV / SBF hand',    s => s.meanEV.toFixed(4)],
  ['Mean max DD',      s => s.meanDD.toFixed(0)],
  ['Best sim',         s => s.bestFinal.toFixed(0)],
  ['Worst sim',        s => s.worstFinal.toFixed(0)],
  ['Avg bet / hand',   s => s.meanAvgBet.toFixed(2)],
  ['Recovery (hands)', s => isNaN(s.meanRecovery) ? 'N/A' : s.meanRecovery.toFixed(2)],
];

for (const [label, fn] of rows) {
  console.log('  ' + label.padEnd(26) + allStats.map(s => fn(s).padStart(col)).join(''));
}

console.log('\n' + '='.repeat(72));
console.log('  Done.');
console.log('='.repeat(72) + '\n');
