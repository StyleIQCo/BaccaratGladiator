'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// EZ Baccarat: SBF + Card-Counting Dragon 7 / Panda 8 Side-Bet Backtest v2
// Revised: multi-threshold scan to find genuine +EV spots
// 2,000 sims × 10,000 hands | 75% shoe penetration | 8 decks
// ─────────────────────────────────────────────────────────────────────────────

const NUM_SIMS    = 2_000;
const NUM_HANDS   = 10_000;
const START_BNK   = 10_000;
const NUM_DECKS   = 8;
const TOTAL_CARDS = NUM_DECKS * 52;   // 416
const RESHUFFLE_AT = Math.floor(TOTAL_CARDS * 0.75);  // 312

// Side-bet pay tables (EZ Baccarat standard)
const DRAGON7_PAY = 40;  // 40:1
const PANDA8_PAY  = 25;  // 25:1

// True-count thresholds to scan
const SCAN_THRESHOLDS = [4, 6, 8, 10, 12, 15, 20];

// Kelly cap
const KELLY_CAP = 0.05;

// Baseline hit rates (theoretical 8-deck EZ Baccarat)
// Dragon 7: ~2.255 per 1000 hands ≈ 0.2255%
// Panda 8 : ~2.720 per 1000 hands ≈ 0.2720%
const DRAGON7_BASELINE = 0.002255;
const PANDA8_BASELINE  = 0.002720;

// Break-even hit rates
// Dragon 7 pays 40:1 → break-even = 1/41 ≈ 2.4390%
// Panda 8  pays 25:1 → break-even = 1/26 ≈ 3.8462%
const DRAGON7_BREAKEVEN = 1 / (DRAGON7_PAY + 1);
const PANDA8_BREAKEVEN  = 1 / (PANDA8_PAY  + 1);

// ─── Card helpers ─────────────────────────────────────────────────────────────

function cardValue(rank) {
  if (rank >= 10) return 0;
  return rank;
}

function buildShoe() {
  const shoe = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        shoe.push(rank);
      }
    }
  }
  return shoe;
}

function shuffleInPlace(shoe) {
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = shoe[i]; shoe[i] = shoe[j]; shoe[j] = tmp;
  }
}

// ─── Count tags ────────────────────────────────────────────────────────────────

// Dragon 7 running count:
//   7       → -3
//   10/J/Q/K→ +1   (0-value cards)
//   A,2,3,4 → +0.5 (small cards)
//   8,9     → -1
//   5,6     →  0   (neutral)
function getDragonTag(rank) {
  if (rank === 7)             return -3;
  if (rank === 8 || rank === 9) return -1;
  if (rank >= 10)             return  1;    // 10,J,Q,K
  if (rank <= 4)              return  0.5;  // A,2,3,4
  return 0;                                 // 5,6
}

// Panda 8 running count:
//   8       → -3
//   9       → -0.5
//   10/J/Q/K→ +1
//   A,2,3,4 → +0.5
//   5,6,7   →  0
function getPandaTag(rank) {
  if (rank === 8)   return -3;
  if (rank === 9)   return -0.5;
  if (rank >= 10)   return  1;
  if (rank <= 4)    return  0.5;
  return 0;         // 5,6,7
}

// ─── Baccarat drawing rules ───────────────────────────────────────────────────

function handTotal(cards) {
  let s = 0;
  for (let i = 0; i < cards.length; i++) s += cardValue(cards[i]);
  return s % 10;
}

// Returns { playerCards, bankerCards, nextIdx }
function dealHand(shoe, startIdx) {
  let idx = startIdx;
  const p = [shoe[idx++], shoe[idx++]];
  const b = [shoe[idx++], shoe[idx++]];

  const pTotal = handTotal(p);
  const bTotal = handTotal(b);

  // Natural — no third cards
  if (pTotal >= 8 || bTotal >= 8) {
    return { playerCards: p, bankerCards: b, nextIdx: idx };
  }

  // Player third card
  let pThird = null;
  if (pTotal <= 5) {
    pThird = shoe[idx++];
    p.push(pThird);
  }

  const bTotalNow = handTotal(b);

  // Banker drawing
  let bDraws = false;
  if (pThird === null) {
    bDraws = bTotalNow <= 5;
  } else {
    const pv = cardValue(pThird);
    if      (bTotalNow <= 2)                       bDraws = true;
    else if (bTotalNow === 3)                      bDraws = pv !== 8;
    else if (bTotalNow === 4)                      bDraws = pv >= 2 && pv <= 7;
    else if (bTotalNow === 5)                      bDraws = pv >= 4 && pv <= 7;
    else if (bTotalNow === 6)                      bDraws = pv === 6 || pv === 7;
    // 7: stands
  }

  if (bDraws) b.push(shoe[idx++]);

  return { playerCards: p, bankerCards: b, nextIdx: idx };
}

