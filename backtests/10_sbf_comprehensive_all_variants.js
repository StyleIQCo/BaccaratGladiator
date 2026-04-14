'use strict';

// ============================================================
// COMPREHENSIVE SBF BACKTEST
// EZ Baccarat, 8-deck shoe, 10,000 sims × 5,000 hands
// ============================================================

const NUM_SIMS = 10000;
const HANDS_PER_SIM = 5000;
const STARTING_BANKROLL = 10000;
const STARTING_BET = 100;
const STOP_WIN_DEFAULT = 10150; // +1.5%
const KELLY_CAP = 0.05;
const MIN_BET = 1;
const RESHUFFLE_AT = 14;
const NUM_DECKS = 8;

// ---- Shoe helpers -----------------------------------------------

function buildShoe() {
  const shoe = [];
  const values = [1,2,3,4,5,6,7,8,9,10,10,10,10]; // A,2-9,10,J,Q,K
  for (let d = 0; d < NUM_DECKS; d++) {
    for (let s = 0; s < 4; s++) {
      for (const v of values) shoe.push(v);
    }
  }
  return shoe;
}

function shuffleShoe(shoe) {
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
}

function baccPoint(v) { return v % 10; }

// Deal one hand of EZ baccarat.
// Returns { result: 'B'|'P'|'T', dragon7: bool, bankerNatural: bool, playerNatural: bool }
function dealHand(shoe, idx) {
  // idx is current position in shoe
  const p1 = shoe[idx];
  const b1 = shoe[idx+1];
  const p2 = shoe[idx+2];
  const b2 = shoe[idx+3];
  let used = 4;

  let pTotal = baccPoint(p1 + p2);
  let bTotal = baccPoint(b1 + b2);

  const playerNatural = pTotal >= 8;
  const bankerNatural = bTotal >= 8;

  let p3 = null, b3 = null;

  if (!playerNatural && !bankerNatural) {
    // Player draw rule
    if (pTotal <= 5) {
      p3 = shoe[idx + used];
      used++;
      pTotal = baccPoint(pTotal + p3);
    }
    // Banker draw rule
    if (p3 === null) {
      // Player stood
      if (bTotal <= 5) {
        b3 = shoe[idx + used];
        used++;
        bTotal = baccPoint(bTotal + b3);
      }
    } else {
      // Player drew
      const p3v = baccPoint(p3);
      let bankerDraw = false;
      if (bTotal <= 2) bankerDraw = true;
      else if (bTotal === 3 && p3v !== 8) bankerDraw = true;
      else if (bTotal === 4 && p3v >= 2 && p3v <= 7) bankerDraw = true;
      else if (bTotal === 5 && p3v >= 4 && p3v <= 7) bankerDraw = true;
      else if (bTotal === 6 && p3v >= 6 && p3v <= 7) bankerDraw = true;
      if (bankerDraw) {
        b3 = shoe[idx + used];
        used++;
        bTotal = baccPoint(bTotal + b3);
      }
    }
  }

  let result;
  if (pTotal > bTotal) result = 'P';
  else if (bTotal > pTotal) result = 'B';
  else result = 'T';

  // Dragon 7: banker wins with exactly 3 cards totaling 7
  const dragon7 = (result === 'B' && b3 !== null && bTotal === 7);

  return { result, dragon7, bankerNatural: bankerNatural && result === 'B', playerNatural: playerNatural && result === 'P', used };
}

// ---- Bet sizing -------------------------------------------------

function nextBet(currentBet, won, bankroll) {
  let bet;
  if (won) {
    bet = Math.max(MIN_BET, Math.round(currentBet / 3));
  } else {
    bet = Math.round(currentBet * 1.5);
  }
  // Kelly cap
  const kellyCap = Math.max(MIN_BET, Math.floor(bankroll * KELLY_CAP));
  bet = Math.min(bet, kellyCap);
  bet = Math.max(bet, MIN_BET);
  return bet;
}

// ============================================================
// CORE SIMULATION ENGINE
// ============================================================

