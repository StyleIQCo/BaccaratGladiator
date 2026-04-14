'use strict';

// ============================================================
// EZ Baccarat Simulation — DEEP PENETRATION (97% shoe pen)
// 8-deck shoe, reshuffle when < 14 cards remain (NOT 104)
// 402 of 416 cards dealt per shoe
// ============================================================
// RULES NOTES:
//   Dragon 7 side bet: pays 40:1 when banker WINS with exactly 3 cards totaling 7
//     (hit rate ~2.25% per WoO; main banker bet PUSHES on Dragon7)
//   Panda 8 side bet: pays 25:1 when player WINS with exactly 3 cards totaling 8
//     (hit rate ~3.50% per WoO)
//   Ties: main bets push, side bets lose, streaks unchanged
// ============================================================

// ─────────────────────────────────────────────────────────────
// SHARED DECK / SHOE UTILITIES
// ─────────────────────────────────────────────────────────────

function buildShoe(numDecks = 8) {
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

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(rank) {
  if (rank >= 10) return 0;
  return rank;
}

function handTotal(cards) {
  return cards.reduce((s, c) => (s + cardValue(c)) % 10, 0);
}

function dealHand(shoe, cursor) {
  const playerCards = [shoe[cursor], shoe[cursor + 2]];
  const bankerCards = [shoe[cursor + 1], shoe[cursor + 3]];
  let cur = cursor + 4;

  const pTotal = handTotal(playerCards);
  const bTotal = handTotal(bankerCards);

  if (pTotal >= 8 || bTotal >= 8) {
    return { playerCards, bankerCards, cursor: cur };
  }

  let playerDrew = false;
  let playerThird = null;
  if (pTotal <= 5) {
    playerThird = shoe[cur++];
    playerCards.push(playerThird);
    playerDrew = true;
  }

  if (!playerDrew) {
    if (bTotal <= 5) bankerCards.push(shoe[cur++]);
  } else {
    const pThirdVal = cardValue(playerThird);
    if (bTotal <= 2) {
      bankerCards.push(shoe[cur++]);
    } else if (bTotal === 3 && pThirdVal !== 8) {
      bankerCards.push(shoe[cur++]);
    } else if (bTotal === 4 && pThirdVal >= 2 && pThirdVal <= 7) {
      bankerCards.push(shoe[cur++]);
    } else if (bTotal === 5 && pThirdVal >= 4 && pThirdVal <= 7) {
      bankerCards.push(shoe[cur++]);
    } else if (bTotal === 6 && pThirdVal >= 6 && pThirdVal <= 7) {
      bankerCards.push(shoe[cur++]);
    }
  }

  return { playerCards, bankerCards, cursor: cur };
}

function getOutcome(playerCards, bankerCards) {
  const pFinal = handTotal(playerCards);
  const bFinal = handTotal(bankerCards);

  let winner;
  if (bFinal > pFinal) winner = 'B';
  else if (pFinal > bFinal) winner = 'P';
  else winner = 'T';

  // Dragon 7: banker WINS with exactly 3 cards totaling 7 (main banker bet pushes)
  const isDragon7 = (winner === 'B' && bankerCards.length === 3 && bFinal === 7);
  // Panda 8: player WINS with exactly 3 cards totaling 8
  const isPanda8  = (winner === 'P' && playerCards.length === 3 && pFinal === 8);

  const bankerMainPush = isDragon7; // EZ rule: no commission, Dragon7 pushes main banker bet

  const isNatural = (handTotal(playerCards.slice(0,2)) >= 8 ||
                     handTotal(bankerCards.slice(0,2)) >= 8);

  return { winner, isDragon7, isPanda8, bankerMainPush, pFinal, bFinal, isNatural,
           numPlayerCards: playerCards.length, numBankerCards: bankerCards.length };
}

// ─────────────────────────────────────────────────────────────
// COUNTING SYSTEMS
// Dragon 7: 7→-3, 8/9→-1, 10/J/Q/K→+1, A/2/3/4→+0.5, 5/6→0
// Panda 8:  8→-3, 9→-0.5, 10/J/Q/K→+1, A/2/3/4→+0.5, 5/6/7→0
// True Count = Running Count / (cards remaining / 52)
// ─────────────────────────────────────────────────────────────

function dragonCountVal(rank) {
  if (rank === 7)  return -3;
  if (rank === 8 || rank === 9) return -1;
  if (rank >= 10)  return 1;   // 10, J, Q, K
  if (rank <= 4)   return 0.5; // A=1, 2, 3, 4
  return 0;                    // 5, 6
}

function pandaCountVal(rank) {
  if (rank === 8)  return -3;
  if (rank === 9)  return -0.5;
  if (rank >= 10)  return 1;   // 10, J, Q, K
  if (rank <= 4)   return 0.5; // A=1, 2, 3, 4
  return 0;                    // 5, 6, 7
}

// ─────────────────────────────────────────────────────────────
// STATISTICS HELPERS
// ─────────────────────────────────────────────────────────────

function chiSquared(observed, total, expectedRate) {
  if (total < 10) return { chi2: 0, pValue: 1 };
  const expected = total * expectedRate;
  const expectedNo = total * (1 - expectedRate);
  const observedNo = total - observed;
  if (expected < 5 || expectedNo < 5) return { chi2: 0, pValue: 1 };
  const chi2 = Math.pow(observed - expected, 2) / expected +
               Math.pow(observedNo - expectedNo, 2) / expectedNo;
  return { chi2, pValue: chiSqP(chi2) };
}

function chiSqP(chi2) {
  // Abramowitz & Stegun erfc approximation for chi-sq p-value with 1 df
  const x = Math.sqrt(chi2 / 2);
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.max(0, Math.min(1, poly * Math.exp(-x * x)));
}

function verdict(pValue, lift, n) {
  if (n < 100) return 'INSUFF DATA';
  if (pValue < 0.05 && lift > 1.05) return 'PREDICTIVE (+)';
  if (pValue < 0.05 && lift < (1 / 1.05)) return 'PREDICTIVE (-)';
  if (pValue < 0.05) return 'SIG (no lift)';
  return 'NOISE';
}

function pctile(sorted, p) {
  return sorted[Math.floor(p * sorted.length)];
}

function avg(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ─────────────────────────────────────────────────────────────
// PART 1: COUNT THRESHOLD SCAN
// Scan Dragon 7 and Panda 8 true-count thresholds for predictive lift.
// Deep penetration: reshuffle at < 14 cards remaining (97% pen).
// ─────────────────────────────────────────────────────────────

function runCountThresholdScan(numShoes = 5000) {
  console.log('\n' + '='.repeat(72));
  console.log('PART 1: COUNT THRESHOLD SCAN — DEEP PENETRATION (97% shoe pen)');
  console.log('='.repeat(72));
  console.log(`Config: ${numShoes} shoes × 8 decks | reshuffle at < 14 cards remaining`);
  console.log('True Count = Running Count / (cards remaining / 52)');
  console.log('Dragon 7 count:  7→-3, 8/9→-1, 10/J/Q/K→+1, A-4→+0.5, 5/6→0');
  console.log('Panda 8 count:   8→-3, 9→-0.5, 10/J/Q/K→+1, A-4→+0.5, 5/6/7→0');
  console.log('Dragon 7 side bet: 40:1, pays when banker WINS with 3-card 7');
  console.log('Panda 8 side bet:  25:1, pays when player WINS with 3-card 8');
  console.log('Running...\n');

  const NUM_DECKS    = 8;
  const TOTAL_CARDS  = NUM_DECKS * 52; // 416
  const RESHUFFLE_AT = 14;             // 97% penetration
  const THRESHOLDS   = [4, 6, 8, 10, 12, 15, 20, 25, 30];
  const DRAGON_PAY   = 40;             // 40:1
  const PANDA_PAY    = 25;             // 25:1

  // Per-threshold accumulators
  const dT = THRESHOLDS.map(tc => ({ tc, n: 0, hits: 0, pnl: 0 }));
  const pT = THRESHOLDS.map(tc => ({ tc, n: 0, hits: 0, pnl: 0 }));

  let totalHands = 0;
  let totalDragon7 = 0; // banker-win 3-card 7
  let totalPanda8  = 0; // player-win 3-card 8

  for (let s = 0; s < numShoes; s++) {
    let shoe = shuffle(buildShoe(NUM_DECKS));
    let cursor = 0;
    let dRC = 0;
    let pRC = 0;

    while (true) {
      const remaining = TOTAL_CARDS - cursor;
      if (remaining < RESHUFFLE_AT || cursor + 6 > TOTAL_CARDS) break;

      const decksRem = remaining / 52;
      const dTC = dRC / decksRem;
      const pTC = pRC / decksRem;

      const { playerCards, bankerCards, cursor: newCursor } = dealHand(shoe, cursor);
      cursor = newCursor;
      const out = getOutcome(playerCards, bankerCards);

      totalHands++;
      if (out.isDragon7) totalDragon7++;
      if (out.isPanda8)  totalPanda8++;

      // Update counts after seeing cards
      for (const c of playerCards) { dRC += dragonCountVal(c); pRC += pandaCountVal(c); }
      for (const c of bankerCards)  { dRC += dragonCountVal(c); pRC += pandaCountVal(c); }

      // Evaluate threshold performance (using pre-hand TC)
      for (const t of dT) {
        if (dTC >= t.tc) {
          t.n++;
          // Side bet = 1 unit; wins pay 40 net, losses cost 1 unit
          t.pnl += out.isDragon7 ? DRAGON_PAY : -1;
          if (out.isDragon7) t.hits++;
        }
      }
      for (const t of pT) {
        if (pTC >= t.tc) {
          t.n++;
          t.pnl += out.isPanda8 ? PANDA_PAY : -1;
          if (out.isPanda8) t.hits++;
        }
      }
    }
  }

  const baselineDragon = totalDragon7 / totalHands;
  const baselinePanda  = totalPanda8  / totalHands;

  function printTable(label, threshArr, baseRate, betPayout) {
    console.log(`── ${label} ` + '─'.repeat(Math.max(2, 70 - label.length - 4)));
    console.log(`Baseline hit rate (of all hands): ${(baseRate * 100).toFixed(4)}%`);
    console.log(`House edge baseline: ${((baseRate * betPayout - (1 - baseRate)) * 100).toFixed(3)}%`);
    console.log('');

    const hdr =
      'TC >='.padEnd(7) +
      'Hands(N)'.padStart(12) +
      '% hands'.padStart(10) +
      'Hit rate'.padStart(11) +
      'Baseline'.padStart(11) +
      'Lift'.padStart(8) +
      'EV/unit'.padStart(10) +
      'EV%'.padStart(8) +
      'p-value'.padStart(12) +
      '  Verdict';
    console.log(hdr);
    console.log('-'.repeat(104));

    let bestTC   = null;
    let bestEV   = -Infinity;
    let bestRow  = null;

    for (const t of threshArr) {
      if (t.n === 0) {
        console.log(`TC>=${t.tc}`.padEnd(7) + '  (no hands at this threshold)');
        continue;
      }
      const hitRate  = t.hits / t.n;
      const lift     = baseRate > 0 ? hitRate / baseRate : 0;
      const evPerUnit = t.pnl / t.n;        // EV per 1-unit side bet
      const evPct    = evPerUnit * 100;      // as % of 1-unit bet
      const { pValue } = chiSquared(t.hits, t.n, baseRate);
      const v = verdict(pValue, lift, t.n);
      const pctHands = (t.n / totalHands * 100).toFixed(3);

      console.log(
        String(t.tc).padEnd(7) +
        t.n.toLocaleString().padStart(12) +
        (pctHands + '%').padStart(10) +
        (hitRate * 100).toFixed(4).padStart(10) + '%' +
        (baseRate * 100).toFixed(4).padStart(10) + '%' +
        lift.toFixed(4).padStart(8) +
        evPerUnit.toFixed(5).padStart(10) +
        evPct.toFixed(3).padStart(7) + '%' +
        pValue.toExponential(2).padStart(12) +
        '  ' + v
      );

      if (evPerUnit > bestEV) {
        bestEV  = evPerUnit;
        bestTC  = t.tc;
        bestRow = { hitRate, lift, evPerUnit, evPct, n: t.n, pValue, v };
      }
    }
    console.log('');
    if (bestRow) {
      console.log(`  Best TC by EV: TC >= ${bestTC}`);
      console.log(`    Hands at threshold: ${bestRow.n.toLocaleString()} (${(bestRow.n/totalHands*100).toFixed(2)}% of all hands)`);
      console.log(`    Hit rate: ${(bestRow.hitRate*100).toFixed(4)}%  vs baseline ${(baseRate*100).toFixed(4)}%  (lift ${bestRow.lift.toFixed(4)})`);
      console.log(`    EV per unit bet: ${bestRow.evPerUnit.toFixed(5)} units (${bestRow.evPct.toFixed(3)}%)`);
      console.log(`    p-value: ${bestRow.pValue.toExponential(3)}  |  Verdict: ${bestRow.v}`);
      if (bestRow.evPerUnit > 0) {
        console.log(`  *** POSITIVE EV FOUND at TC >= ${bestTC} — verify carefully ***`);
      } else {
        console.log(`  All thresholds negative EV. Best is least-bad at TC >= ${bestTC}.`);
      }
    }
    console.log('');
    return { bestTC, bestEV, baseRate };
  }

  const dragonResult = printTable(
    'DRAGON 7  (pays 40:1 on banker WIN with 3-card 7)',
    dT, baselineDragon, DRAGON_PAY
  );
  const pandaResult = printTable(
    'PANDA 8   (pays 25:1 on player WIN with 3-card 8)',
    pT, baselinePanda, PANDA_PAY
  );

  console.log('── PART 1 SUMMARY ───────────────────────────────────────────────────────');
  console.log(`Total hands simulated:       ${totalHands.toLocaleString()}`);
  console.log(`Average hands per shoe:      ${(totalHands / numShoes).toFixed(1)}`);
  console.log(`Baseline Dragon 7 rate:      ${(baselineDragon * 100).toFixed(4)}%  (banker-win 3-card 7)`);
  console.log(`Baseline Panda 8 rate:       ${(baselinePanda  * 100).toFixed(4)}%  (player-win 3-card 8)`);
  console.log(`Dragon 7 house edge (baseline): ${((baselineDragon * DRAGON_PAY - (1 - baselineDragon)) * 100).toFixed(3)}%`);
  console.log(`Panda 8 house edge (baseline):  ${((baselinePanda  * PANDA_PAY  - (1 - baselinePanda))  * 100).toFixed(3)}%`);
  console.log(`Best Dragon 7 threshold: TC >= ${dragonResult.bestTC}  (EV ${dragonResult.bestEV.toFixed(5)}/unit)`);
  console.log(`Best Panda 8 threshold:  TC >= ${pandaResult.bestTC}  (EV ${pandaResult.bestEV.toFixed(5)}/unit)`);
  console.log('');
  const dragonPositive = dragonResult.bestEV > 0;
  const pandaPositive  = pandaResult.bestEV  > 0;
  if (!dragonPositive && !pandaPositive) {
    console.log('CONCLUSION: Neither Dragon 7 nor Panda 8 becomes +EV at any TC threshold.');
    console.log('Even at 97% penetration, the count systems tested cannot overcome house edge.');
    console.log('This is consistent with baccarat card counting theory: true counts');
    console.log('fluctuate but the advantage window is too narrow to overcome the house edge.');
  } else {
    if (dragonPositive) console.log(`Dragon 7 shows +EV at TC >= ${dragonResult.bestTC} — but verify: may be simulation noise.`);
    if (pandaPositive)  console.log(`Panda 8 shows +EV at TC >= ${pandaResult.bestTC} — but verify: may be simulation noise.`);
    console.log('NOTE: With 5,000 shoes, sample sizes at high thresholds may be small.');
    console.log('Small N means high variance — run more shoes to confirm.');
  }
  console.log('');

  return {
    bestDragonTC: dragonResult.bestTC,
    bestPandaTC:  pandaResult.bestTC,
    baselineDragon,
    baselinePanda,
  };
}

// ─────────────────────────────────────────────────────────────
// PART 2: ROADS ANALYSIS — DEEP PENETRATION
// ─────────────────────────────────────────────────────────────

function derivedSignal(cols, offset) {
  if (cols.length < offset + 1) return null;
  const curColIdx = cols.length - 1;
  const cmpColIdx = curColIdx - offset;
  if (cmpColIdx < 0) return null;
  const curRowIdx = cols[curColIdx].length - 1;
  const cmpCol    = cols[cmpColIdx];
  return cmpCol.length > curRowIdx ? 'R' : 'C';
}

function simShoe(reshuffleAt = 14) {
  const TOTAL = 416;
  const shoe  = shuffle(buildShoe(8));
  let cursor  = 0;
  const hands = [];

  while (TOTAL - cursor >= reshuffleAt + 6) {
    const { playerCards, bankerCards, cursor: newCursor } = dealHand(shoe, cursor);
    cursor = newCursor;
    const out = getOutcome(playerCards, bankerCards);
    hands.push(out);
  }
  return hands;
}

function runRoadsAnalysis(numShoes = 10000) {
  console.log('\n' + '='.repeat(72));
  console.log('PART 2: SCOREBOARD ROADS PREDICTIVE POWER — DEEP PENETRATION');
  console.log('='.repeat(72));
  console.log(`Config: ${numShoes.toLocaleString()} simulated 8-deck shoes | reshuffle at < 14 cards`);
  console.log('Running simulation...\n');

  const P = {
    a:  { label: 'After 3+ Banker streak → next Banker?',          n:0, hit:0 },
    b:  { label: 'After 3+ Player streak → next Banker? (SBF)',    n:0, hit:0 },
    c:  { label: 'After streak of exactly 2 → streak continues?',  n:0, hit:0 },
    d:  { label: 'After chop 4+ alternating → chop continues?',    n:0, hit:0 },
    e:  { label: 'Last 6 split 3-3 → next matches last seen?',     n:0, hit:0 },
    f:  { label: 'Majority Banker (4+) in last 6 → next Banker?',  n:0, hit:0 },
    gR: { label: 'Big Eye Boy: Repetitive → next repeats?',        n:0, hit:0 },
    gC: { label: 'Big Eye Boy: Chaotic    → next switches?',       n:0, hit:0 },
    hR: { label: 'Small Road: Repetitive → next repeats?',         n:0, hit:0 },
    hC: { label: 'Small Road: Chaotic    → next switches?',        n:0, hit:0 },
    kR: { label: 'Cockroach:  Repetitive → next repeats?',         n:0, hit:0 },
    kC: { label: 'Cockroach:  Chaotic    → next switches?',        n:0, hit:0 },
    i:  { label: 'After natural (8/9) → Dragon 7 next hand?',      n:0, hit:0 },
    j:  { label: 'After 3+ Banker streak → Dragon 7 next?',        n:0, hit:0 },
    m:  { label: 'After Tie → Panda 8 next hand?',                 n:0, hit:0 },
    l1: { label: 'Current streak=1 → Dragon 7 this hand?',         n:0, hit:0 },
    l3: { label: 'Current streak=3+ → Dragon 7 this hand?',        n:0, hit:0 },
  };

  let totalHands = 0, totalNonTie = 0, totalBanker = 0;
  let totalDragon7 = 0, totalPanda8 = 0, totalTies = 0;

  for (let s = 0; s < numShoes; s++) {
    const hands = simShoe(14);

    const nonTie = [];
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      totalHands++;
      if (h.winner === 'T') { totalTies++; continue; }
      totalNonTie++;
      if (h.winner === 'B') totalBanker++;
      if (h.isDragon7) totalDragon7++;
      if (h.isPanda8)  totalPanda8++;
      nonTie.push({ ...h, origIdx: i });
    }

    const NT = nonTie.length;
    if (NT < 5) continue;

    const cols = [];

    for (let i = 0; i < NT - 1; i++) {
      const cur  = nonTie[i];
      const next = nonTie[i + 1];

      // Update Big Road columns
      const lastColWinner = cols.length > 0
        ? cols[cols.length - 1][cols[cols.length - 1].length - 1]
        : null;
      if (lastColWinner === null || cur.winner !== lastColWinner) {
        cols.push([cur.winner]);
      } else {
        cols[cols.length - 1].push(cur.winner);
      }

      const nextW = next.winner;

      // Streak length ending at i (non-tie sequence)
      let streak = 0;
      const streakW = cur.winner;
      for (let k = i; k >= 0; k--) {
        if (nonTie[k].winner === streakW) streak++;
        else break;
      }

      // Big Road patterns
      if (streak >= 3 && streakW === 'B') { P.a.n++; if (nextW === 'B') P.a.hit++; }
      if (streak >= 3 && streakW === 'P') { P.b.n++; if (nextW === 'B') P.b.hit++; }
      if (streak === 2)                   { P.c.n++; if (nextW === streakW) P.c.hit++; }

      if (i >= 3) {
        const l4 = nonTie.slice(i - 3, i + 1).map(x => x.winner);
        if (l4[0] !== l4[1] && l4[1] !== l4[2] && l4[2] !== l4[3]) {
          P.d.n++;
          if (nextW !== l4[3]) P.d.hit++; // chop continues = switches
        }
      }

      // Bead plate patterns
      if (i >= 5) {
        const last6  = nonTie.slice(i - 5, i + 1).map(x => x.winner);
        const bCount = last6.filter(w => w === 'B').length;
        if (bCount === 3) { P.e.n++; if (nextW === last6[5]) P.e.hit++; }
        if (bCount >= 4)  { P.f.n++; if (nextW === 'B') P.f.hit++; }
      }

      // Derived road signals
      const beSig = derivedSignal(cols, 1);
      const smSig = derivedSignal(cols, 2);
      const ckSig = derivedSignal(cols, 3);

      const nextRepeats  = nextW === cur.winner;
      const nextSwitches = nextW !== cur.winner;

      if (beSig === 'R') { P.gR.n++; if (nextRepeats)  P.gR.hit++; }
      if (beSig === 'C') { P.gC.n++; if (nextSwitches) P.gC.hit++; }
      if (smSig === 'R') { P.hR.n++; if (nextRepeats)  P.hR.hit++; }
      if (smSig === 'C') { P.hC.n++; if (nextSwitches) P.hC.hit++; }
      if (ckSig === 'R') { P.kR.n++; if (nextRepeats)  P.kR.hit++; }
      if (ckSig === 'C') { P.kC.n++; if (nextSwitches) P.kC.hit++; }

      // Dragon 7 / Panda 8 context patterns
      if (cur.isNatural) { P.i.n++; if (next.isDragon7) P.i.hit++; }
      if (streak >= 3 && streakW === 'B') { P.j.n++; if (next.isDragon7) P.j.hit++; }
      if (streak === 1) { P.l1.n++; if (cur.isDragon7) P.l1.hit++; }
      if (streak >= 3)  { P.l3.n++; if (cur.isDragon7) P.l3.hit++; }
    }

    // After Tie → Panda 8 next non-tie hand?
    for (let i = 0; i < hands.length - 1; i++) {
      if (hands[i].winner === 'T') {
        for (let j = i + 1; j < hands.length; j++) {
          if (hands[j].winner !== 'T') {
            P.m.n++;
            if (hands[j].isPanda8) P.m.hit++;
            break;
          }
        }
      }
    }
  }

  const baseBanker = totalBanker / totalNonTie;
  const baseDragon = totalDragon7 / totalNonTie;
  const basePanda  = totalPanda8  / totalNonTie;
  const baseCont   = 0.5;

  console.log(`Total hands simulated:    ${totalHands.toLocaleString()}`);
  console.log(`Total non-tie hands:      ${totalNonTie.toLocaleString()}`);
  console.log(`Ties:                     ${totalTies.toLocaleString()} (${(totalTies/totalHands*100).toFixed(2)}%)`);
  console.log(`Baseline Banker rate:     ${(baseBanker * 100).toFixed(4)}%`);
  console.log(`Baseline Dragon 7 rate:   ${(baseDragon * 100).toFixed(4)}% (per non-tie hand, banker-win 3-card 7)`);
  console.log(`Baseline Panda 8 rate:    ${(basePanda  * 100).toFixed(4)}% (per non-tie hand, player-win 3-card 8)`);
  console.log('');

  function row(pObj, baseRate) {
    const obs = pObj.n > 0 ? pObj.hit / pObj.n : 0;
    const { pValue } = chiSquared(pObj.hit, pObj.n, baseRate);
    const lift = baseRate > 0 ? obs / baseRate : 0;
    const v    = verdict(pValue, lift, pObj.n);
    const lbl  = pObj.label.length > 54 ? pObj.label.slice(0, 51) + '...' : pObj.label;
    console.log(
      lbl.padEnd(55) +
      String(pObj.n.toLocaleString()).padStart(10) +
      (baseRate * 100).toFixed(3).padStart(9) + '%' +
      (obs * 100).toFixed(3).padStart(9) + '%' +
      lift.toFixed(4).padStart(7) +
      pValue.toExponential(2).padStart(9) +
      '  ' + v
    );
    return { label: pObj.label, n: pObj.n, lift, p: pValue, v };
  }

  function hdr() {
    console.log(
      'Pattern'.padEnd(55) +
      'N'.padStart(10) +
      'Baseline'.padStart(10) +
      'Observed'.padStart(10) +
      'Lift'.padStart(7) +
      'p-val'.padStart(9) +
      '  Verdict'
    );
    console.log('-'.repeat(115));
  }

  const allR = [];

  console.log('── BIG ROAD PATTERNS ────────────────────────────────────────────────');
  hdr();
  allR.push(row(P.a, baseBanker));
  allR.push(row(P.b, baseBanker));
  allR.push(row(P.c, baseCont));
  allR.push(row(P.d, baseCont));

  console.log('');
  console.log('── BEAD PLATE PATTERNS ──────────────────────────────────────────────');
  hdr();
  allR.push(row(P.e, baseCont));
  allR.push(row(P.f, baseBanker));

  console.log('');
  console.log('── DERIVED ROADS (Big Eye Boy, Small Road, Cockroach) ───────────────');
  hdr();
  allR.push(row(P.gR, baseCont));
  allR.push(row(P.gC, baseCont));
  allR.push(row(P.hR, baseCont));
  allR.push(row(P.hC, baseCont));
  allR.push(row(P.kR, baseCont));
  allR.push(row(P.kC, baseCont));

  console.log('');
  console.log('── DRAGON 7 / PANDA 8 PATTERNS ─────────────────────────────────────');
  hdr();
  allR.push(row(P.i,  baseDragon));
  allR.push(row(P.j,  baseDragon));
  allR.push(row(P.m,  basePanda));
  allR.push(row(P.l1, baseDragon));
  allR.push(row(P.l3, baseDragon));

  console.log('');
  console.log('── FINAL SUMMARY ────────────────────────────────────────────────────');
  const predictive = allR.filter(r => r.v.startsWith('PREDICTIVE'));
  const sigNoLift  = allR.filter(r => r.v === 'SIG (no lift)');
  const noise      = allR.filter(r => r.v === 'NOISE');

  if (predictive.length === 0) {
    console.log('  NONE — all 17 patterns are NOISE (p>=0.05 or |lift-1| < 5%)');
  } else {
    for (const r of predictive) {
      console.log(`  [${r.v}] ${r.label}`);
      console.log(`         n=${r.n.toLocaleString()}, lift=${r.lift.toFixed(4)}, p=${r.p.toExponential(3)}`);
    }
  }
  console.log('');
  console.log(`  Predictive: ${predictive.length}  |  Sig/no-lift: ${sigNoLift.length}  |  Noise: ${noise.length}  |  Total: ${allR.length}`);

  console.log('');
  console.log('── INTERPRETATION ───────────────────────────────────────────────────');
  if (predictive.length === 0) {
    console.log('  All roads tested show NO predictive power beyond chance.');
    console.log('  Deep penetration (97%) does NOT improve scoreboard pattern prediction.');
    console.log('  Baccarat outcomes are statistically independent events regardless of');
    console.log('  how deep into the shoe you are. Scoreboards (Big Road, Big Eye Boy,');
    console.log('  Small Road, Cockroach) carry zero predictive signal in any condition.');
  } else {
    const allWeak = predictive.every(r => Math.abs(r.lift - 1) < 0.02);
    if (allWeak) {
      console.log('  Patterns are statistically significant but lifts < 2%.');
      console.log('  These are real but micro-scale card-composition artifacts from deep');
      console.log('  penetration — not exploitable after house edge.');
    } else {
      console.log('  NOTABLE: some patterns show meaningful lift with deep penetration.');
      console.log('  Bonferroni threshold for 17 tests: p < 0.003');
      const bonf = predictive.filter(r => r.p < 0.003);
      console.log(`  Surviving Bonferroni correction: ${bonf.length} pattern(s)`);
      for (const r of bonf) {
        console.log(`    → ${r.label}  (lift=${r.lift.toFixed(4)}, p=${r.p.toExponential(3)})`);
      }
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────
// PART 3: SBF STRATEGY FULL SIMULATION WITH DRAGON 7 COUNTING
// Three strategies compared on same shoe sequences:
//   A: SBF only (no side bets)
//   B: SBF + Dragon 7 side bet when TC >= bestDragonTC
//   C: SBF + Dragon 7 side bet always (every hand, uncounted)
//
// SBF: after 3+ consecutive player wins, the NEXT banker hand is bet.
//   (Classic SBF: 3P streak ends with a banker → bet that banker hand)
// Bet sizing: 100 base, ÷3 on win, ×1.5 on loss, 5% Kelly cap
// Dragon side bet = 5 units (base/20), flat regardless of Kelly
// Starting bankroll: 10,000 units
// ─────────────────────────────────────────────────────────────

function runSBFSim(numSims = 5000, bestDragonTC = 15, baselineDragon = 0.0225) {
  console.log('\n' + '='.repeat(72));
  console.log('PART 3: SBF STRATEGY + DRAGON 7 COUNT — DEEP PENETRATION');
  console.log('='.repeat(72));
  console.log(`Config: ${numSims} full shoes × SBF strategy | reshuffle at < 14 cards`);
  console.log(`SBF trigger: 3+ player streak → bet the banker that breaks it`);
  console.log(`Bet sizing: 100 base ÷3 on win ×1.5 on loss, 5% Kelly cap`);
  console.log(`Dragon side bet: 5 units (base/20) when Dragon TC >= ${bestDragonTC}`);
  console.log(`Starting bankroll: 10,000 units | EZ Baccarat (no banker commission)\n`);

  const NUM_DECKS    = 8;
  const TOTAL_CARDS  = NUM_DECKS * 52;
  const RESHUFFLE_AT = 14;
  const START_BR     = 10000;
  const BASE_BET     = 100;
  const KELLY_CAP    = 0.05;
  const SIDE_BET     = 5;    // fixed 5-unit Dragon side bet
  const DRAGON_PAY   = 40;   // 40:1

  const res = {
    A: { brs: [], maxDDs: [], bets: 0, wins: 0, losses: 0, pushes: 0 },
    B: { brs: [], maxDDs: [], bets: 0, wins: 0, losses: 0, pushes: 0, dBets: 0, dHits: 0, dPnl: 0 },
    C: { brs: [], maxDDs: [], bets: 0, wins: 0, losses: 0, pushes: 0, dBets: 0, dHits: 0, dPnl: 0 },
  };

  for (let sim = 0; sim < numSims; sim++) {
    let shoe   = shuffle(buildShoe(NUM_DECKS));
    let cursor = 0;
    let dRC    = 0; // Dragon running count

    // Bankroll states
    const brA = { v: START_BR, bet: BASE_BET, peak: START_BR, maxDD: 0 };
    const brB = { v: START_BR, bet: BASE_BET, peak: START_BR, maxDD: 0 };
    const brC = { v: START_BR, bet: BASE_BET, peak: START_BR, maxDD: 0 };

    // SBF state
    let playerStreak    = 0;   // current consecutive player streak (non-tie)
    let lastNT          = null; // last non-tie result ('B' or 'P')
    let sbfArmed        = false; // true = bet THIS hand (it's the banker that broke 3+P streak)
    let preHandStreak   = 0;   // player streak BEFORE the current hand

    while (true) {
      const remaining = TOTAL_CARDS - cursor;
      if (remaining < RESHUFFLE_AT || cursor + 6 > TOTAL_CARDS) break;

      const decksRem = remaining / 52;
      const dTC      = dRC / decksRem; // TC computed with pre-hand count

      // Deal the hand
      const { playerCards, bankerCards, cursor: newCursor } = dealHand(shoe, cursor);
      cursor = newCursor;
      const out = getOutcome(playerCards, bankerCards);

      // Update running count after seeing cards
      for (const c of playerCards) dRC += dragonCountVal(c);
      for (const c of bankerCards)  dRC += dragonCountVal(c);

      const doBet    = sbfArmed; // main bet on this hand?
      const placeB   = dTC >= bestDragonTC; // Dragon side bet for strategy B
      const placeC   = true;                // Dragon side bet for strategy C (always)

      // Apply main bet to one bankroll state
      function applyMain(st) {
        if (!doBet) return 0;
        const betAmt = Math.min(st.bet, KELLY_CAP * st.v);
        let pnl = 0;
        if (out.winner === 'B') {
          // EZ bac: Dragon7 pushes main banker bet; other banker wins pay 1:1 (no commission)
          pnl = out.bankerMainPush ? 0 : betAmt;
          if (!out.bankerMainPush) {
            // Win: reduce bet by ÷3
            st.bet = Math.max(BASE_BET, Math.round(st.bet / 3));
          }
          // Push: bet unchanged
        } else if (out.winner === 'P') {
          pnl = -betAmt;
          // Loss: increase bet ×1.5
          st.bet = Math.min(st.bet * 1.5, KELLY_CAP * st.v * 2);
        }
        // Tie: no pnl, bet unchanged
        st.v += pnl;
        if (st.v > st.peak) st.peak = st.v;
        const dd = st.peak - st.v;
        if (dd > st.maxDD) st.maxDD = dd;
        return pnl;
      }

      // Apply Dragon side bet to one bankroll state
      function applyDragon(st, place) {
        if (!place) return 0;
        const pnl = out.isDragon7 ? SIDE_BET * DRAGON_PAY : -SIDE_BET;
        st.v += pnl;
        if (st.v > st.peak) st.peak = st.v;
        const dd = st.peak - st.v;
        if (dd > st.maxDD) st.maxDD = dd;
        return pnl;
      }

      applyMain(brA);
      applyMain(brB);
      applyMain(brC);

      const sdBpnl = applyDragon(brB, placeB);
      const sdCpnl = applyDragon(brC, placeC);

      if (doBet) {
        res.A.bets++; res.B.bets++; res.C.bets++;
        if      (out.winner === 'B' && !out.bankerMainPush) {
          res.A.wins++; res.B.wins++; res.C.wins++;
        } else if (out.winner === 'P') {
          res.A.losses++; res.B.losses++; res.C.losses++;
        } else {
          res.A.pushes++; res.B.pushes++; res.C.pushes++;
        }
      }

      if (placeB) {
        res.B.dBets++;
        res.B.dPnl += sdBpnl;
        if (out.isDragon7) res.B.dHits++;
      }
      if (placeC) {
        res.C.dBets++;
        res.C.dPnl += sdCpnl;
        if (out.isDragon7) res.C.dHits++;
      }

      // Update SBF state for NEXT hand
      // We arm SBF when: this hand is Banker AND the preceding player streak was >= 3
      sbfArmed = false;
      if (out.winner !== 'T') {
        if (out.winner === 'P') {
          playerStreak = (lastNT === 'P') ? playerStreak + 1 : 1;
        } else {
          // Banker result: check if it broke a 3+ player streak
          if (playerStreak >= 3) {
            sbfArmed = true; // arm for NEXT hand
          }
          playerStreak = 0;
        }
        lastNT = out.winner;
      }
      // Tie: sbfArmed remains false (tie de-activates; SBF only bets on confirmed banker hand)
    }

    res.A.brs.push(brA.v); res.A.maxDDs.push(brA.maxDD);
    res.B.brs.push(brB.v); res.B.maxDDs.push(brB.maxDD);
    res.C.brs.push(brC.v); res.C.maxDDs.push(brC.maxDD);
  }

  function report(label, r, hasDragon) {
    const sorted = [...r.brs].sort((a, b) => a - b);
    const mean_  = avg(r.brs);
    const med    = pctile(sorted, 0.5);
    const p10    = pctile(sorted, 0.10);
    const p25    = pctile(sorted, 0.25);
    const p75    = pctile(sorted, 0.75);
    const p90    = pctile(sorted, 0.90);
    const pct    = (r.brs.filter(v => v > START_BR).length / numSims * 100).toFixed(1);
    const avgDD  = avg(r.maxDDs);
    const evMain = r.bets > 0
      ? (r.brs.reduce((s, v) => s + v - START_BR, 0) / numSims) / (r.bets / numSims)
      : 0;

    console.log(`\n  ${label}`);
    console.log(`  ${'─'.repeat(65)}`);
    console.log(`  Mean bankroll:         ${mean_.toFixed(2)} units  (P&L: ${(mean_ - START_BR).toFixed(2)})`);
    console.log(`  Median bankroll:       ${med.toFixed(2)} units`);
    console.log(`  % Sessions profitable: ${pct}%`);
    console.log(`  P10/P25/P75/P90:       ${p10.toFixed(0)} / ${p25.toFixed(0)} / ${p75.toFixed(0)} / ${p90.toFixed(0)}`);
    console.log(`  Avg max drawdown:      ${avgDD.toFixed(2)} units`);
    console.log(`  SBF bets (total):      ${r.bets.toLocaleString()}  (${(r.bets / numSims).toFixed(1)}/shoe)`);
    console.log(`  Win/Loss/Push:         ${r.wins.toLocaleString()} / ${r.losses.toLocaleString()} / ${r.pushes.toLocaleString()}`);
    console.log(`  EV per SBF main bet:   ${evMain.toFixed(5)} units`);
    if (hasDragon) {
      const hitRate  = r.dBets > 0 ? r.dHits / r.dBets : 0;
      const evPerBet = r.dBets > 0 ? r.dPnl / r.dBets : 0;
      const lift     = baselineDragon > 0 ? hitRate / baselineDragon : 0;
      console.log(`  Dragon side bets:      ${r.dBets.toLocaleString()} (${(r.dBets/numSims).toFixed(1)}/shoe)`);
      console.log(`  Dragon hit rate:       ${(hitRate * 100).toFixed(4)}%`);
      console.log(`  Dragon baseline rate:  ${(baselineDragon * 100).toFixed(4)}%  (banker-win 3-card 7)`);
      console.log(`  Dragon lift:           ${lift.toFixed(4)}`);
      console.log(`  Dragon EV/bet:         ${evPerBet.toFixed(4)} units  (${(evPerBet/SIDE_BET*100).toFixed(3)}% of ${SIDE_BET}u bet)`);
    }
  }

  report('STRATEGY A: SBF only (no Dragon side bets)',         res.A, false);
  report(`STRATEGY B: SBF + Dragon side bet at TC >= ${bestDragonTC}`, res.B, true);
  report('STRATEGY C: SBF + Dragon side bet EVERY hand',       res.C, true);

  const mA = avg(res.A.brs);
  const mB = avg(res.B.brs);
  const mC = avg(res.C.brs);

  console.log('\n');
  console.log('── COMPARISON SUMMARY ───────────────────────────────────────────────');
  console.log(`  Strategy A (no Dragon):       mean P&L = ${(mA - START_BR).toFixed(2)} units/shoe`);
  console.log(`  Strategy B (Dragon TC>=${bestDragonTC}):  mean P&L = ${(mB - START_BR).toFixed(2)} units/shoe`);
  console.log(`  Strategy C (Dragon always):   mean P&L = ${(mC - START_BR).toFixed(2)} units/shoe`);
  console.log('');
  console.log(`  B vs A delta:  ${(mB - mA).toFixed(2)} units/shoe`);
  console.log(`  C vs A delta:  ${(mC - mA).toFixed(2)} units/shoe`);

  const liftB = res.B.dBets > 0 ? (res.B.dHits / res.B.dBets) / baselineDragon : 0;
  const liftC = res.C.dBets > 0 ? (res.C.dHits / res.C.dBets) / baselineDragon : 0;
  console.log(`  Dragon hit lifts: ${liftB.toFixed(4)} (counted) vs ${liftC.toFixed(4)} (always)`);

  // Interpretation
  console.log('');
  console.log('── INTERPRETATION ───────────────────────────────────────────────────');

  // Main bet EV
  const sbfEV = res.A.bets > 0
    ? (mA - START_BR) / (res.A.bets / numSims)
    : 0;
  if (Math.abs(sbfEV) < 1) {
    console.log(`  SBF main bet EV ≈ 0 (expected — baccarat main bet has ~1.06% house edge).`);
    console.log(`  SBF pattern adds no edge over random banker betting.`);
  }

  // Dragon counting assessment
  const dEvB = res.B.dBets > 0 ? res.B.dPnl / res.B.dBets : 0;
  const dEvC = res.C.dBets > 0 ? res.C.dPnl / res.C.dBets : 0;
  if (dEvB < 0) {
    console.log(`  Dragon 7 at TC>=${bestDragonTC}: EV/bet = ${dEvB.toFixed(4)} (still negative — count doesn't overcome house edge).`);
  } else {
    console.log(`  Dragon 7 at TC>=${bestDragonTC}: EV/bet = ${dEvB.toFixed(4)} (positive EV — verify with larger sample).`);
  }
  if (dEvC < 0) {
    console.log(`  Dragon 7 always: EV/bet = ${dEvC.toFixed(4)} (negative — confirms side bet is −EV without count advantage).`);
  }

  if (mC < mA - 10) {
    console.log(`  Strategy C significantly underperforms A by ${(mA - mC).toFixed(1)} units/shoe.`);
    console.log(`  This confirms Dragon 7 side bet drains bankroll when played without count.`);
  }
  if (mB > mA + 5) {
    console.log(`  Strategy B modestly outperforms A (+${(mB - mA).toFixed(1)} units/shoe).`);
    console.log(`  However this is likely within simulation variance — not a reliable edge.`);
  }

  console.log('');
  console.log('── FINAL VERDICT ────────────────────────────────────────────────────');
  console.log('  1. SBF main strategy: near-zero EV. Consistent with baccarat math.');
  console.log('     The 3+P streak → bet banker pattern is not predictive (per Part 2).');
  console.log('  2. Dragon 7 side bet: house edge ~7.6% at baseline rate (~2.25%).');
  console.log('     Deep penetration allows TC to reach high values, but the count');
  console.log('     does not reliably identify enough +EV opportunities to overcome');
  console.log('     the per-bet house edge across the full shoe.');
  console.log('  3. Counting helps Dragon 7 LESS than it helps in blackjack because:');
  console.log('     (a) The Dragon7 payout window is narrow (need banker 3-card 7 win)');
  console.log('     (b) True count fluctuations in baccarat revert faster');
  console.log('     (c) High-TC hands are rare even at 97% penetration');
  console.log('');
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  EZ BACCARAT — DEEP PENETRATION STUDY (97% shoe pen, cut at 14)     ║');
console.log('║  Part 1: Count Threshold Scan  |  Part 2: Roads  |  Part 3: SBF     ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log(`Started: ${new Date().toISOString()}`);
console.log('Config: 8 decks (416 cards) | Reshuffle when < 14 cards remain (97% pen)');
console.log('Dragon 7: 40:1, pays on banker WIN with 3-card 7 | house edge ~7.6%');
console.log('Panda 8:  25:1, pays on player WIN with 3-card 8 | house edge ~9.1%');
console.log('');

const { bestDragonTC, bestPandaTC, baselineDragon, baselinePanda } = runCountThresholdScan(5000);

runRoadsAnalysis(10000);

const useDragonTC = bestDragonTC || 15;
runSBFSim(5000, useDragonTC, baselineDragon);

console.log(`\nCompleted: ${new Date().toISOString()}`);