// ─── Outcome ──────────────────────────────────────────────────────────────────

function getOutcome(playerCards, bankerCards) {
  const pTotal = handTotal(playerCards);
  const bTotal = handTotal(bankerCards);

  const isDragon7 = bankerCards.length === 3 && bTotal === 7 && bTotal > pTotal;
  const isPanda8  = playerCards.length  === 3 && pTotal === 8 && pTotal > bTotal;

  let winner;
  if      (pTotal > bTotal) winner = 'player';
  else if (bTotal > pTotal) winner = 'banker';
  else                      winner = 'tie';

  return { winner, isDragon7, isPanda8, pTotal, bTotal };
}

// ─── Single full-shoe pass for threshold scanning ─────────────────────────────
// Returns per-threshold hit statistics for Dragon 7 and Panda 8.
// We scan ALL hands (not just SBF hands) to get maximum statistical power.

function scanShoe(shoe) {
  // Per-threshold accumulators: { triggered, d7hits, p8hits }
  const dragonStats = SCAN_THRESHOLDS.map(() => ({ triggered: 0, d7hits: 0 }));
  const pandaStats  = SCAN_THRESHOLDS.map(() => ({ triggered: 0, p8hits: 0 }));

  let dragonRC = 0, pandaRC = 0;
  let remaining = TOTAL_CARDS;
  let shoeIdx = 0;

  let totalHands = 0, totalD7 = 0, totalP8 = 0;

  // We'll reshuffle at 75% penetration across the full hand count
  // but for the scan we just run through one pass of the shoe.
  // (The main SBF sim handles reshuffling separately.)

  while (shoeIdx + 6 <= shoe.length && shoeIdx < RESHUFFLE_AT) {
    const decksRemaining = remaining / 52;
    if (decksRemaining < 0.5) break;

    const dragonTC = dragonRC / decksRemaining;
    const pandaTC  = pandaRC  / decksRemaining;

    const { playerCards, bankerCards, nextIdx } = dealHand(shoe, shoeIdx);
    shoeIdx = nextIdx;

    // Update counts
    for (const r of playerCards) { dragonRC += getDragonTag(r); pandaRC += getPandaTag(r); remaining--; }
    for (const r of bankerCards) { dragonRC += getDragonTag(r); pandaRC += getPandaTag(r); remaining--; }

    const outcome = getOutcome(playerCards, bankerCards);
    totalHands++;
    if (outcome.isDragon7) totalD7++;
    if (outcome.isPanda8)  totalP8++;

    // Bucket by threshold
    for (let t = 0; t < SCAN_THRESHOLDS.length; t++) {
      if (dragonTC >= SCAN_THRESHOLDS[t]) {
        dragonStats[t].triggered++;
        if (outcome.isDragon7) dragonStats[t].d7hits++;
      }
      if (pandaTC >= SCAN_THRESHOLDS[t]) {
        pandaStats[t].triggered++;
        if (outcome.isPanda8) pandaStats[t].p8hits++;
      }
    }
  }

  return { dragonStats, pandaStats, totalHands, totalD7, totalP8 };
}

// ─── SBF Strategy ─────────────────────────────────────────────────────────────

function initSBF(bankroll) {
  return {
    active:       false,
    playerStreak: 0,
    bankConfirm:  false,
    betSize:      bankroll * 0.02,
  };
}

// ─── Full simulation with a specific TC threshold pair ────────────────────────