/**
 * Run one session.
 *
 * opts:
 *   confirmDepth       - how many consecutive banker wins needed after P streak (default 1)
 *   minPlayerStreak    - minimum player streak to trigger (default 3)
 *   naturalFilterMode  - 'none' | 'last' (last confirmation must be natural)
 *   stopWinTarget      - absolute bankroll stop-win (default STOP_WIN_DEFAULT)
 *   resetBetPerShoe    - bool, reset bet to STARTING_BET on new shoe
 *   reverseMode        - bool, mirror: 3+B streak → P confirmations → bet P
 */
function runSession(opts = {}) {
  const confirmDepth    = opts.confirmDepth    || 1;
  const minStreak       = opts.minStreak       || 3;
  const naturalFilter   = opts.naturalFilter   || false; // last confirmation must be natural
  const stopWinTarget   = opts.stopWinTarget   !== undefined ? opts.stopWinTarget : STOP_WIN_DEFAULT;
  const resetBetPerShoe = opts.resetBetPerShoe || false;
  const reverseMode     = opts.reverseMode     || false;

  const sessionStart = STARTING_BANKROLL;
  let bankroll = sessionStart;
  let handsPlayed = 0;
  let maxBankroll = bankroll;
  let maxDrawdown = 0;
  let totalBets = 0;
  let totalBetUnits = 0;
  let totalWonUnits = 0;
  let opportunities = 0;
  let bankerWins = 0; // wins on the bet hand (or player wins in reverse mode)
  let hitStopWin = false;

  // State machine
  let primaryStreak = 0;   // P (or B in reverse) streak
  let confirmCount  = 0;   // B (or P in reverse) confirmations
  let inSetup       = false;
  let lastConfirmNatural = false;
  let currentBet = STARTING_BET;
  let consecutiveSBFLosses = 0;
  let sittingOut = false;
  let shoesPlayed = 0;

  const shoe = buildShoe();
  shuffleShoe(shoe);
  let shoeIdx = 0;

  const TRIGGER_RESULT  = reverseMode ? 'B' : 'P';
  const CONFIRM_RESULT  = reverseMode ? 'P' : 'B';

  for (let h = 0; h < HANDS_PER_SIM; h++) {
    // Reshuffle check
    if (shoeIdx + RESHUFFLE_AT >= shoe.length) {
      shuffleShoe(shoe);
      shoeIdx = 0;
      shoesPlayed++;
      if (resetBetPerShoe) currentBet = STARTING_BET;
      // Reset setup state on new shoe
      primaryStreak = 0;
      confirmCount  = 0;
      inSetup       = false;
      sittingOut    = false; // new shoe resets sit-out
    }

    handsPlayed++;

    const hand = dealHand(shoe, shoeIdx);
    shoeIdx += hand.used;
    const result = hand.result;

    // Ties: push on main bets, don't change streaks, don't affect setup
    if (result === 'T') continue;

    if (sittingOut) {
      // Still advance streaks silently
      if (result === TRIGGER_RESULT) {
        primaryStreak++;
        confirmCount = 0;
        inSetup = false;
      } else if (result === CONFIRM_RESULT) {
        if (inSetup || primaryStreak >= minStreak) {
          // don't actually do anything while sitting out
        }
        primaryStreak = 0;
        if (!inSetup) confirmCount = 0;
      }
      continue;
    }

    // ---- State machine ----
    if (!inSetup) {
      if (result === TRIGGER_RESULT) {
        primaryStreak++;
        if (primaryStreak >= minStreak) {
          inSetup = true;
          confirmCount = 0;
        }
      } else {
        // CONFIRM_RESULT but no setup active
        primaryStreak = 0;
        confirmCount  = 0;
      }
    } else {
      // In setup — looking for confirmations
      if (result === CONFIRM_RESULT) {
        confirmCount++;
        // Track if this confirmation was a natural (relevant only for naturalFilter)
        if (naturalFilter) {
          // In reverse mode "natural" means player natural; in normal mode banker natural
          lastConfirmNatural = reverseMode ? hand.playerNatural : hand.bankerNatural;
        }

        if (confirmCount >= confirmDepth) {
          // Ready to bet!
          opportunities++;

          // Natural filter check
          if (naturalFilter && !lastConfirmNatural) {
            // Skip and full reset
            primaryStreak = 0;
            confirmCount  = 0;
            inSetup       = false;
            continue;
          }

          // ---- Place bet ----
          const betAmount = Math.min(currentBet, Math.max(MIN_BET, Math.floor(bankroll * KELLY_CAP)));
          const actualBet = Math.max(MIN_BET, betAmount);
          totalBets++;
          totalBetUnits += actualBet;

          // Next hand result
          if (shoeIdx + RESHUFFLE_AT >= shoe.length) {
            // Reshuffle before bet hand
            shuffleShoe(shoe);
            shoeIdx = 0;
            shoesPlayed++;
            if (resetBetPerShoe) currentBet = STARTING_BET;
            primaryStreak = 0;
            confirmCount  = 0;
            inSetup       = false;
            sittingOut    = false;
            continue;
          }

          handsPlayed++;
          const betHand = dealHand(shoe, shoeIdx);
          shoeIdx += betHand.used;
          const betResult = betHand.result;

          if (betResult === 'T') {
            // Tie = push, don't change bet, don't count as SBF loss, reset setup
            primaryStreak = 0;
            confirmCount  = 0;
            inSetup       = false;
            continue;
          }

          const betOnResult = reverseMode ? 'P' : 'B';
          let won;
          if (reverseMode) {
            won = betResult === 'P';
          } else {
            // EZ Baccarat: Dragon 7 = push on banker bet
            if (betHand.dragon7) {
              // Push — treat like tie for SBF purposes
              primaryStreak = 0;
              confirmCount  = 0;
              inSetup       = false;
              continue;
            }
            won = betResult === 'B';
          }

          if (won) {
            bankerWins++;
            // EZ baccarat: banker pays even money (no 5% commission)
            bankroll += actualBet;
            totalWonUnits += actualBet;
            consecutiveSBFLosses = 0;
          } else {
            bankroll -= actualBet;
            totalWonUnits -= actualBet;
            consecutiveSBFLosses++;
          }

          currentBet = nextBet(currentBet, won, bankroll);

          // Track drawdown
          if (bankroll > maxBankroll) maxBankroll = bankroll;
          const dd = maxBankroll - bankroll;
          if (dd > maxDrawdown) maxDrawdown = dd;

          // Stop-loss: 3 consecutive SBF losses → sit out rest of shoe
          if (consecutiveSBFLosses >= 3) {
            sittingOut = true;
          }

          // Stop-win
          if (bankroll >= stopWinTarget) {
            hitStopWin = true;
            handsPlayed++; // approximate
            break;
          }

          // Ruin check
          if (bankroll <= 0) {
            bankroll = 0;
            break;
          }

          // Reset setup after bet
          primaryStreak = 0;
          confirmCount  = 0;
          inSetup       = false;

        }
        // else: still confirming, stay inSetup
      } else {
        // TRIGGER_RESULT appeared — reset entirely
        primaryStreak = 1;
        confirmCount  = 0;
        inSetup       = (primaryStreak >= minStreak);
      }
    }
  }

  const evPerBet = totalBets > 0 ? totalWonUnits / totalBets : 0;
  const winRate  = totalBets > 0 ? bankerWins / totalBets : 0;

  return {
    finalBankroll: bankroll,
    handsPlayed,
    maxDrawdown,
    hitStopWin,
    opportunities,
    totalBets,
    bankerWins,
    winRate,
    evPerBet,
  };
}

