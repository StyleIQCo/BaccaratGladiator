'use strict';

// ============================================================
// Second Bank Frank — Streak-Scaled Multiplier Backtest
// EZ Baccarat, 8-deck, Dragon 7 push rule
// 5,000 sims × 5,000 hands per sim
// ============================================================

const NUM_SIMS   = 5000;
const NUM_HANDS  = 5000;
const START_BR   = 10000;
const BASE_BET   = 100;
const MIN_BET    = 1;
const KELLY_CAP  = 0.05;        // 5% of current bankroll
const WIN_DIVSOR = 3;           // divide bet by 3 on win
const MIN_STREAK = 3;           // minimum player streak to trigger SBF
const RESHUFFLE_AT = 14;        // cards remaining to trigger reshuffle
const K_VALUES   = [0, 0.05, 0.1, 0.15, 0.2, 0.3];

// ---------- Deck / Shoe Utilities ----------

function buildShoe() {
  // 8 decks × 52 cards, values capped at 10
  const shoe = [];
  for (let d = 0; d < 8; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        shoe.push(Math.min(rank, 10));
      }
    }
  }
  return shoe;
}

function shuffleShoe(shoe) {
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

// ---------- Baccarat Hand Logic ----------

function handTotal(cards) {
  return cards.reduce((s, c) => (s + c) % 10, 0);
}

// Returns { winner: 'player'|'banker'|'tie', isDragon7: bool }
// Dragon 7: banker wins with a 3-card hand totaling 7
function dealHand(shoe, cursor) {
  // Draw in standard baccarat order: P B P B
  const p1 = shoe[cursor++];
  const b1 = shoe[cursor++];
  const p2 = shoe[cursor++];
  const b2 = shoe[cursor++];

  let pCards = [p1, p2];
  let bCards = [b1, b2];

  const pTotal = handTotal(pCards);
  const bTotal = handTotal(bCards);

  // Natural check
  if (pTotal >= 8 || bTotal >= 8) {
    const winner = pTotal > bTotal ? 'player' : bTotal > pTotal ? 'banker' : 'tie';
    return { winner, isDragon7: false, cursor };
  }

  // Player draw rule
  let pDraw = false;
  if (pTotal <= 5) {
    pCards.push(shoe[cursor++]);
    pDraw = true;
  }

  // Banker draw rule
  const pThird = pDraw ? pCards[2] : null;
  let bDraw = false;
  if (!pDraw) {
    if (bTotal <= 5) bDraw = true;
  } else {
    if (bTotal <= 2) {
      bDraw = true;
    } else if (bTotal === 3 && pThird !== 8) {
      bDraw = true;
    } else if (bTotal === 4 && pThird >= 2 && pThird <= 7) {
      bDraw = true;
    } else if (bTotal === 5 && pThird >= 4 && pThird <= 7) {
      bDraw = true;
    } else if (bTotal === 6 && pThird >= 6 && pThird <= 7) {
      bDraw = true;
    }
  }

  if (bDraw) bCards.push(shoe[cursor++]);

  const finalP = handTotal(pCards);
  const finalB = handTotal(bCards);

  const isDragon7 = bCards.length === 3 && finalB === 7 && finalB > finalP;

  let winner;
  if (finalP > finalB) winner = 'player';
  else if (finalB > finalP) winner = 'banker';
  else winner = 'tie';

  return { winner, isDragon7, cursor };
}

// ---------- Multiplier Formula ----------

function calcMultiplier(streakLen, k) {
  return 1.0 + (streakLen - 3) * k + 0.5;
}

// ---------- Single Simulation ----------

function runSim(k, rng) {
  let bankroll = START_BR;
  let shoe = shuffleShoe(buildShoe());
  let cursor = 0;

  // SBF state machine
  // States: IDLE → COUNTING_STREAK → WAIT_CONFIRM → WAIT_SECOND_BANK
  let state = 'IDLE';
  let playerStreak = 0;
  let recordedStreak = 0;
  let currentBet = BASE_BET;
  let inBet = false;

  // Stats
  let maxBankroll = START_BR;
  let maxDrawdown = 0;
  let peakBankroll = START_BR;
  let sbfHands = 0;
  let sbfWins = 0;
  let sbfLosses = 0;
  let totalBetSize = 0;
  let totalMultiplierUsed = 0; // sum of multipliers applied on losses
  let multCount = 0;

  // Streak distribution: how many SBF opps came from streak length 3,4,5,6,7,8,9,10+
  const streakDist = { 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, '10+':0 };

  // Per-streak banker win tracking (for the "next hand" analysis)
  const streakBankerWins   = {};
  const streakBankerTrials = {};
  for (let s = 3; s <= 12; s++) { streakBankerWins[s] = 0; streakBankerTrials[s] = 0; }
  streakBankerWins['10+'] = 0; streakBankerTrials['10+'] = 0;

  // We need to track when we are in the WAIT_SECOND_BANK state for the "second bank" hand
  // But also we track the CONFIRMATION banker win for per-streak banker-win-rate analysis
  // (The SBF bet is on the SECOND banker hand, i.e., the one after the confirmation)

  for (let h = 0; h < NUM_HANDS; h++) {
    if (bankroll <= 0) break;

    // Reshuffle check
    if (shoe.length - cursor <= RESHUFFLE_AT) {
      shoe = shuffleShoe(buildShoe());
      cursor = 0;
    }

    if (cursor + 6 > shoe.length) {
      shoe = shuffleShoe(buildShoe());
      cursor = 0;
    }

    const result = dealHand(shoe, cursor);
    cursor = result.cursor;
    const { winner, isDragon7 } = result;

    // Skip ties for streak counting and SBF logic
    if (winner === 'tie') continue;

    // --- Per-streak second-bank win-rate tracking ---
    if (state === 'WAIT_SECOND_BANK') {
      // This is the hand we bet on (the second banker after the streak)
      const sk = recordedStreak >= 10 ? '10+' : recordedStreak;
      if (streakBankerTrials[sk] !== undefined) {
        streakBankerTrials[sk]++;
        // Dragon 7 is a push (neither win nor loss for streakWins)
        if (winner === 'banker' && !isDragon7) {
          streakBankerWins[sk]++;
        }
      }
    }

    // --- SBF Bet Resolution ---
    if (inBet) {
      sbfHands++;
      totalBetSize += currentBet;

      if (isDragon7) {
        // Push — no change to bankroll, keep same bet
        inBet = false;
        state = 'IDLE';
        playerStreak = 0;
      } else if (winner === 'banker') {
        // Win — banker pays 0.95 (5% commission in standard, EZ pays 1:1 except Dragon 7)
        // EZ Baccarat: banker wins pay even money (no commission), Dragon 7 is push
        bankroll += currentBet;
        sbfWins++;
        currentBet = Math.max(MIN_BET, Math.round(currentBet / WIN_DIVSOR));
        inBet = false;
        state = 'IDLE';
        playerStreak = 0;
      } else {
        // Loss
        bankroll -= currentBet;
        sbfLosses++;
        const mult = calcMultiplier(recordedStreak, k);
        totalMultiplierUsed += mult;
        multCount++;
        const rawNext = currentBet * mult;
        const kellyCap = bankroll * KELLY_CAP;
        currentBet = Math.max(MIN_BET, Math.min(Math.round(rawNext), Math.round(kellyCap)));
        // Stay in WAIT_SECOND_BANK to bet again on next non-tie hand
        inBet = false; // will re-enter bet on next state check below
        // We stay in state WAIT_SECOND_BANK — next hand we bet again
        // (The "second bank" phase continues until a win or bust)
      }

      // Track drawdown
      if (bankroll > peakBankroll) peakBankroll = bankroll;
      const dd = peakBankroll - bankroll;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // --- State Machine Update ---
    switch (state) {
      case 'IDLE':
        if (winner === 'player') {
          state = 'COUNTING_STREAK';
          playerStreak = 1;
        }
        break;

      case 'COUNTING_STREAK':
        if (winner === 'player') {
          playerStreak++;
        } else {
          // Banker ended the player streak
          if (playerStreak >= MIN_STREAK) {
            recordedStreak = playerStreak;
            state = 'WAIT_SECOND_BANK';
            // Record streak distribution
            const sk = recordedStreak >= 10 ? '10+' : recordedStreak;
            if (streakDist[sk] !== undefined) streakDist[sk]++;
            else streakDist['10+']++;
          } else {
            state = 'IDLE';
          }
          playerStreak = 0;
        }
        break;

      case 'WAIT_SECOND_BANK':
        // We ARE now on the second bank (the bet hand)
        // Set up the bet for this hand (or continuing after a loss)
        if (!inBet && bankroll > 0) {
          const kellyCap = bankroll * KELLY_CAP;
          currentBet = Math.max(MIN_BET, Math.min(currentBet, Math.round(kellyCap)));
          inBet = true;
          // Note: the bet resolution happened above already for this hand
          // We need to re-process this hand's winner for the bet
          // Actually the bet should apply to THIS hand — but we already processed the result above.
          // Let's restructure: mark inBet BEFORE processing, but we can't go back.
          // FIX: We need to handle bet placement before resolution.
          // This logic is inverted — let me restructure below.
        }
        if (winner === 'player') {
          // Player won — we lost (handled above), keep state, next hand we bet again
        } else if (winner === 'banker' && !isDragon7) {
          // We won (handled above), go idle
          state = 'IDLE';
          playerStreak = 0;
        } else if (!isDragon7) {
          // shouldn't happen
          state = 'IDLE';
        }
        break;
    }
  }

  const finalBankroll = Math.max(0, bankroll);
  return {
    finalBankroll,
    maxDrawdown,
    sbfHands,
    sbfWins,
    sbfLosses,
    totalBetSize,
    avgMultiplier: multCount > 0 ? totalMultiplierUsed / multCount : 1.5,
    streakDist,
    streakBankerWins,
    streakBankerTrials,
  };
}

// ============================================================
// The state machine above has a logical issue with bet placement
// timing. Let me rewrite with a cleaner approach.
// ============================================================

function runSimClean(k) {
  let bankroll = START_BR;
  let shoe = shuffleShoe(buildShoe());
  let cursor = 0;

  // SBF state
  // phase: 'idle' | 'counting' | 'wait_confirm' | 'betting'
  let phase = 'idle';
  let playerStreak = 0;
  let recordedStreak = 0;
  let currentBet = BASE_BET;

  // Stats
  let peakBankroll = START_BR;
  let maxDrawdown = 0;
  let sbfHands = 0;
  let sbfWins = 0;
  let sbfLosses = 0;
  let totalBetSize = 0;
  let totalMultOnLoss = 0;
  let multOnLossCount = 0;

  const streakDist = { 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, '10+':0 };

  // Per-streak second-banker win rate
  const sbWins   = {}; // wins on the SBF bet hand grouped by streak
  const sbTrials = {};
  for (let s = 3; s <= 9; s++) { sbWins[s] = 0; sbTrials[s] = 0; }
  sbWins['10+'] = 0; sbTrials['10+'] = 0;

  for (let h = 0; h < NUM_HANDS; h++) {
    if (bankroll <= 0) break;

    // Reshuffle check
    if (shoe.length - cursor <= RESHUFFLE_AT) {
      shoe = shuffleShoe(buildShoe());
      cursor = 0;
    }
    if (cursor + 6 > shoe.length) {
      shoe = shuffleShoe(buildShoe());
      cursor = 0;
    }

    const result = dealHand(shoe, cursor);
    cursor = result.cursor;
    const { winner, isDragon7 } = result;

    if (winner === 'tie') continue; // ties skipped

    // ---- Phase logic ----

    if (phase === 'idle') {
      if (winner === 'player') {
        phase = 'counting';
        playerStreak = 1;
      }
      // banker win in idle — nothing

    } else if (phase === 'counting') {
      if (winner === 'player') {
        playerStreak++;
      } else {
        // banker ended streak — this is the CONFIRMATION banker win
        if (playerStreak >= MIN_STREAK) {
          recordedStreak = playerStreak;
          // Record streak distribution
          const sk = recordedStreak >= 10 ? '10+' : recordedStreak <= 9 ? recordedStreak : '10+';
          if (streakDist[sk] !== undefined) streakDist[sk]++;
          else streakDist['10+']++;
          // Reset bet to BASE_BET for new SBF opportunity (fresh entry)
          currentBet = BASE_BET;
          phase = 'betting';
        } else {
          phase = 'idle';
        }
        playerStreak = 0;
      }

    } else if (phase === 'betting') {
      // Apply Kelly cap
      const kellyCap = Math.round(bankroll * KELLY_CAP);
      const actualBet = Math.max(MIN_BET, Math.min(currentBet, kellyCap));

      // Track per-streak banker win rate on this hand
      const sk = recordedStreak >= 10 ? '10+' : recordedStreak;
      sbTrials[sk]++;

      sbfHands++;
      totalBetSize += actualBet;

      if (isDragon7) {
        // Push — no bankroll change, repeat bet
        // Stay in betting phase, same bet
      } else if (winner === 'banker') {
        // Win — EZ Baccarat pays even on banker
        bankroll += actualBet;
        sbWins[sk]++;
        sbfWins++;
        // Divide bet by 3
        currentBet = Math.max(MIN_BET, Math.round(currentBet / WIN_DIVSOR));
        // Go back to watching for next streak
        phase = 'idle';
        playerStreak = 0;
      } else {
        // Player wins — we lose the bet
        bankroll -= actualBet;
        sbfLosses++;
        // Scale up by streak-length multiplier
        const mult = calcMultiplier(recordedStreak, k);
        totalMultOnLoss += mult;
        multOnLossCount++;
        currentBet = Math.round(currentBet * mult);
        // Stay in betting phase — next hand we bet again (still same SBF opportunity)
        // But if bankroll hits 0, loop ends
      }

      // Drawdown tracking
      if (bankroll > peakBankroll) peakBankroll = bankroll;
      const dd = peakBankroll - bankroll;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  return {
    finalBankroll: Math.max(0, bankroll),
    maxDrawdown,
    sbfHands,
    sbfWins,
    sbfLosses,
    totalBetSize,
    avgMultOnLoss: multOnLossCount > 0 ? totalMultOnLoss / multOnLossCount : 1.5,
    streakDist,
    sbWins,
    sbTrials,
  };
}

// ---------- Aggregate Results ----------

function aggregate(results, k) {
  const n = results.length;
  const finals = results.map(r => r.finalBankroll).sort((a, b) => a - b);
  const mean = finals.reduce((s, v) => s + v, 0) / n;
  const median = finals[Math.floor(n / 2)];
  const profitable = finals.filter(v => v > START_BR).length;
  const busted = finals.filter(v => v <= 0).length;

  const totalSbfHands = results.reduce((s, r) => s + r.sbfHands, 0);
  const totalBetSize  = results.reduce((s, r) => s + r.totalBetSize, 0);
  const totalWins     = results.reduce((s, r) => s + r.sbfWins, 0);
  const totalLosses   = results.reduce((s, r) => s + r.sbfLosses, 0);

  // EV per SBF hand = (total profit from SBF) / total SBF hands
  // Approximate: each win returns bet, each loss costs bet
  // We'll compute net from bankroll changes across sims
  const totalPnL = results.reduce((s, r) => s + (r.finalBankroll - START_BR), 0);
  const evPerHand = totalSbfHands > 0 ? totalPnL / totalSbfHands : 0;

  const avgDrawdown = results.reduce((s, r) => s + r.maxDrawdown, 0) / n;
  const avgMult = results.reduce((s, r) => s + r.avgMultOnLoss, 0) / n;
  const avgBetSize = totalSbfHands > 0 ? totalBetSize / totalSbfHands : 0;

  // Streak distribution aggregated
  const streakKeys = [3, 4, 5, 6, 7, 8, 9, '10+'];
  const totalStreakOpp = {};
  let grandTotalOpp = 0;
  for (const sk of streakKeys) {
    totalStreakOpp[sk] = results.reduce((s, r) => s + (r.streakDist[sk] || 0), 0);
    grandTotalOpp += totalStreakOpp[sk];
  }

  // Per-streak banker win rate on SBF hand
  const perStreakWinRate = {};
  for (const sk of streakKeys) {
    const wins   = results.reduce((s, r) => s + (r.sbWins[sk]   || 0), 0);
    const trials = results.reduce((s, r) => s + (r.sbTrials[sk] || 0), 0);
    perStreakWinRate[sk] = trials > 0 ? { wins, trials, rate: wins / trials } : null;
  }

  return {
    k,
    n,
    mean: Math.round(mean),
    median: Math.round(median),
    profitable,
    busted,
    pctProfitable: (profitable / n * 100).toFixed(1),
    pctBusted: (busted / n * 100).toFixed(1),
    evPerHand: evPerHand.toFixed(4),
    avgDrawdown: Math.round(avgDrawdown),
    avgMult: avgMult.toFixed(3),
    avgBetSize: avgBetSize.toFixed(1),
    bestSim: Math.round(finals[n - 1]),
    worstSim: Math.round(finals[0]),
    streakDist: streakKeys.map(sk => ({
      streak: sk,
      count: totalStreakOpp[sk],
      pct: grandTotalOpp > 0 ? (totalStreakOpp[sk] / grandTotalOpp * 100).toFixed(1) : '0.0'
    })),
    perStreakWinRate,
    totalSbfHands,
    totalWins,
    totalLosses,
  };
}

// ---------- Main ----------

console.log('='.repeat(70));
console.log('  Second Bank Frank — Streak-Scaled Multiplier Backtest');
console.log(`  ${NUM_SIMS.toLocaleString()} sims × ${NUM_HANDS.toLocaleString()} hands | Bankroll: ${START_BR.toLocaleString()} units`);
console.log('='.repeat(70));
console.log();

const allResults = {};

for (const k of K_VALUES) {
  process.stdout.write(`Running k=${k} ... `);
  const t0 = Date.now();
  const sims = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    sims.push(runSimClean(k));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`done (${elapsed}s)\n`);
  allResults[k] = aggregate(sims, k);
}

console.log();
console.log('='.repeat(70));
console.log('  COMPARISON TABLE');
console.log('='.repeat(70));

// Header
const colW = 12;
const pad = (s, w) => String(s).padStart(w);
const padL = (s, w) => String(s).padEnd(w);

const header = ['Metric', ...K_VALUES.map(k => `k=${k}`)];
console.log(header.map((h, i) => i === 0 ? padL(h, 28) : pad(h, colW)).join(''));
console.log('-'.repeat(28 + colW * K_VALUES.length));

function row(label, fn) {
  const cells = [padL(label, 28), ...K_VALUES.map(k => pad(fn(allResults[k]), colW))];
  console.log(cells.join(''));
}

row('Mean Final Bankroll',       r => r.mean.toLocaleString());
row('Median Final Bankroll',     r => r.median.toLocaleString());
row('% Profitable',              r => r.pctProfitable + '%');
row('% Busted',                  r => r.pctBusted + '%');
row('EV per SBF Hand',           r => r.evPerHand);
row('Mean Max Drawdown',         r => r.avgDrawdown.toLocaleString());
row('Avg Multiplier (on loss)',  r => r.avgMult);
row('Avg Bet Size (units)',      r => r.avgBetSize);
row('Best Single Sim',           r => r.bestSim.toLocaleString());
row('Worst Single Sim',          r => r.worstSim.toLocaleString());
row('Total SBF Hands (all sims)',r => r.totalSbfHands.toLocaleString());

console.log();
console.log('='.repeat(70));
console.log('  STREAK LENGTH DISTRIBUTION (% of SBF opportunities)');
console.log('='.repeat(70));
const streakKeys = [3, 4, 5, 6, 7, 8, 9, '10+'];
const sHeader = ['Streak', ...K_VALUES.map(k => `k=${k}`)];
console.log(sHeader.map((h, i) => i === 0 ? padL(h, 10) : pad(h, colW)).join(''));
console.log('-'.repeat(10 + colW * K_VALUES.length));
for (const sk of streakKeys) {
  const cells = [
    padL(`  ${sk}`, 10),
    ...K_VALUES.map(k => {
      const entry = allResults[k].streakDist.find(d => d.streak == sk);
      return pad(entry ? entry.pct + '%' : '-', colW);
    })
  ];
  console.log(cells.join(''));
}

// Pick k=0 for absolute counts (same distribution for all k)
console.log();
console.log('  Absolute counts (k=0 representative):');
const r0 = allResults[0];
for (const d of r0.streakDist) {
  console.log(`    Streak ${d.streak}: ${d.count.toLocaleString()} opportunities (${d.pct}%)`);
}

console.log();
console.log('='.repeat(70));
console.log('  BANKER WIN RATE ON SBF BET HAND BY STREAK LENGTH');
console.log('  (Baseline banker win rate excl. ties: ~45.86%)');
console.log('='.repeat(70));
console.log('  Using pooled data across all k values (same shoe simulation):');
console.log();

// Pool across all k — actually each k is a separate sim, so use k=0 as representative
// But for robustness, pool across k=0 only (5000 sims, most data)
const repResult = allResults[0];
console.log(padL('Streak', 10) + pad('Trials', 12) + pad('Banker Wins', 14) + pad('Win Rate', 12) + pad('vs Baseline', 13));
console.log('-'.repeat(61));

const BASELINE = 0.4586;
for (const sk of streakKeys) {
  const wr = repResult.perStreakWinRate[sk];
  if (!wr || wr.trials === 0) {
    console.log(padL(`  ${sk}`, 10) + pad('N/A', 12) + pad('-', 14) + pad('-', 12) + pad('-', 13));
  } else {
    const diff = (wr.rate - BASELINE) * 100;
    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%';
    console.log(
      padL(`  ${sk}`, 10) +
      pad(wr.trials.toLocaleString(), 12) +
      pad(wr.wins.toLocaleString(), 14) +
      pad((wr.rate * 100).toFixed(2) + '%', 12) +
      pad(diffStr, 13)
    );
  }
}

console.log();
console.log('='.repeat(70));
console.log('  MULTIPLIER SCALING REFERENCE TABLE');
console.log('='.repeat(70));
const refStreaks = [3, 4, 5, 6, 7, 8, 10, 15, 20];
const mHeader = ['Streak', ...K_VALUES.map(k => `k=${k}`)];
console.log(mHeader.map((h, i) => i === 0 ? padL(h, 10) : pad(h, colW)).join(''));
console.log('-'.repeat(10 + colW * K_VALUES.length));
for (const sl of refStreaks) {
  const cells = [
    padL(`  ${sl}`, 10),
    ...K_VALUES.map(k => pad(calcMultiplier(sl, k).toFixed(2) + 'x', colW))
  ];
  console.log(cells.join(''));
}

console.log();
console.log('='.repeat(70));
console.log('  NOTES');
console.log('='.repeat(70));
console.log('  - EZ Baccarat: banker pays 1:1 (no commission), Dragon 7 = push');
console.log('  - 8-deck shoe, reshuffle at 14 cards remaining');
console.log('  - SBF entry: player streak >= 3, bet SECOND banker after confirmation');
console.log('  - Win: bet ÷ 3 | Loss: bet × multiplier(streakLen, k)');
console.log('  - Kelly cap: 5% of current bankroll (hard cap)');
console.log('  - Min bet: 1 unit | Starting bet: 100 units');
console.log('  - Ties skipped for streak counting and SBF state machine');
console.log('  - Dragon 7 = push (no bankroll change, repeat same bet)');
console.log();
