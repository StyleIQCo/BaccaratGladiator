'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// EZ Baccarat: SBF + Card-Counting Dragon 7 / Panda 8 Side-Bet Backtest
// ─────────────────────────────────────────────────────────────────────────────

const NUM_SIMS   = 1_000;
const NUM_HANDS  = 10_000;
const START_BNK  = 10_000;
const NUM_DECKS  = 8;

// Side-bet pay tables (EZ Baccarat standard)
const DRAGON7_PAY  = 40;   // 40:1
const PANDA8_PAY   = 25;   // 25:1

// Kelly cap
const KELLY_CAP = 0.05;   // max 5% of bankroll per total exposure

// Count thresholds
const DRAGON_TC_THRESHOLD = 3.0;
const PANDA_TC_THRESHOLD  = 3.0;

// Natural-depletion boost
const NATURAL_BASELINE      = 8 / 52;   // ~15.38%
const NATURAL_LOW_THRESHOLD = 0.10;
const NATURAL_BOOST         = 1.0;

// ─── Card helpers ────────────────────────────────────────────────────────────

function cardValue(rank) {
  // rank 1-13: A=1, 2-9, 10/J/Q/K = 0
  if (rank >= 10) return 0;
  return rank;
}

function buildShoe(numDecks) {
  const shoe = [];
  for (let d = 0; d < numDecks; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        shoe.push(rank);
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

// ─── Count tag helpers ───────────────────────────────────────────────────────

// Dragon 7 tags
function dragonTag(rank) {
  if (rank === 7) return -3;
  if (rank >= 10 || rank === 1) return +1;  // 0-value: 10,J,Q,K and Ace? No—Ace=1
  // Actually: 0-value cards are 10,J,Q,K (rank 10,11,12,13)
  // Let me re-read: "0-value cards (10,J,Q,K): +1"
  // "Small cards (1,2,3,4): +0.5"
  // "8s and 9s: -1"
  // "5,6: neutral"
  // Ace is rank 1 → small card +0.5
  return 0; // fallthrough handled below
}

function getDragonTag(rank) {
  if (rank === 7)  return -3;
  if (rank === 8 || rank === 9) return -1;
  if (rank >= 10)  return +1;   // 10,J,Q,K → 0-value
  if (rank <= 4)   return +0.5; // A,2,3,4 → small
  return 0;                     // 5,6 → neutral
}

function getPandaTag(rank) {
  if (rank === 8)  return -3;
  if (rank === 9)  return -0.5;
  if (rank >= 10)  return +1;   // 0-value
  if (rank <= 4)   return +0.5; // A,2,3,4 → small
  return 0;                     // 5,6,7 → neutral
}

// ─── Baccarat drawing rules ───────────────────────────────────────────────────

function handTotal(cards) {
  return cards.reduce((s, r) => (s + cardValue(r)) % 10, 0);
}

// Returns { playerCards, bankerCards }
// Draws from shoe starting at shoeIdx; returns next shoeIdx
function dealHand(shoe, startIdx) {
  let idx = startIdx;
  const p = [shoe[idx++], shoe[idx++]];
  const b = [shoe[idx++], shoe[idx++]];

  const pTotal = handTotal(p);
  const bTotal = handTotal(b);

  // Natural check
  if (pTotal >= 8 || bTotal >= 8) {
    return { playerCards: p, bankerCards: b, nextIdx: idx };
  }

  // Player third card
  let pThird = null;
  if (pTotal <= 5) {
    pThird = shoe[idx++];
    p.push(pThird);
  }

  const bTotalAfterP = handTotal(b);

  // Banker drawing rules
  let bDraws = false;
  if (pThird === null) {
    // Player stood
    if (bTotalAfterP <= 5) bDraws = true;
  } else {
    const pThirdVal = cardValue(pThird);
    if (bTotalAfterP <= 2) {
      bDraws = true;
    } else if (bTotalAfterP === 3) {
      bDraws = pThirdVal !== 8;
    } else if (bTotalAfterP === 4) {
      bDraws = pThirdVal >= 2 && pThirdVal <= 7;
    } else if (bTotalAfterP === 5) {
      bDraws = pThirdVal >= 4 && pThirdVal <= 7;
    } else if (bTotalAfterP === 6) {
      bDraws = pThirdVal === 6 || pThirdVal === 7;
    }
    // 7: banker stands
  }

  if (bDraws) {
    b.push(shoe[idx++]);
  }

  return { playerCards: p, bankerCards: b, nextIdx: idx };
}

// ─── Determine outcome ────────────────────────────────────────────────────────

function getOutcome(playerCards, bankerCards) {
  const pTotal = handTotal(playerCards);
  const bTotal = handTotal(bankerCards);

  const isDragon7 = bankerCards.length === 3 && bTotal === 7 && bTotal > pTotal;
  const isPanda8  = playerCards.length  === 3 && pTotal === 8 && pTotal > bTotal;

  let winner;
  if (pTotal > bTotal)      winner = 'player';
  else if (bTotal > pTotal) winner = 'banker';
  else                      winner = 'tie';

  // EZ Baccarat: Dragon 7 push (no banker payout on that hand for main bet)
  const bankerPayEZ = (winner === 'banker' && isDragon7) ? 0 : (winner === 'banker' ? 1 : -1);

  return { winner, isDragon7, isPanda8, pTotal, bTotal, bankerPayEZ };
}

// ─── Count state ──────────────────────────────────────────────────────────────

function initCounts() {
  return {
    dragonRunning: 0,
    pandaRunning:  0,
    cardsDealt:    0,
    eights:        NUM_DECKS * 4,
    nines:         NUM_DECKS * 4,
    totalRemaining: NUM_DECKS * 52,
  };
}

function updateCounts(counts, rank) {
  counts.dragonRunning   += getDragonTag(rank);
  counts.pandaRunning    += getPandaTag(rank);
  counts.cardsDealt      += 1;
  counts.totalRemaining  -= 1;
  if (rank === 8) counts.eights -= 1;
  if (rank === 9) counts.nines  -= 1;
}

function getTrueCounts(counts) {
  const decksRemaining = counts.totalRemaining / 52;
  if (decksRemaining < 0.5) return { dragonTC: 0, pandaTC: 0, boost: 0 };

  const naturalRemaining = (counts.eights + counts.nines) / counts.totalRemaining;
  const boost = naturalRemaining < NATURAL_LOW_THRESHOLD ? NATURAL_BOOST : 0;

  const dragonTC = (counts.dragonRunning / decksRemaining) + boost;
  const pandaTC  = (counts.pandaRunning  / decksRemaining) + boost;

  return { dragonTC, pandaTC, boost };
}

// ─── SBF (Second Bank Frank) Strategy ────────────────────────────────────────
// Entry: 3+ Player streak → next hand Banker wins → bet next hand on Banker
// Sizing: base B, ÷3 on win, ×1.5 on loss, cap at 5% Kelly

function initSBF(bankroll) {
  return {
    active:        false,
    playerStreak:  0,
    bankConfirm:   false,
    betSize:       bankroll * 0.02,  // start at 2% of bankroll
    lastResult:    null,
  };
}

function sbfBetSize(sbf, bankroll) {
  const cap = bankroll * KELLY_CAP;
  return Math.min(sbf.betSize, cap);
}

// ─── Single Simulation ────────────────────────────────────────────────────────

function runSim(variantCfg) {
  const shoe = buildShoe(NUM_DECKS);
  shuffleShoe(shoe);

  let bankroll   = START_BNK;
  let shoeIdx    = 0;
  let maxBankroll = START_BNK;
  let maxDrawdown = 0;

  const counts = initCounts();
  const sbf    = initSBF(bankroll);

  // Stats
  let dragonBets = 0, dragonWins = 0, dragonProfit = 0;
  let pandaBets  = 0, pandaWins  = 0, pandaProfit  = 0;
  let sbfHands   = 0, sbfProfit  = 0;
  let sideTriggered = 0; // SBF hands where at least one side bet fired

  // Predictive accuracy tracking
  let dragonCountHigh = 0;  // hands where Dragon TC >= 3
  let dragonCountHighHits = 0; // of those, how many were Dragon 7
  let pandaCountHigh  = 0;
  let pandaCountHighHits  = 0;

  // Reshuffle at 75% penetration
  const RESHUFFLE_AT = Math.floor(NUM_DECKS * 52 * 0.75);

  for (let hand = 0; hand < NUM_HANDS; hand++) {
    // Reshuffle check
    if (shoeIdx >= RESHUFFLE_AT || shoeIdx + 6 >= shoe.length) {
      shuffleShoe(shoe);
      shoeIdx = 0;
      // Reset counts
      counts.dragonRunning  = 0;
      counts.pandaRunning   = 0;
      counts.cardsDealt     = 0;
      counts.eights         = NUM_DECKS * 4;
      counts.nines          = NUM_DECKS * 4;
      counts.totalRemaining = NUM_DECKS * 52;
    }

    const { dragonTC, pandaTC } = getTrueCounts(counts);

    // Track predictive accuracy (regardless of whether we bet)
    if (dragonTC >= DRAGON_TC_THRESHOLD) dragonCountHigh++;
    if (pandaTC  >= PANDA_TC_THRESHOLD)  pandaCountHigh++;

    // Deal the hand
    const { playerCards, bankerCards, nextIdx } = dealHand(shoe, shoeIdx);

    // Update counts for all dealt cards
    for (const r of playerCards) updateCounts(counts, r);
    for (const r of bankerCards) updateCounts(counts, r);

    shoeIdx = nextIdx;

    const outcome = getOutcome(playerCards, bankerCards);

    // Track hit rates for predictive accuracy
    if (dragonTC >= DRAGON_TC_THRESHOLD && outcome.isDragon7) dragonCountHighHits++;
    if (pandaTC  >= PANDA_TC_THRESHOLD  && outcome.isPanda8)  pandaCountHighHits++;

    // ── SBF state machine ──
    let sbfBetting = false;

    if (!sbf.active) {
      if (outcome.winner === 'player') {
        sbf.playerStreak++;
        sbf.bankConfirm = false;
      } else if (outcome.winner === 'banker' && sbf.playerStreak >= 3) {
        sbf.bankConfirm  = true;
        sbf.playerStreak = 0;
        sbf.active       = false; // will activate next hand
      } else {
        sbf.playerStreak = 0;
        sbf.bankConfirm  = false;
      }

      if (sbf.bankConfirm) {
        sbf.active = true; // start betting next hand
        sbf.betSize = bankroll * 0.02;
      }
    } else {
      sbfBetting = true;
      sbfHands++;

      const mainBet = sbfBetSize(sbf, bankroll);

      // Side bets
      let dBet = 0, pBet = 0;
      let anySideBet = false;

      if (variantCfg.dragonAlways) {
        dBet = mainBet / 20;
        anySideBet = true;
      } else if (variantCfg.dragonCounted && dragonTC >= DRAGON_TC_THRESHOLD) {
        dBet = mainBet / 20;
        anySideBet = true;
      }

      if (variantCfg.pandaCounted && pandaTC >= PANDA_TC_THRESHOLD) {
        pBet = mainBet / 20;
        anySideBet = true;
      }

      if (anySideBet) sideTriggered++;

      // Kelly cap: total exposure
      const totalExposure = mainBet + dBet + pBet;
      const cap           = bankroll * KELLY_CAP;
      const scale         = totalExposure > cap ? cap / totalExposure : 1.0;

      const scaledMain = mainBet * scale;
      const scaledD    = dBet    * scale;
      const scaledP    = pBet    * scale;

      // Banker main bet (EZ: Dragon 7 is a push)
      let handPnl = 0;
      if (outcome.winner === 'banker') {
        handPnl += outcome.isDragon7 ? 0 : scaledMain; // push on Dragon 7
      } else if (outcome.winner === 'player') {
        handPnl -= scaledMain;
      }
      // tie: push on main

      // Dragon side
      if (scaledD > 0) {
        dragonBets++;
        if (outcome.isDragon7) {
          dragonWins++;
          const gain = scaledD * DRAGON7_PAY;
          dragonProfit += gain;
          handPnl      += gain;
        } else {
          dragonProfit -= scaledD;
          handPnl      -= scaledD;
        }
      }

      // Panda side
      if (scaledP > 0) {
        pandaBets++;
        if (outcome.isPanda8) {
          pandaWins++;
          const gain = scaledP * PANDA8_PAY;
          pandaProfit += gain;
          handPnl     += gain;
        } else {
          pandaProfit -= scaledP;
          handPnl     -= scaledP;
        }
      }

      sbfProfit += handPnl;
      bankroll  += handPnl;

      // Adjust bet size for next round
      if (outcome.winner === 'banker') {
        sbf.betSize = Math.max(sbf.betSize / 3, bankroll * 0.005);
        // After a win, re-evaluate entry (reset for new streak hunting)
        sbf.active       = false;
        sbf.bankConfirm  = false;
        sbf.playerStreak = 0;
      } else if (outcome.winner === 'player') {
        sbf.betSize = Math.min(sbf.betSize * 1.5, bankroll * KELLY_CAP);
        // Lost, keep betting
      } else {
        // Tie: stand pat
      }

      // Bust check
      if (bankroll <= 0) {
        bankroll = 0;
        break;
      }
    }

    // Update drawdown
    if (bankroll > maxBankroll) maxBankroll = bankroll;
    const dd = (maxBankroll - bankroll) / maxBankroll;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    finalBankroll: bankroll,
    maxDrawdown,
    sbfHands,
    sbfProfit,
    dragonBets, dragonWins, dragonProfit,
    pandaBets,  pandaWins,  pandaProfit,
    sideTriggered,
    dragonCountHigh, dragonCountHighHits,
    pandaCountHigh,  pandaCountHighHits,
  };
}

// ─── Aggregate Results ────────────────────────────────────────────────────────

function aggregateSims(results) {
  const n = results.length;

  const finals = results.map(r => r.finalBankroll).sort((a, b) => a - b);
  const mean   = finals.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0
    ? (finals[n/2 - 1] + finals[n/2]) / 2
    : finals[Math.floor(n/2)];

  const profitable = results.filter(r => r.finalBankroll > START_BNK).length;
  const busts      = results.filter(r => r.finalBankroll <= 0).length;

  const totalSbfHands  = results.reduce((s, r) => s + r.sbfHands, 0);
  const totalSbfProfit = results.reduce((s, r) => s + r.sbfProfit, 0);
  const evPerSbfHand   = totalSbfHands > 0 ? totalSbfProfit / totalSbfHands : 0;

  const meanMaxDrawdown = results.reduce((s, r) => s + r.maxDrawdown, 0) / n;

  const totalDragonBets   = results.reduce((s, r) => s + r.dragonBets, 0);
  const totalDragonWins   = results.reduce((s, r) => s + r.dragonWins, 0);
  const totalDragonProfit = results.reduce((s, r) => s + r.dragonProfit, 0);

  const totalPandaBets    = results.reduce((s, r) => s + r.pandaBets, 0);
  const totalPandaWins    = results.reduce((s, r) => s + r.pandaWins, 0);
  const totalPandaProfit  = results.reduce((s, r) => s + r.pandaProfit, 0);

  const totalSideTriggered = results.reduce((s, r) => s + r.sideTriggered, 0);

  const totalDragonCountHigh      = results.reduce((s, r) => s + r.dragonCountHigh, 0);
  const totalDragonCountHighHits  = results.reduce((s, r) => s + r.dragonCountHighHits, 0);
  const totalPandaCountHigh       = results.reduce((s, r) => s + r.pandaCountHigh, 0);
  const totalPandaCountHighHits   = results.reduce((s, r) => s + r.pandaCountHighHits, 0);

  const dragonHitRateWhenHigh = totalDragonCountHigh > 0
    ? totalDragonCountHighHits / totalDragonCountHigh : 0;
  const pandaHitRateWhenHigh  = totalPandaCountHigh  > 0
    ? totalPandaCountHighHits  / totalPandaCountHigh  : 0;

  const bestSim  = results.reduce((best, r) => r.finalBankroll > best.finalBankroll ? r : best);
  const worstSim = results.reduce((worst, r) => r.finalBankroll < worst.finalBankroll ? r : worst);

  return {
    n, mean, median, profitable, busts,
    evPerSbfHand, meanMaxDrawdown,
    totalDragonBets, totalDragonWins, totalDragonProfit,
    dragonWinRate: totalDragonBets > 0 ? totalDragonWins / totalDragonBets : 0,
    evPerDragonBet: totalDragonBets > 0 ? totalDragonProfit / totalDragonBets : 0,
    totalPandaBets, totalPandaWins, totalPandaProfit,
    pandaWinRate: totalPandaBets > 0 ? totalPandaWins / totalPandaBets : 0,
    evPerPandaBet: totalPandaBets > 0 ? totalPandaProfit / totalPandaBets : 0,
    totalSideTriggered, totalSbfHands,
    sideTriggerPct: totalSbfHands > 0 ? totalSideTriggered / totalSbfHands : 0,
    dragonHitRateWhenHigh, totalDragonCountHigh,
    pandaHitRateWhenHigh,  totalPandaCountHigh,
    bestFinal:  bestSim.finalBankroll,
    worstFinal: worstSim.finalBankroll,
  };
}

// ─── Display ──────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (typeof n !== 'number' || isNaN(n)) return 'N/A';
  return n.toFixed(dec);
}
function fmtPct(n) { return (n * 100).toFixed(2) + '%'; }
function fmtUnits(n) { return n.toFixed(1); }
function sep() { console.log('─'.repeat(72)); }

function printVariant(name, agg) {
  sep();
  console.log(`VARIANT: ${name}`);
  sep();
  console.log(`  Bankroll  │ Mean: ${fmtUnits(agg.mean)}  Median: ${fmtUnits(agg.median)}  Start: ${START_BNK}`);
  console.log(`  Outcomes  │ Profitable: ${fmtPct(agg.profitable / agg.n)}  Bust: ${fmtPct(agg.busts / agg.n)}`);
  console.log(`  EV/SBFhnd │ ${fmt(agg.evPerSbfHand, 4)} units  (total SBF hands: ${agg.totalSbfHands.toLocaleString()})`);
  console.log(`  Max DD    │ Mean: ${fmtPct(agg.meanMaxDrawdown)}`);
  console.log(`  Best sim  │ ${fmtUnits(agg.bestFinal)}   Worst sim: ${fmtUnits(agg.worstFinal)}`);

  if (agg.totalDragonBets > 0) {
    console.log(`  Dragon 7  │ Bets: ${agg.totalDragonBets.toLocaleString()}  WinRate: ${fmtPct(agg.dragonWinRate)}  EV/bet: ${fmt(agg.evPerDragonBet, 4)}  Total P&L: ${fmtUnits(agg.totalDragonProfit)}`);
  } else {
    console.log(`  Dragon 7  │ No bets placed`);
  }

  if (agg.totalPandaBets > 0) {
    console.log(`  Panda 8   │ Bets: ${agg.totalPandaBets.toLocaleString()}  WinRate: ${fmtPct(agg.pandaWinRate)}  EV/bet: ${fmt(agg.evPerPandaBet, 4)}  Total P&L: ${fmtUnits(agg.totalPandaProfit)}`);
  } else {
    console.log(`  Panda 8   │ No bets placed`);
  }

  if (agg.totalSbfHands > 0) {
    console.log(`  Side trig │ ${fmtPct(agg.sideTriggerPct)} of SBF hands triggered a side bet`);
  }

  // Predictive accuracy
  if (agg.totalDragonCountHigh > 0) {
    const baseline = 0.00295; // ~1/339 approximate Dragon 7 rate
    console.log(`  D7 Count  │ TC>=3 hands: ${agg.totalDragonCountHigh.toLocaleString()}  Actual D7 hit rate: ${fmtPct(agg.dragonHitRateWhenHigh)}  (baseline ~0.30%)`);
  }
  if (agg.totalPandaCountHigh > 0) {
    console.log(`  P8 Count  │ TC>=3 hands: ${agg.totalPandaCountHigh.toLocaleString()}  Actual P8 hit rate: ${fmtPct(agg.pandaHitRateWhenHigh)}  (baseline ~0.35%)`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const variants = [
  {
    name:          '1. SBF No Side Bets (baseline)',
    dragonAlways:  false,
    dragonCounted: false,
    pandaCounted:  false,
  },
  {
    name:          '2. SBF + Dragon Always (B/20 every SBF hand)',
    dragonAlways:  true,
    dragonCounted: false,
    pandaCounted:  false,
  },
  {
    name:          '3. SBF + Dragon Counted (TC >= 3.0 only)',
    dragonAlways:  false,
    dragonCounted: true,
    pandaCounted:  false,
  },
  {
    name:          '4. SBF + Panda Counted (TC >= 3.0 only)',
    dragonAlways:  false,
    dragonCounted: false,
    pandaCounted:  true,
  },
  {
    name:          '5. SBF + Dragon+Panda Both Counted',
    dragonAlways:  false,
    dragonCounted: true,
    pandaCounted:  true,
  },
];

console.log();
console.log('═'.repeat(72));
console.log('  EZ BACCARAT — SBF + Card-Counting Dragon7/Panda8 Backtest');
console.log(`  ${NUM_SIMS.toLocaleString()} simulations × ${NUM_HANDS.toLocaleString()} hands  |  Starting bankroll: ${START_BNK.toLocaleString()} units`);
console.log(`  Dragon TC threshold: ${DRAGON_TC_THRESHOLD}  |  Panda TC threshold: ${PANDA_TC_THRESHOLD}`);
console.log(`  Dragon 7 pays ${DRAGON7_PAY}:1  |  Panda 8 pays ${PANDA8_PAY}:1  |  ${NUM_DECKS}-deck shoe`);
console.log('═'.repeat(72));

const allAggs = [];

for (const variant of variants) {
  process.stdout.write(`\nRunning: ${variant.name} ... `);
  const results = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    results.push(runSim(variant));
  }
  const agg = aggregateSims(results);
  allAggs.push({ name: variant.name, agg });
  process.stdout.write(`done\n`);
  printVariant(variant.name, agg);
}

// ─── Summary comparison table ─────────────────────────────────────────────────

console.log();
console.log('═'.repeat(72));
console.log('  SUMMARY COMPARISON TABLE');
console.log('═'.repeat(72));
console.log(
  'Variant'.padEnd(45),
  'MeanBnk'.padStart(9),
  'EV/Hand'.padStart(9),
  'MeanDD%'.padStart(9),
  'Bust%'.padStart(7)
);
sep();
for (const { name, agg } of allAggs) {
  const shortName = name.replace(/^\d+\.\s*/, '').slice(0, 44);
  console.log(
    shortName.padEnd(45),
    fmtUnits(agg.mean).padStart(9),
    fmt(agg.evPerSbfHand, 4).padStart(9),
    fmtPct(agg.meanMaxDrawdown).padStart(9),
    fmtPct(agg.busts / agg.n).padStart(7)
  );
}

// ─── Count Predictive Accuracy Summary ───────────────────────────────────────

console.log();
console.log('═'.repeat(72));
console.log('  COUNT PREDICTIVE ACCURACY (across all counted variants)');
console.log('═'.repeat(72));
console.log('  Dragon 7 baseline rate (8-deck): approx 2.25/1000 hands (~0.225%)');
console.log('  Panda 8  baseline rate (8-deck): approx 2.72/1000 hands (~0.272%)');
console.log();

for (const { name, agg } of allAggs) {
  if (agg.totalDragonCountHigh > 0 || agg.totalPandaCountHigh > 0) {
    console.log(`  ${name}`);
    if (agg.totalDragonCountHigh > 0) {
      const lift = agg.totalDragonCountHigh > 0
        ? ((agg.dragonHitRateWhenHigh / 0.00225) - 1) * 100 : 0;
      console.log(`    Dragon TC>=3: ${agg.totalDragonCountHigh.toLocaleString()} hands → hit rate ${fmtPct(agg.dragonHitRateWhenHigh)} (lift: ${lift.toFixed(0)}% vs baseline)`);
    }
    if (agg.totalPandaCountHigh > 0) {
      const lift = agg.totalPandaCountHigh > 0
        ? ((agg.pandaHitRateWhenHigh / 0.00272) - 1) * 100 : 0;
      console.log(`    Panda  TC>=3: ${agg.totalPandaCountHigh.toLocaleString()} hands → hit rate ${fmtPct(agg.pandaHitRateWhenHigh)} (lift: ${lift.toFixed(0)}% vs baseline)`);
    }
    console.log();
  }
}

console.log('═'.repeat(72));
console.log('  Simulation complete.');
console.log('═'.repeat(72));
console.log();
