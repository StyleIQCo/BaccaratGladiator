'use strict';

// ============================================================
// Second Bank Frank — EZ Baccarat + Dragon 7 Hedge Backtest
// 3 variants × 1,000 simulations × 10,000 hands each
//   1. Standard EZ (no dragon hedge)
//   2. EZ + Dragon hedge every SBF hand (B/20 side bet)
//   3. EZ + Dragon hedge only after ≥2 consecutive SBF losses
// ============================================================

const NUM_SIMS  = 1000;
const NUM_HANDS = 10000;
const START_BK  = 10000;
const BASE_BET  = 100;
const MIN_BET   = 1;

// ── Deck / Shoe ──────────────────────────────────────────────
function buildShoe(numDecks = 8) {
  const shoe = [];
  for (let d = 0; d < numDecks; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        shoe.push(Math.min(rank, 10) % 10);
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

// ── Full Baccarat Third-Card Rules ────────────────────────────
function dealHandProper(shoe, pos) {
  let i = pos;
  // Deal order: P1 B1 P2 B2 (positions 0,1,2,3 from pos)
  const pC = [shoe[i], shoe[i + 2]];
  const bC = [shoe[i + 1], shoe[i + 3]];
  i += 4;

  let pVal = handValue(pC);
  let bVal = handValue(bC);

  let playerDraw = null;

  if (pVal >= 8 || bVal >= 8) {
    // Natural — no draw
  } else {
    if (pVal <= 5) {
      playerDraw = shoe[i++];
      pC.push(playerDraw);
      pVal = handValue(pC);
    }

    if (playerDraw === null) {
      if (bVal <= 5) {
        bC.push(shoe[i++]);
        bVal = handValue(bC);
      }
    } else {
      const p3 = playerDraw;
      let bankerDraws = false;
      if      (bVal <= 2) bankerDraws = true;
      else if (bVal === 3) bankerDraws = (p3 !== 8);
      else if (bVal === 4) bankerDraws = (p3 >= 2 && p3 <= 7);
      else if (bVal === 5) bankerDraws = (p3 >= 4 && p3 <= 7);
      else if (bVal === 6) bankerDraws = (p3 === 6 || p3 === 7);
      // bVal === 7: stand

      if (bankerDraws) {
        bC.push(shoe[i++]);
        bVal = handValue(bC);
      }
    }
  }

  let winner;
  if      (pVal > bVal) winner = 'player';
  else if (bVal > pVal) winner = 'banker';
  else                  winner = 'tie';

  // Dragon 7: banker wins with exactly 3 cards totaling 7
  const isDragon7 = (winner === 'banker' && bC.length === 3 && bVal === 7);

  return { nextPos: i, playerCards: pC, bankerCards: bC,
           playerVal: pVal, bankerVal: bVal, winner, isDragon7 };
}

// ── Strategy Helpers ──────────────────────────────────────────
function freshState() {
  return {
    consecutivePlayers: 0,
    phase: 'waiting',
    betSize: BASE_BET,
    consecutiveSBFLosses: 0,  // for variant 3
  };
}

function adjustBet(state, won) {
  if (won) {
    state.betSize = Math.max(MIN_BET, state.betSize / 4);
  } else {
    state.betSize = Math.max(MIN_BET, state.betSize * 1.5);
  }
}

// Kelly cap: total exposure = 1.05 × B ≤ 5% of bankroll
// So B ≤ (0.05 × bankroll) / 1.05
function kellyCap(bankroll, rawBet, withDragon) {
  const capFactor = withDragon ? 1.05 : 1.0;
  const cap = (bankroll * 0.05) / capFactor;
  return Math.max(MIN_BET, Math.min(rawBet, cap));
}

function dragonBet(B) {
  return Math.max(0.05, Math.round((B / 20) * 100) / 100);
}

// ── Single Simulation ─────────────────────────────────────────
// variant: 'ez' | 'dragon_always' | 'dragon_damage'
function runSim(variant) {
  const shoe = buildShoe(8);
  shuffle(shoe);
  let pos = 0;

  let bankroll = START_BK;
  let state    = freshState();
  let peak     = START_BK;
  let maxDrawdown = 0;

  // Stats
  let opportunities    = 0;
  let betsPlaced       = 0;
  let bankerWins       = 0;   // non-dragon banker wins
  let bankerLosses     = 0;
  let bankerPushes     = 0;   // dragon 7 pushes on banker bet
  let tiePushes        = 0;   // ties while in betting phase
  let dragonSideBets   = 0;   // times dragon side bet was placed
  let dragonSideHits   = 0;   // times dragon side bet won
  let sbfHandsWithD7   = 0;   // dragon 7 on a SBF betting hand
  let totalPnl         = 0;
  let allHands         = 0;
  let totalD7All       = 0;   // all dragon 7 occurrences in shoe

  for (let h = 0; h < NUM_HANDS; h++) {
    if (shoe.length - pos < 26) {
      const fresh = buildShoe(8);
      shuffle(fresh);
      shoe.splice(0, shoe.length, ...fresh);
      pos = 0;
      state = freshState();
    }
    if (pos + 6 > shoe.length) break;

    const result = dealHandProper(shoe, pos);
    pos = result.nextPos;
    allHands++;

    if (result.isDragon7) totalD7All++;

    const winner = result.winner;

    if (state.phase === 'waiting') {
      if (winner === 'player') {
        state.consecutivePlayers++;
      } else if (winner === 'banker') {
        if (state.consecutivePlayers >= 3) {
          state.phase = 'betting';
          opportunities++;
          state.betSize = BASE_BET;
          // Don't reset consecutiveSBFLosses here — carry over for variant 3
        }
        state.consecutivePlayers = 0;
      }
      // tie: ignore streak
    } else if (state.phase === 'betting') {
      // ── Determine whether to place dragon side bet ──────────
      const placeDragon =
        variant === 'dragon_always' ||
        (variant === 'dragon_damage' && state.consecutiveSBFLosses >= 2);

      // ── Size bets ───────────────────────────────────────────
      const B = Math.round(
        kellyCap(bankroll, state.betSize, placeDragon) * 100
      ) / 100;
      const dBet = placeDragon ? dragonBet(B) : 0;

      betsPlaced++;

      // ── Resolve outcome ─────────────────────────────────────
      let pnl = 0;

      if (winner === 'banker') {
        if (result.isDragon7) {
          // Dragon 7 — banker bet PUSHES (EZ rule)
          bankerPushes++;
          sbfHandsWithD7++;

          if (placeDragon) {
            // Dragon side bet wins 40:1
            pnl = 40 * dBet;  // net profit on dragon
            // Banker bet returned (push) — no gain/loss on B
            dragonSideBets++;
            dragonSideHits++;
            // Net = +40*dBet (since dBet = B/20, that's +2B)
          } else {
            pnl = 0;  // just a push
          }

          // Treat as neutral for bet-sizing purposes (push ≈ stand pat)
          // Reset to waiting after dragon 7
          state.phase = 'waiting';
          state.consecutivePlayers = 0;
          // Don't count as a loss for damage-control streak
        } else {
          // Normal banker win — pays 1:1 in EZ
          pnl = B;                             // +B on banker
          if (placeDragon) {
            pnl -= dBet;                       // lose dragon side bet
            dragonSideBets++;
          }
          // net = B - B/20 = 0.95B
          bankerWins++;
          adjustBet(state, true);
          state.phase = 'waiting';
          state.consecutivePlayers = 0;
          state.consecutiveSBFLosses = 0;
        }
      } else if (winner === 'player') {
        pnl = -B;                              // lose banker bet
        if (placeDragon) {
          pnl -= dBet;                         // lose dragon side bet too
          dragonSideBets++;
        }
        // net = -(B + B/20) = -1.05B
        bankerLosses++;
        adjustBet(state, false);
        state.phase = 'waiting';
        state.consecutivePlayers = 0;
        state.consecutiveSBFLosses++;
      } else {
        // Tie — banker bet carries over; dragon side bet LOSES (casino rule)
        if (placeDragon) {
          pnl = -dBet;                         // lose dragon side bet on tie
          dragonSideBets++;
        }
        tiePushes++;
        // Stay in betting phase
        // Don't change streak counts on tie
      }

      bankroll += pnl;
      totalPnl += pnl;

      if (bankroll <= 0) {
        bankroll = 0;
        break;
      }
    }

    if (bankroll > peak) peak = bankroll;
    const dd = peak - bankroll;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    finalBankroll:    bankroll,
    maxDrawdown,
    opportunities,
    betsPlaced,
    bankerWins,
    bankerLosses,
    bankerPushes,
    tiePushes,
    dragonSideBets,
    dragonSideHits,
    sbfHandsWithD7,
    totalPnl,
    allHands,
    totalD7All,
  };
}

// ── Statistics Helpers ────────────────────────────────────────
function mean(arr)   { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmt(n, dec = 2) { return n.toFixed(dec); }
function pctOf(n, d)     { return d > 0 ? fmt((n / d) * 100, 3) + '%' : '—'; }

function aggregate(results) {
  const finals    = results.map(r => r.finalBankroll);
  const drawdowns = results.map(r => r.maxDrawdown);

  const totalBets        = results.reduce((a, r) => a + r.betsPlaced, 0);
  const totalBankWins    = results.reduce((a, r) => a + r.bankerWins, 0);
  const totalBankLosses  = results.reduce((a, r) => a + r.bankerLosses, 0);
  const totalBankPushes  = results.reduce((a, r) => a + r.bankerPushes, 0);
  const totalDragonBets  = results.reduce((a, r) => a + r.dragonSideBets, 0);
  const totalDragonHits  = results.reduce((a, r) => a + r.dragonSideHits, 0);
  const totalSbfD7       = results.reduce((a, r) => a + r.sbfHandsWithD7, 0);
  const totalPnl         = results.reduce((a, r) => a + r.totalPnl, 0);
  const totalHands       = results.reduce((a, r) => a + r.allHands, 0);
  const totalD7All       = results.reduce((a, r) => a + r.totalD7All, 0);
  const totalOpps        = results.reduce((a, r) => a + r.opportunities, 0);

  const profitable = finals.filter(f => f > START_BK).length;
  const bust       = finals.filter(f => f <= 0).length;

  // Win rate excludes dragon-7 pushes and tie-phase pushes
  const resolvableBets = totalBankWins + totalBankLosses;
  const winRateExclPush = resolvableBets > 0
    ? (totalBankWins / resolvableBets) * 100 : 0;

  const evPerHand = totalHands > 0 ? totalPnl / totalHands : 0;

  const dragon7RateOnSBF = totalBets > 0
    ? (totalSbfD7 / totalBets) * 100 : 0;

  const dragon7RateAll = totalHands > 0
    ? (totalD7All / totalHands) * 100 : 0;

  const dragonHedgeHitRate = totalDragonBets > 0
    ? (totalDragonHits / totalDragonBets) * 100 : 0;

  const meanOpps = totalOpps / results.length;

  return {
    meanFinal:          mean(finals),
    medianFinal:        median(finals),
    bestFinal:          Math.max(...finals),
    worstFinal:         Math.min(...finals),
    profitable,
    bust,
    winRateExclPush,
    evPerHand,
    dragon7RateOnSBF,
    dragon7RateAll,
    dragonHedgeHitRate,
    meanDrawdown:       mean(drawdowns),
    totalBets,
    totalBankWins,
    totalBankLosses,
    totalBankPushes,
    totalDragonBets,
    totalDragonHits,
    totalHands,
    meanOpps,
  };
}

// ── Run all three variants ────────────────────────────────────
function runVariant(variant, label) {
  process.stdout.write(`\nRunning ${NUM_SIMS} sims — ${label}...\n`);
  const results = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    results.push(runSim(variant));
    if ((s + 1) % 200 === 0) process.stdout.write(`  ${s + 1}/${NUM_SIMS}\r`);
  }
  process.stdout.write(`  ${NUM_SIMS}/${NUM_SIMS} — done.          \n`);
  return aggregate(results);
}

// ── Print comparison table ────────────────────────────────────
function printTable(s1, s2, s3) {
  const C0 = 38;
  const C  = 17;

  const hdr = (t) => console.log('\n' + t);
  const div = () => console.log('─'.repeat(C0 + C * 3));

  const row = (label, v1, v2, v3) => {
    process.stdout.write(
      label.padEnd(C0) +
      String(v1).padStart(C) +
      String(v2).padStart(C) +
      String(v3).padStart(C) + '\n'
    );
  };

  console.log('\n');
  console.log(
    'Metric'.padEnd(C0) +
    'EZ No Hedge'.padStart(C) +
    'Dragon Always'.padStart(C) +
    'Dragon ≥2L'.padStart(C)
  );
  div();

  hdr('── Bankroll Outcomes ──');
  row('Mean Final Bankroll',
    '$' + fmt(s1.meanFinal),
    '$' + fmt(s2.meanFinal),
    '$' + fmt(s3.meanFinal));
  row('Median Final Bankroll',
    '$' + fmt(s1.medianFinal),
    '$' + fmt(s2.medianFinal),
    '$' + fmt(s3.medianFinal));
  row('Best Sim Outcome',
    '$' + fmt(s1.bestFinal),
    '$' + fmt(s2.bestFinal),
    '$' + fmt(s3.bestFinal));
  row('Worst Sim Outcome',
    '$' + fmt(s1.worstFinal),
    '$' + fmt(s2.worstFinal),
    '$' + fmt(s3.worstFinal));
  row('% Profitable (> $10k)',
    fmt((s1.profitable / NUM_SIMS) * 100, 1) + '%',
    fmt((s2.profitable / NUM_SIMS) * 100, 1) + '%',
    fmt((s3.profitable / NUM_SIMS) * 100, 1) + '%');
  row('% Bust',
    fmt((s1.bust / NUM_SIMS) * 100, 1) + '%',
    fmt((s2.bust / NUM_SIMS) * 100, 1) + '%',
    fmt((s3.bust / NUM_SIMS) * 100, 1) + '%');

  hdr('── Bet Performance (Banker) ──');
  row('Win Rate on Banker (excl pushes)',
    fmt(s1.winRateExclPush, 3) + '%',
    fmt(s2.winRateExclPush, 3) + '%',
    fmt(s3.winRateExclPush, 3) + '%');
  row('EV per Hand (total P&L / hands)',
    fmt(s1.evPerHand, 4),
    fmt(s2.evPerHand, 4),
    fmt(s3.evPerHand, 4));
  row('Mean Max Drawdown',
    '$' + fmt(s1.meanDrawdown),
    '$' + fmt(s2.meanDrawdown),
    '$' + fmt(s3.meanDrawdown));
  row('Mean Opportunities / 10k hands',
    fmt(s1.meanOpps, 1),
    fmt(s2.meanOpps, 1),
    fmt(s3.meanOpps, 1));

  hdr('── Dragon 7 Statistics ──');
  row('D7 rate on SBF betting hands',
    fmt(s1.dragon7RateOnSBF, 3) + '%',
    fmt(s2.dragon7RateOnSBF, 3) + '%',
    fmt(s3.dragon7RateOnSBF, 3) + '%');
  row('D7 rate across all hands',
    fmt(s1.dragon7RateAll, 3) + '%',
    fmt(s2.dragon7RateAll, 3) + '%',
    fmt(s3.dragon7RateAll, 3) + '%');
  row('Dragon side bets placed',
    s1.totalDragonBets.toLocaleString(),
    s2.totalDragonBets.toLocaleString(),
    s3.totalDragonBets.toLocaleString());
  row('Dragon side bet hits',
    s1.totalDragonHits.toLocaleString(),
    s2.totalDragonHits.toLocaleString(),
    s3.totalDragonHits.toLocaleString());
  row('Dragon side bet hit rate',
    s1.totalDragonBets > 0
      ? fmt(s1.dragonHedgeHitRate, 3) + '%' : '—',
    fmt(s2.dragonHedgeHitRate, 3) + '%',
    fmt(s3.dragonHedgeHitRate, 3) + '%');

  hdr('── Volume ──');
  row('Total Bets (all sims)',
    s1.totalBets.toLocaleString(),
    s2.totalBets.toLocaleString(),
    s3.totalBets.toLocaleString());
  row('Total Banker Wins',
    s1.totalBankWins.toLocaleString(),
    s2.totalBankWins.toLocaleString(),
    s3.totalBankWins.toLocaleString());
  row('Total Banker Losses',
    s1.totalBankLosses.toLocaleString(),
    s2.totalBankLosses.toLocaleString(),
    s3.totalBankLosses.toLocaleString());
  row('Total Dragon-7 Pushes (banker)',
    s1.totalBankPushes.toLocaleString(),
    s2.totalBankPushes.toLocaleString(),
    s3.totalBankPushes.toLocaleString());

  div();
}

// ── Analysis narrative ────────────────────────────────────────
function printAnalysis(s1, s2, s3) {
  console.log('\n── Analysis ──\n');

  const d2 = s2.meanFinal - s1.meanFinal;
  const d3 = s3.meanFinal - s1.meanFinal;

  console.log('Dragon 7 Hedge — "Always" variant:');
  console.log(`  Mean bankroll vs no-hedge: ${d2 >= 0 ? '+' : ''}${fmt(d2)} units`);
  console.log(`  The side bet costs B/20 per hand on every non-Dragon win.`);
  console.log(`  With D7 hitting ~${fmt(s2.dragon7RateOnSBF, 2)}% of SBF hands,`);
  console.log(`  break-even requires D7 to occur ≥1/41 ≈ 2.44% of side-bet hands.`);
  const d2ev = s2.evPerHand - s1.evPerHand;
  console.log(`  EV differential (hedge − no-hedge): ${d2ev >= 0 ? '+' : ''}${fmt(d2ev, 4)} units/hand`);
  console.log();

  console.log('Dragon 7 Hedge — "Damage Control ≥2 losses" variant:');
  console.log(`  Mean bankroll vs no-hedge: ${d3 >= 0 ? '+' : ''}${fmt(d3)} units`);
  console.log(`  Hedging only after 2 consecutive SBF losses reduces side-bet cost`);
  console.log(`  while targeting the elevated-risk stretch of the half-martingale.`);
  const d3ev = s3.evPerHand - s1.evPerHand;
  console.log(`  EV differential (hedge − no-hedge): ${d3ev >= 0 ? '+' : ''}${fmt(d3ev, 4)} units/hand`);
  console.log();

  // Drawdown comparison
  const dd2 = s2.meanDrawdown - s1.meanDrawdown;
  const dd3 = s3.meanDrawdown - s1.meanDrawdown;
  console.log('Drawdown impact:');
  console.log(`  Always-hedge drawdown vs baseline: ${dd2 >= 0 ? '+' : ''}${fmt(dd2)} units`);
  console.log(`  Damage-control drawdown vs baseline: ${dd3 >= 0 ? '+' : ''}${fmt(dd3)} units`);
  console.log();

  // Dragon 7 economic analysis
  const d7Rate = (s2.dragon7RateOnSBF + s3.dragon7RateOnSBF) / 2;
  const grossDragonProfit = 2.0; // in units of B, per hit
  const costPerBet = 1 / 20;    // B/20 per bet placed
  const expectedDragonEV = d7Rate / 100 * grossDragonProfit - costPerBet;
  console.log('Dragon side bet EV on SBF hands (theoretical):');
  console.log(`  D7 rate on SBF hands: ~${fmt(d7Rate, 3)}%`);
  console.log(`  Gross payout per hit: 40 × (B/20) = +2B`);
  console.log(`  Cost per bet placed: B/20`);
  console.log(`  Expected net per side bet (in B units): ${fmt(expectedDragonEV, 5)}`);
  console.log(`  (Positive = hedge pays for itself on average; negative = drag)`);
  console.log();

  // House edge on Dragon 7 side bet itself
  // Theoretical D7 prob ≈ 2.252%, payout 40:1
  const p7 = 0.02252;
  const d7HouseEdge = -(p7 * 40 - (1 - p7) * 1);
  console.log('Dragon 7 side bet house edge (standalone, 8 decks):');
  console.log(`  P(Dragon 7) ≈ ${fmt(p7 * 100, 3)}%  |  Payout 40:1`);
  console.log(`  House edge ≈ ${fmt(d7HouseEdge * 100, 2)}%`);
  console.log(`  The side bet is a negative-EV proposition, but its 40:1 payout`);
  console.log(`  acts as a partial hedge against large banker losses in streaks.`);
  console.log();

  console.log('Key takeaway:');
  if (s3.meanDrawdown < s1.meanDrawdown && Math.abs(d3) < Math.abs(d2)) {
    console.log('  Damage-control hedging offers a drawdown reduction relative to');
    console.log('  always-hedging with a smaller EV cost, since it only activates');
    console.log('  when the half-martingale is already in an elevated-exposure phase.');
  } else {
    console.log('  The Dragon 7 hedge adds a secondary negative-EV layer to the strategy.');
    console.log('  However, selective hedging (≥2 losses) limits the drag to high-risk');
    console.log('  periods where the catastrophic-protection value is highest.');
  }
}

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log('═'.repeat(89));
  console.log('  Second Bank Frank — EZ Baccarat + Dragon 7 Hedge Backtest');
  console.log(`  ${NUM_SIMS} simulations × ${NUM_HANDS.toLocaleString()} hands | Starting bankroll: $${START_BK.toLocaleString()}`);
  console.log('  Variants: (1) EZ No Hedge  (2) Dragon Always (B/20)  (3) Dragon after ≥2 SBF losses');
  console.log('═'.repeat(89));

  const stats1 = runVariant('ez',             '1. EZ Baccarat — No Hedge');
  const stats2 = runVariant('dragon_always',  '2. EZ + Dragon Hedge (always, B/20)');
  const stats3 = runVariant('dragon_damage',  '3. EZ + Dragon Hedge (≥2 consecutive SBF losses)');

  console.log('\n' + '═'.repeat(89));
  console.log('  RESULTS COMPARISON TABLE');
  console.log('═'.repeat(89));

  printTable(stats1, stats2, stats3);
  printAnalysis(stats1, stats2, stats3);

  console.log('\n' + '═'.repeat(89));
})();
