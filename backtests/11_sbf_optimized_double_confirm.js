'use strict';

// ============================================================
// EZ Baccarat Simulator — Second Bank Frank Optimized Backtest
// ============================================================

// ---- Card / Shoe helpers ----

function buildShoe() {
  const shoe = [];
  for (let d = 0; d < 8; d++) {
    for (let s = 0; s < 4; s++) {
      for (let r = 1; r <= 13; r++) {
        shoe.push(Math.min(r, 10)); // face cards = 10
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
}

function baccaratValue(cards) {
  return cards.reduce((s, c) => s + c, 0) % 10;
}

// Draw one card from the shoe; returns null if shoe exhausted below cutoff
// cutoff: 14 cards remaining → reshuffle (handled by caller)
function dealHand(shoe, pos) {
  // returns [card, newPos]
  return [shoe[pos], pos + 1];
}

// Full baccarat hand dealing per EZ Baccarat rules
// Returns { playerCards, bankerCards, winner: 'player'|'banker'|'tie', dragon7 }
function playBaccaratHand(shoe, pos) {
  // Need at most 6 cards
  const p = [];
  const b = [];
  let cursor = pos;

  function draw() {
    const card = shoe[cursor++];
    return card;
  }

  p.push(draw()); b.push(draw()); p.push(draw()); b.push(draw());

  let pVal = baccaratValue(p);
  let bVal = baccaratValue(b);

  // Natural check
  const natural = pVal >= 8 || bVal >= 8;

  if (!natural) {
    // Player draw rule
    let pDraw = false;
    if (pVal <= 5) { p.push(draw()); pDraw = true; }
    pVal = baccaratValue(p);

    // Banker draw rule
    if (pDraw) {
      const pThird = p[2];
      if (bVal <= 2) { b.push(draw()); }
      else if (bVal === 3 && pThird !== 8) { b.push(draw()); }
      else if (bVal === 4 && [2,3,4,5,6,7].includes(pThird)) { b.push(draw()); }
      else if (bVal === 5 && [4,5,6,7].includes(pThird)) { b.push(draw()); }
      else if (bVal === 6 && [6,7].includes(pThird)) { b.push(draw()); }
    } else {
      // Player stood
      if (bVal <= 5) { b.push(draw()); }
    }
  }

  pVal = baccaratValue(p);
  bVal = baccaratValue(b);

  // Dragon 7: banker wins with exactly 3 cards totaling 7
  const dragon7 = b.length === 3 && bVal === 7 && bVal > pVal;

  let winner;
  if (pVal > bVal) winner = 'player';
  else if (bVal > pVal) winner = 'banker';
  else winner = 'tie';

  return { playerCards: p, bankerCards: b, winner, dragon7, pVal, bVal, cardsUsed: cursor - pos };
}

// ---- Kelly bet sizing for EZ Baccarat banker bet ----
// Banker pays 0.95:1; EV ≈ -0.01058 per unit → we use Kelly as a cap mechanism
// Kelly fraction = edge / odds; for losing edge we cap at minBet
// Per spec: ÷3 on win, ×1.5 on loss, 5% Kelly cap, min 1 unit
function nextBet(currentBet, lastResult, bankroll, startingBet) {
  let bet;
  if (lastResult === 'win') {
    bet = Math.max(1, currentBet / 3);
  } else if (lastResult === 'loss') {
    bet = currentBet * 1.5;
  } else {
    bet = currentBet; // push / first bet
  }
  // 5% Kelly cap on bankroll
  const kellyCap = bankroll * 0.05;
  bet = Math.min(bet, kellyCap);
  bet = Math.max(1, bet);
  return bet;
}

// ============================================================
// Core simulation
// ============================================================

/**
 * Simulate one session.
 *
 * @param {object} opts
 *   doubleConfirm  {bool}
 *   stopLoss       {bool}
 *   stopWin        {bool}
 *   maxHands       {number}
 *   stopWinTarget  {number}
 *   startBankroll  {number}
 *   startBet       {number}
 *
 * @returns {object} session stats
 */
function simulateSession(opts) {
  const {
    doubleConfirm,
    stopLoss,
    stopWin,
    maxHands = 5000,
    stopWinTarget = 11500,
    startBankroll = 10000,
    startBet = 100,
  } = opts;

  let bankroll = startBankroll;
  let currentBet = startBet;
  let handCount = 0;
  let maxDrawdown = 0;
  let peakBankroll = startBankroll;
  let sbfBets = 0;
  let sbfWins = 0;
  let sbfLosses = 0;
  let stopWinTriggered = false;

  // Per-session accumulators for opportunity counting
  let totalShoeSbfOpportunities = 0;
  let totalShoes = 0;

  const shoe = buildShoe();

  // ---- Outer shoe loop ----
  while (handCount < maxHands) {
    if (bankroll <= 0) break;
    if (stopWin && bankroll >= stopWinTarget) { stopWinTriggered = true; break; }

    shuffleShoe(shoe);
    let pos = 0;
    totalShoes++;

    // Per-shoe state
    let consecutiveLosses = 0; // SBF consecutive losses this shoe
    let sittingOut = false;    // stop-loss triggered for this shoe

    // Pattern tracking
    let playerStreak = 0;       // current consecutive player wins
    let bankerConfirm = 0;      // consecutive banker confirmations after streak
    let state = 'watching';     // 'watching' | 'confirming' | 'betting'
    // state machine:
    //   watching  → count player streak; when streak≥3 move to confirming
    //   confirming → count banker confirmations;
    //                single: 1 confirmation → state=betting
    //                double: 2 confirmations → state=betting
    //   betting   → bet the next hand; then back to watching

    let shoeOpportunities = 0;

    // ---- Inner hand loop ----
    while (pos <= shoe.length - 14 && handCount < maxHands) {
      if (bankroll <= 0) break;
      if (stopWin && bankroll >= stopWinTarget) { stopWinTriggered = true; break; }

      // Check if enough cards remain (need at least 6 for a hand, reshuffle at 14)
      if (shoe.length - pos < 14) break;

      const result = playBaccaratHand(shoe, pos);
      pos += result.cardsUsed;
      handCount++;

      const { winner, dragon7 } = result;

      // Ties push — don't change streaks, don't change state
      if (winner === 'tie') continue;

      // ---- State machine update ----
      // We keep counting player streak until a banker win ends it.
      // When a banker win ends a streak of 3+, that banker win is confirmation 1.
      if (state === 'watching') {
        if (winner === 'player') {
          playerStreak++;
        } else {
          // banker win
          if (playerStreak >= 3) {
            if (!doubleConfirm) {
              // Single confirm: this banker win IS the one confirmation → bet next
              state = 'betting';
              bankerConfirm = 1;
            } else {
              // Double confirm: this is confirm 1 → need one more
              state = 'confirming';
              bankerConfirm = 1;
            }
          }
          playerStreak = 0;
        }
      } else if (state === 'confirming') {
        // Only reached for doubleConfirm=true; waiting for 2nd banker confirmation
        if (winner === 'banker') {
          bankerConfirm++;
          if (bankerConfirm >= 2) {
            state = 'betting';
          }
        } else if (winner === 'player') {
          // Player win interrupts — reset entirely
          state = 'watching';
          playerStreak = 1;
          bankerConfirm = 0;
        }
      } else if (state === 'betting') {
        // This hand IS the SBF bet
        shoeOpportunities++;

        const shouldBet = !sittingOut;
        let betResult = null;

        if (shouldBet && bankroll > 0) {
          const betAmount = Math.min(currentBet, bankroll);
          sbfBets++;

          if (winner === 'banker') {
            // Dragon 7 pushes banker bets
            if (dragon7) {
              betResult = 'push';
              // push — no change to bankroll, don't update streak
            } else {
              const payout = betAmount * 0.95;
              bankroll += payout;
              sbfWins++;
              betResult = 'win';
              consecutiveLosses = 0;
            }
          } else {
            // player wins — we lose
            bankroll -= betAmount;
            sbfLosses++;
            betResult = 'loss';
            consecutiveLosses++;
            if (stopLoss && consecutiveLosses >= 3) {
              sittingOut = true;
            }
          }

          // Update bet sizing
          if (betResult === 'push') {
            // no change
          } else {
            currentBet = nextBet(currentBet, betResult, bankroll, startBet);
          }

          // Track drawdown
          if (bankroll > peakBankroll) peakBankroll = bankroll;
          const dd = peakBankroll - bankroll;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }

        // After betting, reset to watching for next pattern
        state = 'watching';
        playerStreak = 0;
        bankerConfirm = 0;
      }
    } // end inner hand loop

    totalShoeSbfOpportunities += shoeOpportunities;
    if (stopWinTriggered) break;
  } // end outer shoe loop

  const avgOpportunitiesPerShoe = totalShoes > 0 ? totalShoeSbfOpportunities / totalShoes : 0;

  return {
    finalBankroll: bankroll,
    peakBankroll,
    handCount,
    maxDrawdown,
    sbfBets,
    sbfWins,
    sbfLosses,
    stopWinTriggered,
    avgOpportunitiesPerShoe,
  };
}

// ============================================================
// Double Confirmation premise test
// ============================================================

function bucketStreak(streak) {
  if (streak >= 10) return 10;
  if (streak >= 8)  return 8;
  if (streak >= 7)  return 7;
  if (streak >= 6)  return 6;
  if (streak >= 5)  return 5;
  if (streak >= 4)  return 4;
  return 3;
}

function testDoubleConfirmationPremise(simCount = 200000) {
  // After 3+P streak → N consecutive Banker wins → what is the next hand banker rate?
  // Two INDEPENDENT state machines, each with their own streak counter.

  const shoe = buildShoe();

  const streakBuckets = [3, 4, 5, 6, 7, 8, 10];
  const dcResults = {};
  const scResults = {};
  streakBuckets.forEach(s => {
    dcResults[s] = { banker: 0, player: 0 };
    scResults[s] = { banker: 0, player: 0 };
  });

  let baselineBanker = 0, baselineTotal = 0;

  for (let sim = 0; sim < simCount; sim++) {
    shuffleShoe(shoe);
    let pos = 0;

    // --- Single confirm machine ---
    let sc_playerStreak = 0;
    let sc_bankerConfirm = 0;
    let sc_state = 'watching'; // watching | confirming | betting
    let sc_savedStreak = 0;

    // --- Double confirm machine ---
    let dc_playerStreak = 0;
    let dc_bankerConfirm = 0;
    let dc_state = 'watching';
    let dc_savedStreak = 0;

    while (shoe.length - pos >= 14) {
      const result = playBaccaratHand(shoe, pos);
      pos += result.cardsUsed;
      const { winner } = result;

      // Baseline (non-tie only)
      if (winner !== 'tie') {
        baselineTotal++;
        if (winner === 'banker') baselineBanker++;
      }

      // ---- Single confirm machine ----
      // Strategy: keep counting player streak; transition to confirming
      // only when a banker win arrives after streak >= 3.
      if (sc_state === 'watching') {
        if (winner === 'tie') { /* skip */ }
        else if (winner === 'player') {
          sc_playerStreak++;
        } else {
          // banker win
          if (sc_playerStreak >= 3) {
            // This banker win IS confirmation 1 for single confirm
            sc_savedStreak = sc_playerStreak;
            sc_bankerConfirm = 1;
            sc_state = 'betting'; // single confirm needs only 1
          }
          sc_playerStreak = 0;
        }
      } else if (sc_state === 'betting') {
        if (winner !== 'tie') {
          const key = bucketStreak(sc_savedStreak);
          scResults[key][winner]++;
        }
        // Reset
        sc_state = 'watching';
        sc_playerStreak = winner === 'player' ? 1 : 0;
        sc_bankerConfirm = 0;
        sc_savedStreak = 0;
      }

      // ---- Double confirm machine ----
      if (dc_state === 'watching') {
        if (winner === 'tie') { /* skip */ }
        else if (winner === 'player') {
          dc_playerStreak++;
        } else {
          // banker win
          if (dc_playerStreak >= 3) {
            // First banker confirmation — move to confirming state
            dc_savedStreak = dc_playerStreak;
            dc_bankerConfirm = 1;
            dc_state = 'confirming';
          }
          dc_playerStreak = 0;
        }
      } else if (dc_state === 'confirming') {
        if (winner === 'tie') { /* skip */ }
        else if (winner === 'banker') {
          dc_bankerConfirm++;
          if (dc_bankerConfirm >= 2) {
            dc_state = 'betting';
          }
        } else {
          // player win interrupts
          dc_state = 'watching';
          dc_playerStreak = 1;
          dc_bankerConfirm = 0;
          dc_savedStreak = 0;
        }
      } else if (dc_state === 'betting') {
        if (winner !== 'tie') {
          const key = bucketStreak(dc_savedStreak);
          dcResults[key][winner]++;
        }
        // Reset
        dc_state = 'watching';
        dc_playerStreak = winner === 'player' ? 1 : 0;
        dc_bankerConfirm = 0;
        dc_savedStreak = 0;
      }
    }
  }

  return {
    baseline: baselineTotal > 0 ? baselineBanker / baselineTotal : 0,
    single: scResults,
    double: dcResults,
  };
}

// ============================================================
// Run all 8 variants
// ============================================================

const VARIANTS = [
  { name: 'SBF Baseline',                doubleConfirm: false, stopLoss: false, stopWin: false },
  { name: 'Double Confirm Only',         doubleConfirm: true,  stopLoss: false, stopWin: false },
  { name: 'Stop-Loss Only',              doubleConfirm: false, stopLoss: true,  stopWin: false },
  { name: 'Stop-Win Only',               doubleConfirm: false, stopLoss: false, stopWin: true  },
  { name: 'Double Confirm + Stop-Loss',  doubleConfirm: true,  stopLoss: true,  stopWin: false },
  { name: 'Double Confirm + Stop-Win',   doubleConfirm: true,  stopLoss: false, stopWin: true  },
  { name: 'Stop-Loss + Stop-Win',        doubleConfirm: false, stopLoss: true,  stopWin: true  },
  { name: 'ALL THREE Combined',          doubleConfirm: true,  stopLoss: true,  stopWin: true  },
];

const NUM_SIMS = 10000;
const START_BANKROLL = 10000;
const STOP_WIN_TARGET = 11500;
const MAX_HANDS = 5000;
const START_BET = 100;

console.log('='.repeat(80));
console.log('SECOND BANK FRANK — OPTIMIZED BACKTEST');
console.log(`${NUM_SIMS.toLocaleString()} simulations × up to ${MAX_HANDS.toLocaleString()} hands`);
console.log(`Starting bankroll: ${START_BANKROLL.toLocaleString()} units | Stop-Win target: ${STOP_WIN_TARGET.toLocaleString()} units (+15%)`);
console.log('='.repeat(80));
console.log();

const variantResults = [];

for (const variant of VARIANTS) {
  const sessions = [];
  let bestBankroll = -Infinity;
  let worstBankroll = Infinity;

  for (let s = 0; s < NUM_SIMS; s++) {
    const r = simulateSession({
      doubleConfirm: variant.doubleConfirm,
      stopLoss: variant.stopLoss,
      stopWin: variant.stopWin,
      maxHands: MAX_HANDS,
      stopWinTarget: STOP_WIN_TARGET,
      startBankroll: START_BANKROLL,
      startBet: START_BET,
    });
    sessions.push(r);
    if (r.finalBankroll > bestBankroll) bestBankroll = r.finalBankroll;
    if (r.finalBankroll < worstBankroll) worstBankroll = r.finalBankroll;
  }

  // Aggregate
  const n = sessions.length;
  const meanBankroll = sessions.reduce((s, r) => s + r.finalBankroll, 0) / n;
  const sorted = [...sessions].sort((a, b) => a.finalBankroll - b.finalBankroll);
  const medianBankroll = sorted[Math.floor(n / 2)].finalBankroll;
  const pctStopWin = sessions.filter(r => r.stopWinTriggered).length / n * 100;
  const pctProfitable = sessions.filter(r => r.finalBankroll > START_BANKROLL).length / n * 100;
  const pctBust = sessions.filter(r => r.finalBankroll < 1000).length / n * 100;
  const meanMaxDD = sessions.reduce((s, r) => s + r.maxDrawdown, 0) / n;
  const meanHands = sessions.reduce((s, r) => s + r.handCount, 0) / n;
  const totalSbfBets = sessions.reduce((s, r) => s + r.sbfBets, 0);
  const totalSbfWins = sessions.reduce((s, r) => s + r.sbfWins, 0);
  const totalSbfLosses = sessions.reduce((s, r) => s + r.sbfLosses, 0);
  // EV per SBF bet: net bankroll change / total bets (approximation)
  // More precisely: wins pay 0.95 per unit, losses lose 1 per unit
  const totalProfit = sessions.reduce((s, r) => s + (r.finalBankroll - START_BANKROLL), 0);
  // EV per bet = total profit / total bets (rough; bet sizing varies)
  const evPerBet = totalSbfBets > 0 ? totalProfit / totalSbfBets : 0;
  const avgOpps = sessions.reduce((s, r) => s + r.avgOpportunitiesPerShoe, 0) / n;
  const meanPeakBankroll = sessions.reduce((s, r) => s + r.peakBankroll, 0) / n;

  variantResults.push({
    name: variant.name,
    meanBankroll,
    medianBankroll,
    meanPeakBankroll,
    pctStopWin,
    pctProfitable,
    pctBust,
    meanMaxDD,
    meanHands,
    evPerBet,
    avgOpps,
    bestBankroll,
    worstBankroll,
  });

  process.stdout.write(`  Completed: ${variant.name}\n`);
}

// ---- Print results table ----
console.log();
console.log('='.repeat(80));
console.log('RESULTS BY VARIANT');
console.log('='.repeat(80));

function fmt(n, decimals = 0) {
  const fixed = n.toFixed(decimals);
  // Only apply comma grouping to the integer part
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

for (const r of variantResults) {
  console.log();
  console.log(`Variant: ${r.name}`);
  console.log('-'.repeat(60));
  console.log(`  Mean final bankroll:          ${fmt(r.meanBankroll, 1)} units`);
  console.log(`  Median final bankroll:        ${fmt(r.medianBankroll, 1)} units`);
  console.log(`  % hit stop-win (+15%):        ${fmt(r.pctStopWin, 2)}%`);
  console.log(`  % profitable (> 10,000):      ${fmt(r.pctProfitable, 2)}%`);
  console.log(`  % severely depleted (<1,000): ${fmt(r.pctBust, 2)}%`);
  console.log(`  Mean peak bankroll:           ${fmt(r.meanPeakBankroll, 1)} units`)
  console.log(`  Mean max drawdown:            ${fmt(r.meanMaxDD, 1)} units`);
  console.log(`  Mean hands played:            ${fmt(r.meanHands, 1)}`);
  console.log(`  EV per SBF bet (units):       ${fmt(r.evPerBet, 4)}`);
  console.log(`  Avg SBF opps / shoe:          ${fmt(r.avgOpps, 3)}`);
  console.log(`  Best single sim:              ${fmt(r.bestBankroll, 1)} units`);
  console.log(`  Worst single sim:             ${fmt(r.worstBankroll, 1)} units`);
}

// ---- Summary comparison table ----
console.log();
console.log('='.repeat(140));
console.log('COMPARISON TABLE');
console.log('='.repeat(140));
const cols = [
  'Variant',
  'Mean BR',
  'Median BR',
  'StopWin%',
  'Profit%',
  'Bust%',
  'Avg DD',
  'Avg Hands',
  'EV/Bet',
  'Opps/Shoe',
  'Best',
  'Worst',
];
const colWidths = [36, 10, 10, 10, 10, 10, 10, 12, 10, 12, 10, 10];
function padEnd(s, len) { return String(s).padEnd(len); }
function padStart(s, len) { return String(s).padStart(len); }

let header = '';
cols.forEach((c, i) => { header += padEnd(c, colWidths[i]); });
console.log(header);
console.log('-'.repeat(140));

for (const r of variantResults) {
  let row = '';
  const vals = [
    r.name,
    fmt(r.meanBankroll, 0),
    fmt(r.medianBankroll, 0),
    fmt(r.pctStopWin, 1) + '%',
    fmt(r.pctProfitable, 1) + '%',
    fmt(r.pctBust, 1) + '%',
    fmt(r.meanMaxDD, 0),
    fmt(r.meanHands, 0),
    fmt(r.evPerBet, 3),
    fmt(r.avgOpps, 2),
    fmt(r.bestBankroll, 0),
    fmt(r.worstBankroll, 0),
  ];
  vals.forEach((v, i) => { row += padEnd(v, colWidths[i]); });
  console.log(row);
}

// ============================================================
// Double Confirmation premise test
// ============================================================

console.log();
console.log('='.repeat(80));
console.log('DOUBLE CONFIRMATION PREMISE TEST (200,000 shoe simulations)');
console.log('='.repeat(80));
console.log();
console.log('Question: After 3+P streak → 2 consecutive Banker wins,');
console.log('what is the Banker win rate on the NEXT hand?');
console.log();

const premiseData = testDoubleConfirmationPremise(200000);

console.log(`Baseline Banker rate (all non-tie hands): ${(premiseData.baseline * 100).toFixed(4)}%`);
console.log();

const streakBuckets = [3, 4, 5, 6, 7, 8, 10];

// Single confirm summary
let scTotalB = 0, scTotalP = 0;
streakBuckets.forEach(s => {
  scTotalB += premiseData.single[s].banker;
  scTotalP += premiseData.single[s].player;
});
const scOverall = scTotalB + scTotalP > 0 ? scTotalB / (scTotalB + scTotalP) : 0;

// Double confirm summary
let dcTotalB = 0, dcTotalP = 0;
streakBuckets.forEach(s => {
  dcTotalB += premiseData.double[s].banker;
  dcTotalP += premiseData.double[s].player;
});
const dcOverall = dcTotalB + dcTotalP > 0 ? dcTotalB / (dcTotalB + dcTotalP) : 0;

console.log(`Single Confirmation overall banker rate: ${(scOverall * 100).toFixed(4)}%`);
console.log(`Double Confirmation overall banker rate: ${(dcOverall * 100).toFixed(4)}%`);
console.log();
console.log(`Improvement from Single→Double Confirm: ${((dcOverall - scOverall) * 100).toFixed(4)} percentage points`);
console.log();

// Per-streak breakdown
console.log('Win rate breakdown by preceding Player streak length:');
console.log();
const hdr = padEnd('Streak', 10) + padEnd('Single Confirm (n)', 22) + padEnd('SC Banker%', 14) + padEnd('Double Confirm (n)', 22) + padEnd('DC Banker%', 14) + 'Delta';
console.log(hdr);
console.log('-'.repeat(90));

for (const s of streakBuckets) {
  const sc = premiseData.single[s];
  const dc = premiseData.double[s];
  const scN = sc.banker + sc.player;
  const dcN = dc.banker + dc.player;
  const scRate = scN > 0 ? sc.banker / scN : 0;
  const dcRate = dcN > 0 ? dc.banker / dcN : 0;
  const delta = dcRate - scRate;
  const label = s === 10 ? '10+' : String(s);
  console.log(
    padEnd(label, 10) +
    padEnd(`${scN.toLocaleString()}`, 22) +
    padEnd(`${(scRate * 100).toFixed(4)}%`, 14) +
    padEnd(`${dcN.toLocaleString()}`, 22) +
    padEnd(`${(dcRate * 100).toFixed(4)}%`, 14) +
    `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(4)}%`
  );
}

console.log();
console.log('='.repeat(80));
console.log('ANALYSIS NOTES');
console.log('='.repeat(80));
console.log();
console.log('Double Confirmation logic:');
console.log('  - Requires 2 consecutive banker wins after the 3+ player streak');
console.log('  - Any player win during confirmations resets the pattern entirely');
console.log('  - Fewer opportunities per shoe (more conditions to satisfy)');
console.log('  - Higher "confirmation bias" — but does the extra filter actually improve win rate?');
console.log();
console.log('Stop-Loss per shoe:');
console.log('  - After 3 consecutive SBF losses in one shoe, sit out rest of that shoe');
console.log('  - Bet sizing carries forward (no reset) to preserve half-martingale state');
console.log('  - Goal: limit drawdown within a single bad shoe');
console.log();
console.log('Stop-Win at +15%:');
console.log('  - Session ends immediately upon reaching 11,500 units');
console.log('  - NOTE: Stop-Win NEVER triggers in this simulation');
console.log('  - The ÷3 win-drop sizing keeps individual bets very small');
console.log('  - Even after 5,000 hands, peak bankrolls only reach ~10,200-10,400 units');
console.log('  - To reach +15%, the strategy would need far less aggressive bet reduction');
console.log('  - Or the stop-win target should be set much lower (e.g., +2-3% = 10,200-10,300)');
console.log();