// ============================================================
// RUNNER — aggregate N sessions
// ============================================================

function runSims(n, opts) {
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(runSession(opts));
  }
  results.sort((a, b) => a.finalBankroll - b.finalBankroll);

  const finals = results.map(r => r.finalBankroll);
  const mean = finals.reduce((s, v) => s + v, 0) / n;
  const median = finals[Math.floor(n / 2)];
  const profitable = results.filter(r => r.finalBankroll > STARTING_BANKROLL).length / n * 100;
  const hitSW = results.filter(r => r.hitStopWin).length / n * 100;
  const meanDD = results.reduce((s, r) => s + r.maxDrawdown, 0) / n;
  const avgOpp = results.reduce((s, r) => s + r.opportunities, 0) / n;
  const avgHands = results.reduce((s, r) => s + r.handsPlayed, 0) / n;
  const totalBets = results.reduce((s, r) => s + r.totalBets, 0);
  const totalBankerWins = results.reduce((s, r) => s + r.bankerWins, 0);
  const winRate = totalBets > 0 ? totalBankerWins / totalBets : 0;
  const evPerBet = results.reduce((s, r) => s + r.evPerBet, 0) / n;

  return { mean, median, profitable, hitSW, meanDD, avgOpp, avgHands, winRate, evPerBet, n };
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function fmt(v, decimals = 2) {
  return v.toFixed(decimals);
}