function runSim(dragonThreshold, pandaThreshold) {
  const shoe = buildShoe();
  shuffleInPlace(shoe);

  let bankroll    = START_BNK;
  let shoeIdx     = 0;
  let maxBankroll = START_BNK;
  let maxDrawdown = 0;

  let dragonRC = 0, pandaRC = 0;
  let remaining = TOTAL_CARDS;

  const sbf = initSBF(bankroll);

  let sbfHands = 0, sbfProfit = 0;
  let dragonBets = 0, dragonWins = 0, dragonProfit = 0;
  let pandaBets  = 0, pandaWins  = 0, pandaProfit  = 0;

  // Per-threshold tracking (for tables 1/2 — use the single threshold passed in)
  let dTriggered = 0, dTriggeredHits = 0;
  let pTriggered = 0, pTriggeredHits = 0;

  for (let hand = 0; hand < NUM_HANDS; hand++) {
    // Reshuffle at 75% penetration
    if (shoeIdx >= RESHUFFLE_AT || shoeIdx + 6 >= shoe.length) {
      shuffleInPlace(shoe);
      shoeIdx   = 0;
      dragonRC  = 0; pandaRC = 0;
      remaining = TOTAL_CARDS;
    }

    const decksRemaining = remaining / 52;
    let dragonTC = 0, pandaTC = 0;
    if (decksRemaining >= 0.5) {
      dragonTC = dragonRC / decksRemaining;
      pandaTC  = pandaRC  / decksRemaining;
    }

    const { playerCards, bankerCards, nextIdx } = dealHand(shoe, shoeIdx);
    shoeIdx = nextIdx;

    for (const r of playerCards) { dragonRC += getDragonTag(r); pandaRC += getPandaTag(r); remaining--; }
    for (const r of bankerCards) { dragonRC += getDragonTag(r); pandaRC += getPandaTag(r); remaining--; }

    const outcome = getOutcome(playerCards, bankerCards);

    // Update SBF state machine
    if (!sbf.active) {
      if (outcome.winner === 'player') {
        sbf.playerStreak++;
        sbf.bankConfirm = false;
      } else if (outcome.winner === 'banker' && sbf.playerStreak >= 3) {
        sbf.bankConfirm  = true;
        sbf.playerStreak = 0;
        sbf.active       = true;
        sbf.betSize      = bankroll * 0.02;
      } else {
        sbf.playerStreak = 0;
        sbf.bankConfirm  = false;
      }
    }

    if (sbf.active) {
      sbfHands++;

      const rawMain = Math.min(sbf.betSize, bankroll * KELLY_CAP);

      // Side bets
      const betDragon = dragonTC >= dragonThreshold;
      const betPanda  = pandaTC  >= pandaThreshold;

      if (betDragon) { dTriggered++; if (outcome.isDragon7) dTriggeredHits++; }
      if (betPanda)  { pTriggered++; if (outcome.isPanda8)  pTriggeredHits++; }

      const rawD = betDragon ? rawMain / 20 : 0;
      const rawP = betPanda  ? rawMain / 20 : 0;

      // Kelly cap: scale total exposure
      const totalExposure = rawMain + rawD + rawP;
      const cap   = bankroll * KELLY_CAP;
      const scale = totalExposure > cap ? cap / totalExposure : 1.0;

      const sMain = rawMain * scale;
      const sD    = rawD    * scale;
      const sP    = rawP    * scale;

      let handPnl = 0;

      // Main banker bet (EZ: Dragon 7 is a push on main)
      if      (outcome.winner === 'banker' && !outcome.isDragon7) handPnl += sMain;
      else if (outcome.winner === 'player')                       handPnl -= sMain;

      // Dragon 7 side
      if (sD > 0) {
        dragonBets++;
        if (outcome.isDragon7) {
          dragonWins++;
          const g = sD * DRAGON7_PAY;
          dragonProfit += g; handPnl += g;
        } else {
          dragonProfit -= sD; handPnl -= sD;
        }
      }

      // Panda 8 side
      if (sP > 0) {
        pandaBets++;
        if (outcome.isPanda8) {
          pandaWins++;
          const g = sP * PANDA8_PAY;
          pandaProfit += g; handPnl += g;
        } else {
          pandaProfit -= sP; handPnl -= sP;
        }
      }

      sbfProfit += handPnl;
      bankroll  += handPnl;

      // Adjust SBF bet size
      if (outcome.winner === 'banker') {
        sbf.betSize      = Math.max(sbf.betSize / 3, bankroll * 0.005);
        sbf.active       = false;
        sbf.playerStreak = 0;
        sbf.bankConfirm  = false;
      } else if (outcome.winner === 'player') {
        sbf.betSize = Math.min(sbf.betSize * 1.5, bankroll * KELLY_CAP);
      }

      if (bankroll <= 0) { bankroll = 0; break; }
    }

    if (bankroll > maxBankroll) maxBankroll = bankroll;
    const dd = (maxBankroll - bankroll) / maxBankroll;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    finalBankroll: bankroll,
    maxDrawdown,
    sbfHands, sbfProfit,
    dragonBets, dragonWins, dragonProfit,
    pandaBets,  pandaWins,  pandaProfit,
    dTriggered, dTriggeredHits,
    pTriggered, pTriggeredHits,
  };
}

