'use strict';

// ============================================================
// Second Bank Frank Strategy — Standard vs EZ Baccarat Backtest
// 1,000 simulations × 10,000 hands each
// ============================================================

const NUM_SIMS    = 1000;
const NUM_HANDS   = 10000;
const START_BK    = 10000;
const BASE_BET    = 100;
const MIN_BET     = 1;

// ── Deck / Shoe ──────────────────────────────────────────────
function buildShoe(numDecks = 8) {
  const shoe = [];
  for (let d = 0; d < numDecks; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        shoe.push(Math.min(rank, 10) % 10); // A=1, 2-9=face, 10/J/Q/K=0
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
// Returns { playerCards, bankerCards, winner: 'player'|'banker'|'tie' }
function dealHand(shoe, cursor) {
  // Deal: P1 B1 P2 B2
  const p = [shoe[cursor++], shoe[cursor++]];
  // wait — standard deal order: P B P B
  // Let me redo with proper alternating deal
  return { cursor }; // placeholder — see dealHandProper below
}

function dealHandProper(shoe, pos) {
  let i = pos;
  const playerCards = [shoe[i++], shoe[i++]]; // P1, P2 after interleave
  const bankerCards = [shoe[i - 3] ?? null, shoe[i - 2] ?? null]; // not right

  // Simplest correct approach: P1 B1 P2 B2
  i = pos;
  const pC = [shoe[i], shoe[i + 2]];
  const bC = [shoe[i + 1], shoe[i + 3]];
  i += 4;

  let pVal = handValue(pC);
  let bVal = handValue(bC);

  let playerDraw = null;
  let bankerDraw = null;

  // Natural: 8 or 9 — no draw
  if (pVal >= 8 || bVal >= 8) {
    // natural — stand
  } else {
    // Player third card rule
    if (pVal <= 5) {
      playerDraw = shoe[i++];
      pC.push(playerDraw);
      pVal = handValue(pC);
    }
    // else player stands (6 or 7)

    // Banker third card rule
    if (playerDraw === null) {
      // Player stood — banker draws on 0-5, stands on 6-7
      if (bVal <= 5) {
        bankerDraw = shoe[i++];
        bC.push(bankerDraw);
        bVal = handValue(bC);
      }
    } else {
      // Player drew — banker rules based on player's third card
      const p3 = playerDraw;
      let bankerDraws = false;
      if      (bVal <= 2) bankerDraws = true;
      else if (bVal === 3) bankerDraws = (p3 !== 8);
      else if (bVal === 4) bankerDraws = (p3 >= 2 && p3 <= 7);
      else if (bVal === 5) bankerDraws = (p3 >= 4 && p3 <= 7);
      else if (bVal === 6) bankerDraws = (p3 === 6 || p3 === 7);
      // bVal === 7: stand

      if (bankerDraws) {
        bankerDraw = shoe[i++];
        bC.push(bankerDraw);
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

  // Panda 8: player wins with exactly 3 cards totaling 8
  const isPanda8  = (winner === 'player' && pC.length === 3 && pVal === 8);

  return {
    nextPos: i,
    playerCards: pC,
    bankerCards: bC,
    playerVal: pVal,
    bankerVal: bVal,
    winner,
    isDragon7,
    isPanda8,
  };
}

// ── Strategy State ────────────────────────────────────────────
function freshState() {
  return {
    consecutivePlayers: 0,  // consecutive Player wins (ties ignored)
    phase: 'waiting',       // 'waiting' | 'confirming' | 'betting'
    betSize: BASE_BET,
  };
}

// Half-martingale sizing
function adjustBet(state, won) {
  if (won) {
    state.betSize = Math.max(MIN_BET, state.betSize / 4);
  } else {
    state.betSize = Math.max(MIN_BET, state.betSize * 1.5);
  }
}

// Kelly cap: 5% of current bankroll
function kellyBet(bankroll, rawBet) {
  const cap = bankroll * 0.05;
  return Math.max(MIN_BET, Math.min(rawBet, cap));
}

// ── Single Simulation ─────────────────────────────────────────
function runSim(ezMode) {
  const shoe = buildShoe(8);
  shuffle(shoe);
  let pos = 0;

  let bankroll    = START_BK;
  let state       = freshState();
  let maxBankroll = START_BK;
  let maxDrawdown = 0;
  let peak        = START_BK;

  // Stats
  let opportunities  = 0;
  let betsPlaced     = 0;
  let wins           = 0;
  let losses         = 0;
  let pushes         = 0;   // Dragon 7 pushes on our bet
  let totalWagered   = 0;
  let totalPnl       = 0;
  let dragon7Count   = 0;   // Dragon 7 occurrences (all hands)
  let panda8Count    = 0;
  let allHands       = 0;

  for (let h = 0; h < NUM_HANDS; h++) {
    // Reshuffle check
    if (shoe.length - pos < 26) {
      const fresh = buildShoe(8);
      shuffle(fresh);
      shoe.splice(0, shoe.length, ...fresh);
      pos = 0;
      // Reset state on reshuffle (fresh shoe)
      state = freshState();
    }

    if (pos + 6 > shoe.length) break; // safety

    const result = dealHandProper(shoe, pos);
    pos = result.nextPos;
    allHands++;

    if (result.isDragon7) dragon7Count++;
    if (result.isPanda8)  panda8Count++;

    const winner = result.winner;

    // ── Strategy logic ──────────────────────────────────────
    let betPlaced = false;
    let betAmt    = 0;
    let pnl       = 0;

    if (state.phase === 'waiting') {
      if (winner === 'player') {
        state.consecutivePlayers++;
      } else if (winner === 'banker') {
        if (state.consecutivePlayers >= 3) {
          // Confirmation banker win — move to betting phase
          state.phase = 'betting';
          opportunities++;
          state.betSize = BASE_BET; // reset sizing on new opportunity
        }
        state.consecutivePlayers = 0;
      }
      // tie: ignore streak
    } else if (state.phase === 'betting') {
      // Bet this hand (the second banker after confirmation)
      betPlaced = true;
      betAmt    = kellyBet(bankroll, state.betSize);
      betAmt    = Math.round(betAmt * 100) / 100;
      totalWagered += betAmt;
      betsPlaced++;

      if (winner === 'banker') {
        if (ezMode && result.isDragon7) {
          // Dragon 7 push — return bet, no P&L
          pushes++;
          pnl = 0;
          // Don't adjust bet on push — treat as neutral
          // Reset to waiting
          state.phase = 'waiting';
          state.consecutivePlayers = 0;
        } else {
          // Win
          const payout = ezMode ? 1.0 : 0.95; // EZ=1:1, Standard=0.95:1
          pnl = betAmt * payout;
          wins++;
          adjustBet(state, true);
          // Reset to waiting after a win
          state.phase = 'waiting';
          state.consecutivePlayers = 0;
        }
      } else if (winner === 'player') {
        pnl = -betAmt;
        losses++;
        adjustBet(state, false);
        // Keep betting next hand? No — strategy says bet the SECOND banker.
        // After a loss, we go back to waiting for next setup.
        state.phase = 'waiting';
        state.consecutivePlayers = 0;
      } else {
        // Tie — bet stands (pushed to next hand), don't count streak change
        // Most casinos: tie on a placed bet returns money or carries over.
        // Here we model as carry-over (no resolution, same bet next hand).
        pnl = 0;
        // stay in betting phase — tie doesn't resolve the bet
      }

      bankroll += pnl;
      totalPnl += pnl;

      if (bankroll <= 0) {
        bankroll = 0;
        break; // bust
      }
    } else {
      // Should not reach here
    }

    // Also update waiting-phase streak when NOT betting
    if (!betPlaced && state.phase === 'waiting') {
      // Already handled above in the waiting branch
    }

    // Drawdown tracking
    if (bankroll > peak) peak = bankroll;
    const dd = peak - bankroll;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    finalBankroll: bankroll,
    maxDrawdown,
    opportunities,
    betsPlaced,
    wins,
    losses,
    pushes,
    totalWagered,
    totalPnl,
    dragon7Count,
    panda8Count,
    allHands,
  };
}

// ── Aggregate Stats ───────────────────────────────────────────
function mean(arr)   { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(count, total) { return ((count / total) * 100).toFixed(2) + '%'; }
function fmt(n, dec = 2)   { return n.toFixed(dec); }

function runAllSims(ezMode, label) {
  console.log(`\nRunning ${NUM_SIMS} simulations (${label})...`);
  const results = [];
  for (let s = 0; s < NUM_SIMS; s++) {
    results.push(runSim(ezMode));
    if ((s + 1) % 100 === 0) process.stdout.write(`  ${s + 1}/${NUM_SIMS}\r`);
  }
  console.log(`  ${NUM_SIMS}/${NUM_SIMS} — done.          `);
  return results;
}

function aggregate(results) {
  const finals       = results.map(r => r.finalBankroll);
  const drawdowns    = results.map(r => r.maxDrawdown);
  const opps         = results.map(r => r.opportunities);
  const bets         = results.map(r => r.betsPlaced);

  const totalBets    = results.reduce((a, r) => a + r.betsPlaced, 0);
  const totalWins    = results.reduce((a, r) => a + r.wins, 0);
  const totalLosses  = results.reduce((a, r) => a + r.losses, 0);
  const totalPushes  = results.reduce((a, r) => a + r.pushes, 0);
  const totalWagered = results.reduce((a, r) => a + r.totalWagered, 0);
  const totalPnl     = results.reduce((a, r) => a + r.totalPnl, 0);
  const totalD7      = results.reduce((a, r) => a + r.dragon7Count, 0);
  const totalP8      = results.reduce((a, r) => a + r.panda8Count, 0);
  const totalHands   = results.reduce((a, r) => a + r.allHands, 0);

  const profitable   = finals.filter(f => f > START_BK).length;
  const bust         = finals.filter(f => f <= 0).length;

  const winRateExclPush = totalBets > 0
    ? (totalWins / (totalBets - totalPushes)) * 100
    : 0;

  const pushRate = totalBets > 0
    ? (totalPushes / totalBets) * 100
    : 0;

  const evPerBet = totalBets > 0
    ? totalPnl / totalBets
    : 0;

  const dragon7Rate  = totalHands > 0 ? (totalD7 / totalHands) * 100 : 0;
  const panda8Rate   = totalHands > 0 ? (totalP8 / totalHands) * 100 : 0;

  return {
    meanFinal:        mean(finals),
    medianFinal:      median(finals),
    profitable,
    bust,
    winRateExclPush,
    pushRate,
    meanOpps:         mean(opps),
    meanDrawdown:     mean(drawdowns),
    evPerBet,
    totalBets,
    totalWins,
    totalLosses,
    totalPushes,
    dragon7Rate,
    panda8Rate,
    totalHands,
  };
}

// ── Theoretical House Edge ────────────────────────────────────
// Standard 8-deck baccarat Banker bet:
//   Win prob ≈ 0.4585895, Tie ≈ 0.0951335, Player win ≈ 0.4462770
//   Commission 5% → EV = 0.4585895×0.95 − 0.4462770×1 = 0.4356600 − 0.4462770 = −0.010638 ≈ −1.06%
//
// EZ Baccarat Banker bet (no commission, Dragon 7 push):
//   Dragon 7 probability (banker 3-card 7) ≈ 0.02252 of all hands
//   Effective win on Banker bet = P(bank win) - P(dragon7) = 0.4585895 - 0.02252 = 0.43607
//   Push = 0.02252
//   Loss = P(player win) = 0.44628
//   EV = 0.43607×1 + 0.02252×0 − 0.44628×1 = −0.01021 ≈ −1.02%

const STD_BANKER_EDGE = (() => {
  const pBankWin = 0.458597;
  const pPlrWin  = 0.446247;
  // pTie = 0.095156 — irrelevant for banker bet resolution
  return pBankWin * 0.95 - pPlrWin * 1.0;
})();

const EZ_BANKER_EDGE = (() => {
  const pBankWin = 0.458597;
  const pPlrWin  = 0.446247;
  const pD7      = 0.022516; // Dragon 7 ≈ 2.25% of all hands
  const pEzWin   = pBankWin - pD7;  // wins that aren't Dragon 7
  return pEzWin * 1.0 + pD7 * 0.0 - pPlrWin * 1.0;
})();

// ── Main ──────────────────────────────────────────────────────
(async () => {
  console.log('═'.repeat(70));
  console.log('  Second Bank Frank Strategy — Standard vs EZ Baccarat Backtest');
  console.log(`  ${NUM_SIMS} simulations × ${NUM_HANDS.toLocaleString()} hands | Starting bankroll: ${START_BK.toLocaleString()}`);
  console.log('═'.repeat(70));

  const stdResults = runAllSims(false, 'Standard Banker 5% Commission');
  const ezResults  = runAllSims(true,  'EZ Baccarat (Dragon 7 Push)');

  const stdStats = aggregate(stdResults);
  const ezStats  = aggregate(ezResults);

  // ── Side-by-Side Table ──────────────────────────────────────
  const W  = 28;
  const C1 = 30;
  const C2 = 18;
  const C3 = 18;

  const row = (label, v1, v2) => {
    console.log(
      label.padEnd(C1) +
      String(v1).padStart(C2) +
      String(v2).padStart(C3)
    );
  };
  const divider = () => console.log('─'.repeat(C1 + C2 + C3));
  const header  = (t) => console.log('\n' + t);

  console.log('\n');
  console.log(
    'Metric'.padEnd(C1) +
    'Standard (5% comm)'.padStart(C2) +
    'EZ Baccarat (D7)'.padStart(C3)
  );
  divider();

  header('── Bankroll Outcomes ──');
  row('Mean Final Bankroll',
    '$' + fmt(stdStats.meanFinal),
    '$' + fmt(ezStats.meanFinal));
  row('Median Final Bankroll',
    '$' + fmt(stdStats.medianFinal),
    '$' + fmt(ezStats.medianFinal));
  row('% Profitable (> start)',
    pct(stdStats.profitable, NUM_SIMS),
    pct(ezStats.profitable, NUM_SIMS));
  row('% Bust (= 0)',
    pct(stdStats.bust, NUM_SIMS),
    pct(ezStats.bust, NUM_SIMS));

  header('── Bet Performance ──');
  row('Win Rate (excl. pushes)',
    fmt(stdStats.winRateExclPush) + '%',
    fmt(ezStats.winRateExclPush) + '%');
  row('Push Rate (Dragon 7 on bets)',
    fmt(stdStats.pushRate) + '%',
    fmt(ezStats.pushRate) + '%');
  row('EV per Bet (units)',
    fmt(stdStats.evPerBet, 4),
    fmt(ezStats.evPerBet, 4));
  row('Total Bets (all sims)',
    stdStats.totalBets.toLocaleString(),
    ezStats.totalBets.toLocaleString());
  row('Total Wins',
    stdStats.totalWins.toLocaleString(),
    ezStats.totalWins.toLocaleString());
  row('Total Losses',
    stdStats.totalLosses.toLocaleString(),
    ezStats.totalLosses.toLocaleString());
  row('Total Pushes (Dragon 7)',
    stdStats.totalPushes.toLocaleString(),
    ezStats.totalPushes.toLocaleString());

  header('── Opportunities & Drawdown ──');
  row('Mean Opps per 10k hands',
    fmt(stdStats.meanOpps, 1),
    fmt(ezStats.meanOpps, 1));
  row('Mean Max Drawdown',
    '$' + fmt(stdStats.meanDrawdown),
    '$' + fmt(ezStats.meanDrawdown));

  header('── Global Hand Stats ──');
  row('Dragon 7 rate (all hands)',
    '—',
    fmt(ezStats.dragon7Rate, 3) + '%');
  row('Panda 8 rate (all hands)',
    fmt(stdStats.panda8Rate, 3) + '%',
    fmt(ezStats.panda8Rate, 3) + '%');
  row('Total Hands Simulated',
    stdStats.totalHands.toLocaleString(),
    ezStats.totalHands.toLocaleString());

  header('── Theoretical House Edge (Banker Bet) ──');
  row('House Edge',
    fmt(STD_BANKER_EDGE * -100, 4) + '%',
    fmt(EZ_BANKER_EDGE * -100, 4) + '%');
  row('Player EV',
    fmt(STD_BANKER_EDGE * 100, 4) + '%',
    fmt(EZ_BANKER_EDGE * 100, 4) + '%');

  divider();

  // ── Interpretation ──────────────────────────────────────────
  console.log('\n── Analysis ──');
  console.log();
  console.log('Standard Banker (5% commission):');
  console.log(`  House edge ≈ ${fmt(STD_BANKER_EDGE * -100, 4)}%  |  Banker wins pay 0.95:1`);
  console.log(`  Win rate on SBF bets: ${fmt(stdStats.winRateExclPush, 2)}%`);
  console.log(`  Mean bankroll change: ${fmt(stdStats.meanFinal - START_BK, 2)} units (${fmt((stdStats.meanFinal / START_BK - 1) * 100, 2)}%)`);

  console.log();
  console.log('EZ Baccarat (no commission, Dragon 7 push):');
  console.log(`  House edge ≈ ${fmt(EZ_BANKER_EDGE * -100, 4)}%  |  Banker wins pay 1:1 (except D7 = push)`);
  console.log(`  Win rate on SBF bets (excl push): ${fmt(ezStats.winRateExclPush, 2)}%`);
  console.log(`  Push rate on SBF bets: ${fmt(ezStats.pushRate, 2)}%`);
  console.log(`  Mean bankroll change: ${fmt(ezStats.meanFinal - START_BK, 2)} units (${fmt((ezStats.meanFinal / START_BK - 1) * 100, 2)}%)`);

  console.log();
  const edgeDiff = (EZ_BANKER_EDGE - STD_BANKER_EDGE) * 100;
  console.log(`EZ vs Standard house edge difference: ${fmt(edgeDiff, 4)}%`);
  if (edgeDiff > 0) {
    console.log('  → EZ Baccarat has a lower house edge on the Banker bet.');
    console.log('    The 1:1 payout partially compensates for the Dragon 7 push.');
  }

  const evDiff = ezStats.evPerBet - stdStats.evPerBet;
  console.log(`SBF EV differential (EZ − Standard): ${fmt(evDiff, 4)} units/bet`);

  console.log();
  console.log('Note on Kelly Cap:');
  console.log('  Banker win rates are near 46%, below the 50% threshold needed');
  console.log('  for a positive Kelly fraction. Fractional Kelly = 5% bankroll cap');
  console.log('  is applied to prevent ruin from the negative-EV baseline.');
  console.log('  The strategy profits only via clustering / streak exploitation,');
  console.log('  not from a genuine mathematical edge over the house.');

  console.log('\n' + '═'.repeat(70));
})();