function pct(v, decimals = 1) {
  return (v * 100).toFixed(decimals) + '%';
}

function row(...cells) {
  return '| ' + cells.map(c => String(c).padEnd(20)).join(' | ') + ' |';
}

function header(...cells) {
  const r = row(...cells);
  const sep = '|-' + cells.map(() => '-'.repeat(20)).join('-|-') + '-|';
  return r + '\n' + sep;
}

function verdict(mean, baseline) {
  const diff = mean - baseline;
  if (Math.abs(diff) < 10) return 'SAME';
  return diff > 0 ? `BETTER (+${fmt(diff)})` : `WORSE (${fmt(diff)})`;
}

// ============================================================
// MAIN
// ============================================================

console.log('');
console.log('='.repeat(80));
console.log('  COMPREHENSIVE SBF BACKTEST');
console.log(`  ${NUM_SIMS.toLocaleString()} simulations × ${HANDS_PER_SIM.toLocaleString()} hands`);
console.log('  EZ Baccarat — 8 decks — 97% penetration');
console.log('='.repeat(80));
console.log('');

const startTime = Date.now();

// ============================================================
// PART 1 — CONFIRMATION DEPTH TEST
// ============================================================

console.log('━'.repeat(80));
console.log('PART 1 — CONFIRMATION DEPTH TEST (2nd through 6th Banker)');
console.log('━'.repeat(80));
console.log('');

const depths = [
  { label: '2nd Banker (1 confirm)', confirmDepth: 1 },
  { label: '3rd Banker (2 confirm)', confirmDepth: 2 },
  { label: '4th Banker (3 confirm)', confirmDepth: 3 },
  { label: '5th Banker (4 confirm)', confirmDepth: 4 },
  { label: '6th Banker (5 confirm)', confirmDepth: 5 },
];

const part1Results = {};

for (const d of depths) {
  process.stdout.write(`  Running ${d.label}...`);
  const r = runSims(NUM_SIMS, { confirmDepth: d.confirmDepth });
  part1Results[d.label] = r;
  console.log(` done. Mean BR: ${fmt(r.mean)}`);
}

console.log('');
console.log(header('Variant', 'Mean BR', 'Median BR', '% Profit', '% Hit SW', 'Mean Max DD', 'Avg Opp/Shoe'));
for (const d of depths) {
  const r = part1Results[d.label];
  // avg opportunities per shoe: we need avg hands to estimate shoes
  const avgOppPerShoe = (r.avgOpp / (r.avgHands / 80)).toFixed(1); // ~80 non-tie hands per shoe
  console.log(row(
    d.label,
    fmt(r.mean),
    fmt(r.median),
    fmt(r.profitable, 1) + '%',
    fmt(r.hitSW, 1) + '%',
    fmt(r.meanDD),
    avgOppPerShoe,
  ));
}

console.log('');
console.log(header('Variant', 'Banker Win Rate', 'EV per Bet', 'Avg Hands', 'Avg Bets'));
const baselineWinRate = part1Results['2nd Banker (1 confirm)'].winRate;
for (const d of depths) {
  const r = part1Results[d.label];
  console.log(row(
    d.label,
    pct(r.winRate, 2),
    fmt(r.evPerBet, 3),
    fmt(r.avgHands, 0),
    'N/A',
  ));
}

const baselineMean = part1Results['2nd Banker (1 confirm)'].mean;
console.log('');
console.log('  Baseline (2nd Banker) mean BR:', fmt(baselineMean));
console.log('  Verdicts:');
for (const d of depths) {
  if (d.label === '2nd Banker (1 confirm)') continue;
  const r = part1Results[d.label];
  console.log(`    ${d.label}: ${verdict(r.mean, baselineMean)}`);
}