// ─── Aggregate helper ─────────────────────────────────────────────────────────

function agg(results) {
  const n = results.length;
  const finals = results.map(r => r.finalBankroll).slice().sort((a, b) => a - b);
  const mean   = finals.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0 ? (finals[n/2-1] + finals[n/2]) / 2 : finals[Math.floor(n/2)];
  const profitable = results.filter(r => r.finalBankroll > START_BNK).length;
  const busts      = results.filter(r => r.finalBankroll <= 0).length;

  const sum = (fn) => results.reduce((s, r) => s + fn(r), 0);

  const totalSbfH   = sum(r => r.sbfHands);
  const totalSbfP   = sum(r => r.sbfProfit);
  const totalDD     = sum(r => r.maxDrawdown);

  const totalDB     = sum(r => r.dragonBets);
  const totalDW     = sum(r => r.dragonWins);
  const totalDP     = sum(r => r.dragonProfit);

  const totalPB     = sum(r => r.pandaBets);
  const totalPW     = sum(r => r.pandaWins);
  const totalPP     = sum(r => r.pandaProfit);

  const totalDTrig  = sum(r => r.dTriggered);
  const totalDHits  = sum(r => r.dTriggeredHits);
  const totalPTrig  = sum(r => r.pTriggered);
  const totalPHits  = sum(r => r.pTriggeredHits);

  return {
    n, mean, median, profitable, busts,
    evPerHand:       totalSbfH > 0 ? totalSbfP / totalSbfH : 0,
    meanMaxDrawdown: totalDD / n,
    totalSbfH,
    totalDB, totalDW,
    dragonHitRate:   totalDB > 0 ? totalDW / totalDB : 0,
    evPerDragonBet:  totalDB > 0 ? totalDP / totalDB : 0,
    totalPB, totalPW,
    pandaHitRate:    totalPB > 0 ? totalPW / totalPB : 0,
    evPerPandaBet:   totalPB > 0 ? totalPP / totalPB : 0,
    totalDTrig, totalDHits,
    dHitRateWhenTriggered: totalDTrig > 0 ? totalDHits / totalDTrig : 0,
    dTrigPct:        totalSbfH > 0 ? totalDTrig / totalSbfH : 0,
    totalPTrig, totalPHits,
    pHitRateWhenTriggered: totalPTrig > 0 ? totalPHits / totalPTrig : 0,
    pTrigPct:        totalSbfH > 0 ? totalPTrig / totalSbfH : 0,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const pct  = (n, d=2) => (n*100).toFixed(d) + '%';
const fix  = (n, d=4) => (typeof n === 'number' ? n.toFixed(d) : 'N/A');
const thou = (n) => Math.round(n).toLocaleString();

function sep(ch='─', w=100) { console.log(ch.repeat(w)); }

// ─── Phase 1: Threshold scan (pure hit-rate analysis across all hands) ─────────
// Run NUM_SIMS shoes and aggregate per-threshold stats.

function runThresholdScan() {
  process.stdout.write('\nPhase 1: threshold scan across all hands...');

  const dragonAcc = SCAN_THRESHOLDS.map(() => ({ triggered: 0, hits: 0 }));
  const pandaAcc  = SCAN_THRESHOLDS.map(() => ({ triggered: 0, hits: 0 }));
  let totalHands = 0, totalD7 = 0, totalP8 = 0;

  const shoe = buildShoe();

  for (let s = 0; s < NUM_SIMS; s++) {
    shuffleInPlace(shoe);
    const res = scanShoe(shoe);
    totalHands += res.totalHands;
    totalD7    += res.totalD7;
    totalP8    += res.totalP8;
    for (let t = 0; t < SCAN_THRESHOLDS.length; t++) {
      dragonAcc[t].triggered += res.dragonStats[t].triggered;
      dragonAcc[t].hits      += res.dragonStats[t].d7hits;
      pandaAcc[t].triggered  += res.pandaStats[t].triggered;
      pandaAcc[t].hits       += res.pandaStats[t].p8hits;
    }
    if ((s + 1) % 500 === 0) process.stdout.write(` ${s+1}`);
  }
  process.stdout.write(' done\n');

  const actualD7Baseline = totalD7 / totalHands;
  const actualP8Baseline = totalP8 / totalHands;

  return { dragonAcc, pandaAcc, totalHands, actualD7Baseline, actualP8Baseline };
}

// ─── Phase 2: Full SBF sim for best threshold ─────────────────────────────────

function runFullSim(dragonThreshold, pandaThreshold, label) {
  process.stdout.write(`\nPhase 2: full SBF sim (D7 TC>=${dragonThreshold} / P8 TC>=${pandaThreshold}) — ${label}...`);
  const results = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    results.push(runSim(dragonThreshold, pandaThreshold));
  }
  process.stdout.write(' done\n');
  return agg(results);
}

function runBaselineSim() {
  process.stdout.write('\nBaseline: SBF only (no side bets)...');
  const results = [];
  // Use impossibly high threshold so no side bets fire
  for (let s = 0; s < NUM_SIMS; s++) results.push(runSim(9999, 9999));
  process.stdout.write(' done\n');
  return agg(results);
}

// ─── Print Table 1 / Table 2 ──────────────────────────────────────────────────

function printThresholdTable(title, acc, totalHands, baseline, pay, breakeven) {
  console.log();
  sep('═');
  console.log(`  ${title}`);
  sep('═');

  const colW = [8, 14, 14, 14, 10, 14];
  const hdr = [
    'TC >='.padStart(colW[0]),
    '% Hands Trigg'.padStart(colW[1]),
    'Hit Rate'.padStart(colW[2]),
    'Baseline Rate'.padStart(colW[3]),
    'Lift Ratio'.padStart(colW[4]),
    'EV per Bet'.padStart(colW[5]),
  ];
  console.log(hdr.join('  '));
  sep();

  let bestEV = -Infinity, bestThreshold = null;

  for (let t = 0; t < SCAN_THRESHOLDS.length; t++) {
    const thresh = SCAN_THRESHOLDS[t];
    const triggered = acc[t].triggered;
    const hits      = acc[t].hits;

    const trigPct    = triggered / totalHands;
    const hitRate    = triggered > 0 ? hits / triggered : 0;
    const lift       = baseline > 0 ? hitRate / baseline : 0;
    // EV = hitRate * pay - (1 - hitRate) * 1 = hitRate*(pay+1) - 1
    const ev         = hitRate * (pay + 1) - 1;

    const evSign = ev > 0 ? '+' : '';
    const note   = ev > 0 ? ' ← +EV' : (Math.abs(ev - (-1 + breakeven*(pay+1))) < 0.005 ? ' ← near BE' : '');

    console.log(
      thresh.toString().padStart(colW[0]),
      pct(trigPct, 3).padStart(colW[1]),
      pct(hitRate, 4).padStart(colW[2]),
      pct(baseline, 4).padStart(colW[3]),
      lift.toFixed(2).padStart(colW[4]) + 'x',
      (evSign + ev.toFixed(4)).padStart(colW[5]) + note,
    );

    if (ev > bestEV) { bestEV = ev; bestThreshold = thresh; }
  }

  sep();
  console.log(`  Break-even hit rate: ${pct(breakeven, 4)} (1 in ${Math.round(1/breakeven)} bets must win)`);
  console.log(`  Baseline hit rate:   ${pct(baseline, 4)}`);

  const beNeeded = baseline > 0 ? (breakeven / baseline) : Infinity;
  console.log(`  Need ${beNeeded.toFixed(1)}x lift over baseline to break even`);

  return { bestEV, bestThreshold };
}

// ─── Print Table 3 ────────────────────────────────────────────────────────────

function printCombinedTable(baseAgg, combinedAgg, dThresh, pThresh, dBestEV, pBestEV) {
  console.log();
  sep('═');
  console.log('  TABLE 3 — COMBINED STRATEGY vs SBF BASELINE');
  sep('═');

  const posEV = dBestEV > 0 || pBestEV > 0;

  if (!posEV) {
    console.log('  *** NO threshold achieves positive EV for either side bet. ***');
    console.log('  Reporting best available thresholds for reference.');
  } else {
    console.log(`  Using D7 TC>=${dThresh} | P8 TC>=${pThresh}`);
  }

  console.log();

  const rows = [
    ['Metric', 'SBF Baseline', `SBF + Side Bets`],
    ['Mean final bankroll',   thou(baseAgg.mean),   thou(combinedAgg.mean)],
    ['Median final bankroll', thou(baseAgg.median),  thou(combinedAgg.median)],
    ['% Profitable',          pct(baseAgg.profitable/baseAgg.n),  pct(combinedAgg.profitable/combinedAgg.n)],
    ['EV per hand (units)',   fix(baseAgg.evPerHand),  fix(combinedAgg.evPerHand)],
    ['Mean max drawdown',     pct(baseAgg.meanMaxDrawdown),  pct(combinedAgg.meanMaxDrawdown)],
    ['Bust rate',             pct(baseAgg.busts/baseAgg.n),  pct(combinedAgg.busts/combinedAgg.n)],
  ];

  const c0 = 30, c1 = 20, c2 = 20;
  for (const [a, b, c] of rows) {
    console.log('  ' + a.padEnd(c0) + b.padStart(c1) + c.padStart(c2));
  }

  sep();
  console.log('  SIDE BET DETAILS (combined strategy):');
  console.log();

  // Dragon 7
  if (combinedAgg.totalDB > 0) {
    const d = combinedAgg;
    console.log(`  Dragon 7 (TC >= ${dThresh}):`);
    console.log(`    Bets placed:     ${thou(d.totalDB)}`);
    console.log(`    Bets/SBF hand:   ${pct(d.dTrigPct)} of SBF hands`);
    console.log(`    Actual hit rate: ${pct(d.dragonHitRate, 4)}`);
    console.log(`    Break-even rate: ${pct(DRAGON7_BREAKEVEN, 4)}`);
    console.log(`    EV per bet:      ${fix(d.evPerDragonBet)} units (${d.evPerDragonBet > 0 ? '+EV' : '-EV'})`);
  } else {
    console.log(`  Dragon 7: no bets placed at TC >= ${dThresh}`);
  }

  console.log();

  // Panda 8
  if (combinedAgg.totalPB > 0) {
    const d = combinedAgg;
    console.log(`  Panda 8 (TC >= ${pThresh}):`);
    console.log(`    Bets placed:     ${thou(d.totalPB)}`);
    console.log(`    Bets/SBF hand:   ${pct(d.pTrigPct)} of SBF hands`);
    console.log(`    Actual hit rate: ${pct(d.pandaHitRate, 4)}`);
    console.log(`    Break-even rate: ${pct(PANDA8_BREAKEVEN, 4)}`);
    console.log(`    EV per bet:      ${fix(d.evPerPandaBet)} units (${d.evPerPandaBet > 0 ? '+EV' : '-EV'})`);
  } else {
    console.log(`  Panda 8: no bets placed at TC >= ${pThresh}`);
  }
}

// ─── Break-even analysis ──────────────────────────────────────────────────────

function printBreakevenAnalysis(dragonAcc, pandaAcc, totalHands, d7Baseline, p8Baseline) {
  console.log();
  sep('═');
  console.log('  BREAK-EVEN ANALYSIS — Required hit rate lift to become +EV');
  sep('═');

  const beD = DRAGON7_BREAKEVEN;
  const beP = PANDA8_BREAKEVEN;

  console.log(`\n  Dragon 7 — break-even: ${pct(beD, 4)} | baseline: ${pct(d7Baseline, 4)}`);
  console.log(`  Gap to break-even: need ${(beD/d7Baseline).toFixed(1)}x lift`);

  // Find the threshold closest to break-even
  let bestGapD = Infinity, bestTD = null, bestEVD = -Infinity;
  for (let t = 0; t < SCAN_THRESHOLDS.length; t++) {
    const triggered = dragonAcc[t].triggered;
    const hitRate   = triggered > 0 ? dragonAcc[t].hits / triggered : 0;
    const ev        = hitRate * (DRAGON7_PAY + 1) - 1;
    const gap       = Math.abs(hitRate - beD);
    if (ev > bestEVD) { bestEVD = ev; bestTD = SCAN_THRESHOLDS[t]; }
    if (triggered > 0 && gap < bestGapD) { bestGapD = gap; }
  }
  console.log(`  Best EV achieved:  ${fix(bestEVD)} at TC >= ${bestTD} (${bestEVD > 0 ? '+EV ✓' : '-EV, not profitable'})`);

  console.log(`\n  Panda 8 — break-even: ${pct(beP, 4)} | baseline: ${pct(p8Baseline, 4)}`);
  console.log(`  Gap to break-even: need ${(beP/p8Baseline).toFixed(1)}x lift`);

  let bestGapP = Infinity, bestTP = null, bestEVP = -Infinity;
  for (let t = 0; t < SCAN_THRESHOLDS.length; t++) {
    const triggered = pandaAcc[t].triggered;
    const hitRate   = triggered > 0 ? pandaAcc[t].hits / triggered : 0;
    const ev        = hitRate * (PANDA8_PAY + 1) - 1;
    const gap       = Math.abs(hitRate - beP);
    if (ev > bestEVP) { bestEVP = ev; bestTP = SCAN_THRESHOLDS[t]; }
    if (triggered > 0 && gap < bestGapP) { bestGapP = gap; }
  }
  console.log(`  Best EV achieved:  ${fix(bestEVP)} at TC >= ${bestTP} (${bestEVP > 0 ? '+EV ✓' : '-EV, not profitable'})`);

  return {
    bestDragonThreshold: bestTD, bestDragonEV: bestEVD,
    bestPandaThreshold: bestTP, bestPandaEV: bestEVP,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(function main() {
  console.log();
  sep('═');
  console.log('  EZ BACCARAT — Tight Threshold Scan for Genuine +EV Side Bets (v2)');
  console.log(`  ${NUM_SIMS.toLocaleString()} sims × ${NUM_HANDS.toLocaleString()} hands | 8-deck shoe | 75% penetration (${RESHUFFLE_AT}/${TOTAL_CARDS} cards)`);
  console.log(`  Thresholds scanned: TC >= ${SCAN_THRESHOLDS.join(', ')}`);
  console.log(`  Dragon 7 pays ${DRAGON7_PAY}:1 → break-even ${pct(DRAGON7_BREAKEVEN,4)} per bet`);
  console.log(`  Panda 8  pays ${PANDA8_PAY}:1 → break-even ${pct(PANDA8_BREAKEVEN,4)} per bet`);
  sep('═');

  // ── Phase 1: hit-rate scan ───────────────────────────────────────────────────
  const { dragonAcc, pandaAcc, totalHands, actualD7Baseline, actualP8Baseline } = runThresholdScan();

  console.log(`\n  Scan complete: ${thou(totalHands)} total hands across ${NUM_SIMS} shoes`);
  console.log(`  Observed baseline D7 rate: ${pct(actualD7Baseline, 4)}  (theoretical ~${pct(DRAGON7_BASELINE,4)})`);
  console.log(`  Observed baseline P8 rate: ${pct(actualP8Baseline, 4)}  (theoretical ~${pct(PANDA8_BASELINE,4)})`);

  // ── Table 1 ──────────────────────────────────────────────────────────────────
  const { bestEV: bestDragonEV, bestThreshold: bestDragonThresh } = printThresholdTable(
    'TABLE 1 — DRAGON 7 THRESHOLD ANALYSIS',
    dragonAcc, totalHands, actualD7Baseline, DRAGON7_PAY, DRAGON7_BREAKEVEN
  );

  // ── Table 2 ──────────────────────────────────────────────────────────────────
  const { bestEV: bestPandaEV, bestThreshold: bestPandaThresh } = printThresholdTable(
    'TABLE 2 — PANDA 8 THRESHOLD ANALYSIS',
    pandaAcc, totalHands, actualP8Baseline, PANDA8_PAY, PANDA8_BREAKEVEN
  );

  // ── Break-even analysis ───────────────────────────────────────────────────────
  const beAnalysis = printBreakevenAnalysis(dragonAcc, pandaAcc, totalHands, actualD7Baseline, actualP8Baseline);

  // ── Phase 2: Full SBF sim ─────────────────────────────────────────────────────
  // Use the best (highest EV) thresholds found, whether positive or not.
  const dSimThresh = beAnalysis.bestDragonThreshold || SCAN_THRESHOLDS[SCAN_THRESHOLDS.length - 1];
  const pSimThresh = beAnalysis.bestPandaThreshold  || SCAN_THRESHOLDS[SCAN_THRESHOLDS.length - 1];

  const baseAgg     = runBaselineSim();
  const combinedAgg = runFullSim(dSimThresh, pSimThresh, `D7 TC>=${dSimThresh}, P8 TC>=${pSimThresh}`);

  // ── Table 3 ──────────────────────────────────────────────────────────────────
  printCombinedTable(baseAgg, combinedAgg, dSimThresh, pSimThresh, beAnalysis.bestDragonEV, beAnalysis.bestPandaEV);

  // ── Final verdict ─────────────────────────────────────────────────────────────
  console.log();
  sep('═');
  console.log('  VERDICT');
  sep('═');
  console.log();

  const bDE = beAnalysis.bestDragonEV;
  const bPE = beAnalysis.bestPandaEV;
  const bDT = beAnalysis.bestDragonThreshold;
  const bPT = beAnalysis.bestPandaThreshold;

  const anyPosEV = bDE > 0 || bPE > 0;

  if (!anyPosEV) {
    console.log('  RESULT: NO threshold tested achieves positive EV for either side bet.');
    console.log();
    console.log('  Dragon 7 closest-to-break-even:');
    console.log(`    TC >= ${bDT}  =>  EV = ${fix(bDE)} per unit bet`);
    const d7hitNeeded = DRAGON7_BREAKEVEN;
    const d7idx = SCAN_THRESHOLDS.indexOf(bDT);
    const d7hitAt = d7idx >= 0 && dragonAcc[d7idx].triggered > 0
      ? dragonAcc[d7idx].hits / dragonAcc[d7idx].triggered : 0;
    console.log(`    Actual hit rate at TC>=${bDT}: ${pct(d7hitAt,4)}`);
    console.log(`    Break-even hit rate: ${pct(d7hitNeeded,4)} — need ${(d7hitNeeded/Math.max(d7hitAt,0.00001)).toFixed(1)}x more wins`);
    console.log();
    console.log('  Panda 8 closest-to-break-even:');
    console.log(`    TC >= ${bPT}  =>  EV = ${fix(bPE)} per unit bet`);
    const p8hitNeeded = PANDA8_BREAKEVEN;
    const p8idx = SCAN_THRESHOLDS.indexOf(bPT);
    const p8hitAt = p8idx >= 0 && pandaAcc[p8idx].triggered > 0
      ? pandaAcc[p8idx].hits / pandaAcc[p8idx].triggered : 0;
    console.log(`    Actual hit rate at TC>=${bPT}: ${pct(p8hitAt,4)}`);
    console.log(`    Break-even hit rate: ${pct(p8hitNeeded,4)} — need ${(p8hitNeeded/Math.max(p8hitAt,0.00001)).toFixed(1)}x more wins`);
    console.log();
    console.log('  CONCLUSION: This counting system does NOT produce exploitable +EV opportunities');
    console.log('  for Dragon 7 or Panda 8 side bets at any tested threshold in an 8-deck EZ');
    console.log('  Baccarat game with 75% penetration. The count signals correlate weakly with');
    console.log('  the rare 3-card outcomes, and no amount of threshold tightening closes the');
    console.log('  gap to break-even.');
  } else {
    if (bDE > 0) {
      console.log(`  Dragon 7: POSITIVE EV found at TC >= ${bDT} (EV = ${fix(bDE)} per unit)`);
    } else {
      console.log(`  Dragon 7: No positive EV found. Best: ${fix(bDE)} at TC >= ${bDT}`);
    }
    if (bPE > 0) {
      console.log(`  Panda 8:  POSITIVE EV found at TC >= ${bPT} (EV = ${fix(bPE)} per unit)`);
    } else {
      console.log(`  Panda 8:  No positive EV found. Best: ${fix(bPE)} at TC >= ${bPT}`);
    }
  }

  sep('═');
  console.log('  Simulation complete.');
  sep('═');
  console.log();
})();