console.log('');
console.log('  Does deeper confirmation improve actual banker win rate on the BET hand?');
for (const d of depths) {
  const r = part1Results[d.label];
  const delta = (r.winRate - baselineWinRate) * 100;
  console.log(`    ${d.label}: ${pct(r.winRate, 2)}  (delta vs baseline: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp)`);
}

// ============================================================
// PART 2A — NATURAL FILTER
// ============================================================

console.log('');
console.log('━'.repeat(80));
console.log('PART 2A — NATURAL FILTER (last confirm must be a natural)');
console.log('━'.repeat(80));
console.log('');

process.stdout.write('  Running Natural Filter...');
const r2a = runSims(NUM_SIMS, { confirmDepth: 1, naturalFilter: true });
console.log(` done. Mean BR: ${fmt(r2a.mean)}`);

const r2aBase = part1Results['2nd Banker (1 confirm)'];

console.log('');
console.log(header('Variant', 'Mean BR', 'Median BR', '% Profit', '% Hit SW', 'Win Rate', 'EV/Bet', 'Avg Opp'));
console.log(row('Baseline (2nd B)', fmt(r2aBase.mean), fmt(r2aBase.median), fmt(r2aBase.profitable,1)+'%', fmt(r2aBase.hitSW,1)+'%', pct(r2aBase.winRate,2), fmt(r2aBase.evPerBet,3), fmt(r2aBase.avgOpp,1)));
console.log(row('Natural Filter',   fmt(r2a.mean),     fmt(r2a.median),     fmt(r2a.profitable,1)+'%', fmt(r2a.hitSW,1)+'%',     pct(r2a.winRate,2),     fmt(r2a.evPerBet,3),     fmt(r2a.avgOpp,1)));
console.log('');
console.log(`  Verdict: ${verdict(r2a.mean, r2aBase.mean)} vs baseline`);
console.log(`  Note: Natural filter reduces opportunities by ${fmt((1 - r2a.avgOpp / r2aBase.avgOpp) * 100, 1)}%`);

// ============================================================
// PART 2B — MINIMUM STREAK THRESHOLD
// ============================================================

console.log('');
console.log('━'.repeat(80));
console.log('PART 2B — MINIMUM PLAYER STREAK THRESHOLD');
console.log('━'.repeat(80));
console.log('');

const streakLevels = [3, 4, 5, 6, 7];
const streakResults = {};

for (const s of streakLevels) {
  process.stdout.write(`  Running minStreak=${s}...`);
  const r = runSims(NUM_SIMS, { confirmDepth: 1, minStreak: s });
  streakResults[s] = r;
  console.log(` done. Mean BR: ${fmt(r.mean)}`);
}

console.log('');
console.log(header('Min Streak', 'Mean BR', 'Median BR', '% Profit', '% Hit SW', 'Win Rate', 'EV/Bet', 'Avg Opp'));
for (const s of streakLevels) {
  const r = streakResults[s];
  const label = s === 3 ? `${s} (baseline)` : String(s);
  console.log(row(label, fmt(r.mean), fmt(r.median), fmt(r.profitable,1)+'%', fmt(r.hitSW,1)+'%', pct(r.winRate,2), fmt(r.evPerBet,3), fmt(r.avgOpp,1)));
}

const baseStreak = streakResults[3].mean;
console.log('');
console.log('  Verdicts vs streak-3 baseline:');
for (const s of streakLevels) {
  if (s === 3) continue;
  console.log(`    minStreak=${s}: ${verdict(streakResults[s].mean, baseStreak)}`);
}

// ============================================================
// PART 2C — ADAPTIVE STOP-WIN TARGETS
// ============================================================

console.log('');
console.log('━'.repeat(80));
console.log('PART 2C — ADAPTIVE STOP-WIN TARGETS');
console.log('━'.repeat(80));
console.log('');

const swTargets = [
  { label: '+1%',   target: STARTING_BANKROLL * 1.01 },
  { label: '+1.5%', target: STARTING_BANKROLL * 1.015 },
  { label: '+2%',   target: STARTING_BANKROLL * 1.02 },
  { label: '+3%',   target: STARTING_BANKROLL * 1.03 },
  { label: '+5%',   target: STARTING_BANKROLL * 1.05 },
  { label: '+10%',  target: STARTING_BANKROLL * 1.10 },
];

// For adaptive stop-win we need session-level data
function runSimsWithSW(n, swTarget) {
  const hitFinals = [];
  const missFinals = [];
  let hitCount = 0;

  for (let i = 0; i < n; i++) {
    const r = runSession({ confirmDepth: 1, stopWinTarget: swTarget });
    if (r.hitStopWin) {
      hitCount++;
      hitFinals.push(r.finalBankroll);
    } else {
      missFinals.push(r.finalBankroll);
    }
  }

  const allFinals = [...hitFinals, ...missFinals];
  allFinals.sort((a, b) => a - b);
  const mean = allFinals.reduce((s, v) => s + v, 0) / n;
  const hitMean = hitFinals.length > 0 ? hitFinals.reduce((s, v) => s + v, 0) / hitFinals.length : 0;
  const missMean = missFinals.length > 0 ? missFinals.reduce((s, v) => s + v, 0) / missFinals.length : 0;

  return {
    hitPct: hitCount / n * 100,
    mean,
    hitMean,
    missMean,
    n,
  };
}

const swResults = {};
for (const sw of swTargets) {
  process.stdout.write(`  Running stop-win ${sw.label}...`);
  const r = runSimsWithSW(NUM_SIMS, sw.target);
  swResults[sw.label] = r;
  console.log(` done. Hit rate: ${fmt(r.hitPct, 1)}%`);
}

console.log('');
console.log(header('Stop-Win', '% Hit SW', 'Overall Mean BR', 'Mean BR (hit)', 'Mean BR (miss)'));
for (const sw of swTargets) {
  const r = swResults[sw.label];
  const label = sw.label === '+1.5%' ? `${sw.label} (base)` : sw.label;
  console.log(row(label, fmt(r.hitPct,1)+'%', fmt(r.mean), fmt(r.hitMean), fmt(r.missMean)));
}

const baseSW = swResults['+1.5%'];
console.log('');
console.log('  Verdicts vs +1.5% baseline:');
for (const sw of swTargets) {
  if (sw.label === '+1.5%') continue;
  console.log(`    ${sw.label}: ${verdict(swResults[sw.label].mean, baseSW.mean)}`);
}

// ============================================================
// PART 2D — BET RESET ON NEW SHOE
// ============================================================

console.log('');
console.log('━'.repeat(80));
console.log('PART 2D — BET RESET ON NEW SHOE');
console.log('━'.repeat(80));
console.log('');

process.stdout.write('  Running carry-forward (baseline)...');
const r2dCarry = runSims(NUM_SIMS, { confirmDepth: 1, resetBetPerShoe: false });
console.log(` done. Mean BR: ${fmt(r2dCarry.mean)}`);

process.stdout.write('  Running reset-per-shoe...');
const r2dReset = runSims(NUM_SIMS, { confirmDepth: 1, resetBetPerShoe: true });
console.log(` done. Mean BR: ${fmt(r2dReset.mean)}`);

console.log('');
console.log(header('Variant', 'Mean BR', 'Median BR', '% Profit', '% Hit SW', 'Mean Max DD', 'Win Rate', 'EV/Bet'));
console.log(row('Carry-Forward (base)', fmt(r2dCarry.mean), fmt(r2dCarry.median), fmt(r2dCarry.profitable,1)+'%', fmt(r2dCarry.hitSW,1)+'%', fmt(r2dCarry.meanDD), pct(r2dCarry.winRate,2), fmt(r2dCarry.evPerBet,3)));
console.log(row('Reset per Shoe',       fmt(r2dReset.mean), fmt(r2dReset.median), fmt(r2dReset.profitable,1)+'%', fmt(r2dReset.hitSW,1)+'%', fmt(r2dReset.meanDD), pct(r2dReset.winRate,2), fmt(r2dReset.evPerBet,3)));
console.log('');
console.log(`  Verdict: ${verdict(r2dReset.mean, r2dCarry.mean)} vs carry-forward baseline`);

// ============================================================
// PART 2E — REVERSE SBF (3+ Banker → Player confirmations → Bet Player)
// ============================================================

console.log('');
console.log('━'.repeat(80));
console.log('PART 2E — REVERSE SBF (3+ Banker streak → Player confirm → Bet Player)');
console.log('━'.repeat(80));
console.log('');

process.stdout.write('  Running Reverse SBF...');
const r2e = runSims(NUM_SIMS, { confirmDepth: 1, reverseMode: true });
console.log(` done. Mean BR: ${fmt(r2e.mean)}`);

const r2eBase = part1Results['2nd Banker (1 confirm)'];

console.log('');
console.log(header('Variant', 'Mean BR', 'Median BR', '% Profit', '% Hit SW', 'Win Rate on Bet', 'EV/Bet', 'Avg Opp'));
console.log(row('SBF (Bet Banker)', fmt(r2eBase.mean), fmt(r2eBase.median), fmt(r2eBase.profitable,1)+'%', fmt(r2eBase.hitSW,1)+'%', pct(r2eBase.winRate,2), fmt(r2eBase.evPerBet,3), fmt(r2eBase.avgOpp,1)));
console.log(row('Reverse (Bet Player)', fmt(r2e.mean), fmt(r2e.median), fmt(r2e.profitable,1)+'%', fmt(r2e.hitSW,1)+'%', pct(r2e.winRate,2), fmt(r2e.evPerBet,3), fmt(r2e.avgOpp,1)));
console.log('');
console.log(`  SBF banker win rate on bet hand:  ${pct(r2eBase.winRate, 3)}`);
console.log(`  Reverse player win rate on bet hand: ${pct(r2e.winRate, 3)}`);
const delta = (r2e.winRate - r2eBase.winRate) * 100;
console.log(`  Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} pp`);
console.log(`  Verdict: Reverse SBF is ${verdict(r2e.mean, r2eBase.mean)} vs regular SBF`);

// ============================================================
// SUMMARY
// ============================================================

console.log('');
console.log('='.repeat(80));
console.log('  FINAL SUMMARY — BEST CONFIGURATION RECOMMENDATIONS');
console.log('='.repeat(80));
console.log('');

// Find best depth
const bestDepth = depths.reduce((best, d) => {
  return part1Results[d.label].mean > part1Results[best.label].mean ? d : best;
}, depths[0]);

// Find best streak
const bestStreakKey = streakLevels.reduce((best, s) => streakResults[s].mean > streakResults[best].mean ? s : best, streakLevels[0]);

// Find best SW
const bestSW = swTargets.reduce((best, sw) => swResults[sw.label].mean > swResults[best.label].mean ? sw : best, swTargets[0]);

console.log(`  Part 1 — Best confirmation depth: ${bestDepth.label}`);
console.log(`    Mean BR: ${fmt(part1Results[bestDepth.label].mean)} vs baseline ${fmt(baselineMean)}`);
console.log('');
console.log(`  Part 2A — Natural Filter: ${verdict(r2a.mean, r2aBase.mean)}`);
console.log(`    Mean BR: ${fmt(r2a.mean)} vs baseline ${fmt(r2aBase.mean)}`);
console.log('');
console.log(`  Part 2B — Best min streak: ${bestStreakKey}`);
console.log(`    Mean BR: ${fmt(streakResults[bestStreakKey].mean)} vs baseline (3) ${fmt(streakResults[3].mean)}`);
console.log('');
console.log(`  Part 2C — Best stop-win target: ${bestSW.label}`);
console.log(`    Mean BR: ${fmt(swResults[bestSW.label].mean)} vs baseline (+1.5%) ${fmt(baseSW.mean)}`);
console.log('');
console.log(`  Part 2D — Bet reset per shoe: ${verdict(r2dReset.mean, r2dCarry.mean)}`);
console.log(`    Mean BR: ${fmt(r2dReset.mean)} vs carry-forward ${fmt(r2dCarry.mean)}`);
console.log('');
console.log(`  Part 2E — Reverse SBF: ${verdict(r2e.mean, r2eBase.mean)}`);
console.log(`    Bet-hand win rate: Banker ${pct(r2eBase.winRate,2)} vs Player ${pct(r2e.winRate,2)}`);

console.log('');
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`  Total runtime: ${elapsed}s`);
console.log('');
