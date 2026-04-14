
'use strict';

// ============================================================
// EZ Baccarat Simulation — Part 1: Counting + Part 2: Roads
// 8-deck shoe, 75% penetration (reshuffle at 104 cards remaining)
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

  const isDragon7 = (bankerCards.length === 3 && bFinal === 7);
  const isPanda8  = (playerCards.length === 3 && pFinal === 8);

  let winner;
  if (bFinal > pFinal) winner = 'B';
  else if (pFinal > bFinal) winner = 'P';
  else winner = 'T';

  const bankerMainPush = (isDragon7 && winner === 'B');

  const isNatural = (handTotal(playerCards.slice(0,2)) >= 8 ||
                     handTotal(bankerCards.slice(0,2)) >= 8);

  return { winner, isDragon7, isPanda8, bankerMainPush, pFinal, bFinal, isNatural,
           numPlayerCards: playerCards.length, numBankerCards: bankerCards.length };
}

// ─────────────────────────────────────────────────────────────
// COUNTING SYSTEM
// Dragon 7 count: 7 = -3, all other ranks = +1
// ─────────────────────────────────────────────────────────────

function dragonCount(rank) {
  if (rank === 7) return -3;
  return 1;
}

// ─────────────────────────────────────────────────────────────
// PART 1: COUNTING SIMULATION
// ─────────────────────────────────────────────────────────────

function runCountingSim(numSims = 5000, handsPerSim = 500) {
  console.log('\n' + '='.repeat(70));
  console.log('PART 1: EZ BACCARAT COUNTING SIMULATION');
  console.log('='.repeat(70));
  console.log(`Config: ${numSims} sims × ${handsPerSim} hands, 8-deck shoe, 75% pen`);
  console.log(`Base bet: 100 units flat | Dragon 7 side bet: 5 units when TC >= 15`);
  console.log('');

  const STARTING_BANKROLL = 10000;
  const BASE_BET = 100;
  const DRAGON_BET = 5;
  const DRAGON_TC_THRESHOLD = 15;
  const NUM_DECKS = 8;
  const TOTAL_CARDS = NUM_DECKS * 52; // 416
  const RESHUFFLE_AT = 104;

  const results = {
    finalBankrolls: [],
    dragonBetsPerSim: [],
    dragonHits: 0,
    dragonBetCount: 0,
    dragonPnl: 0,
    mainBankerBets: 0,
    mainBankerPnl: 0,
    totalHandsPlayed: 0,
    totalDragon7s: 0,
    dragon7WhenTC15: 0,
    dragon7WhenTC15Count: 0,
  };

  for (let sim = 0; sim < numSims; sim++) {
    let bankroll = STARTING_BANKROLL;
    let runningCount = 0;
    let shoe = shuffle(buildShoe(NUM_DECKS));
    let cursor = 0;
    let dragonBetsThisSim = 0;

    for (let h = 0; h < handsPerSim; h++) {
      if (TOTAL_CARDS - cursor < RESHUFFLE_AT) {
        shoe = shuffle(buildShoe(NUM_DECKS));
        cursor = 0;
        runningCount = 0;
      }
      if (cursor + 6 > TOTAL_CARDS) {
        shoe = shuffle(buildShoe(NUM_DECKS));
        cursor = 0;
        runningCount = 0;
      }

      const decksRemaining = (TOTAL_CARDS - cursor) / 52;
      const tc = decksRemaining > 0 ? runningCount / decksRemaining : 0;
      const placeDragon = tc >= DRAGON_TC_THRESHOLD;

      const { playerCards, bankerCards, cursor: newCursor } = dealHand(shoe, cursor);
      cursor = newCursor;
      const outcome = getOutcome(playerCards, bankerCards);
      results.totalHandsPlayed++;

      for (const c of playerCards) runningCount += dragonCount(c);
      for (const c of bankerCards) runningCount += dragonCount(c);

      let mainPnl = 0;
      if (outcome.winner === 'B') {
        mainPnl = outcome.bankerMainPush ? 0 : BASE_BET;
      } else if (outcome.winner === 'P') {
        mainPnl = -BASE_BET;
      }
      bankroll += mainPnl;
      results.mainBankerBets++;
      results.mainBankerPnl += mainPnl;

      if (outcome.isDragon7) results.totalDragon7s++;

      if (placeDragon) {
        dragonBetsThisSim++;
        results.dragonBetCount++;
        results.dragon7WhenTC15Count++;
        let dPnl = outcome.isDragon7 ? DRAGON_BET * 40 : -DRAGON_BET;
        if (outcome.isDragon7) results.dragonHits++;
        bankroll += dPnl;
        results.dragonPnl += dPnl;
      }
    }

    results.finalBankrolls.push(bankroll);
    results.dragonBetsPerSim.push(dragonBetsThisSim);
  }

  const sorted = [...results.finalBankrolls].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const profitable = sorted.filter(v => v > STARTING_BANKROLL).length;
  const pctProfitable = (profitable / numSims * 100).toFixed(1);

  const avgDragonBets = results.dragonBetsPerSim.reduce((s, v) => s + v, 0) / numSims;
  const dragonHitRate = results.dragonBetCount > 0 ? results.dragonHits / results.dragonBetCount : 0;
  const baselineDragonRate = results.totalDragon7s / results.totalHandsPlayed;
  const evPerDragon = results.dragonBetCount > 0 ? results.dragonPnl / results.dragonBetCount : 0;
  const evPerMainBet = results.mainBankerPnl / results.mainBankerBets;
  const evPerSession = (results.mainBankerPnl + results.dragonPnl) / numSims;

  console.log('── RESULTS ──────────────────────────────────────────────────────────');
  console.log(`Mean final bankroll:        ${mean.toFixed(2)} units`);
  console.log(`Median final bankroll:      ${median.toFixed(2)} units`);
  console.log(`Starting bankroll:          ${STARTING_BANKROLL} units`);
  console.log(`Mean P&L per session:       ${(mean - STARTING_BANKROLL).toFixed(2)} units`);
  console.log(`% Sessions profitable:      ${pctProfitable}%`);
  console.log('');
  console.log(`Dragon 7 bets/session avg:  ${avgDragonBets.toFixed(2)}`);
  console.log(`Dragon 7 hit rate (TC>=15): ${(dragonHitRate * 100).toFixed(4)}%`);
  console.log(`Baseline Dragon 7 rate:     ${(baselineDragonRate * 100).toFixed(4)}%`);
  console.log(`Dragon 7 lift (TC>=15):     ${dragonHitRate > 0 && baselineDragonRate > 0
    ? (dragonHitRate / baselineDragonRate).toFixed(4) : 'N/A'}`);
  console.log('');
  console.log(`EV per Dragon 7 side bet:   ${evPerDragon.toFixed(4)} units`);
  console.log(`  (as % of 5-unit bet):     ${(evPerDragon / DRAGON_BET * 100).toFixed(4)}%`);
  console.log(`EV per main banker bet:     ${evPerMainBet.toFixed(4)} units`);
  console.log(`  (as % of 100-unit bet):   ${(evPerMainBet / BASE_BET * 100).toFixed(4)}%`);
  console.log(`Overall EV per session:     ${evPerSession.toFixed(2)} units`);
  console.log('');

  const p10 = sorted[Math.floor(0.10 * numSims)];
  const p25 = sorted[Math.floor(0.25 * numSims)];
  const p75 = sorted[Math.floor(0.75 * numSims)];
  const p90 = sorted[Math.floor(0.90 * numSims)];
  console.log('Bankroll distribution (percentiles):');
  console.log(`  P10: ${p10.toFixed(0)}  P25: ${p25.toFixed(0)}  P50: ${median.toFixed(0)}  P75: ${p75.toFixed(0)}  P90: ${p90.toFixed(0)}`);
  console.log('');
}

// ─────────────────────────────────────────────────────────────
// PART 2: ROADS ANALYSIS
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
  // erfc approximation for chi-sq p-value with 1 df
  const x = Math.sqrt(chi2 / 2);
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.max(0, Math.min(1, poly * Math.exp(-x * x)));
}

function verdict(pValue, lift, n) {
  if (n < 100) return 'INSUFF DATA';
  if (pValue < 0.05 && lift > 1.05) return 'PREDICTIVE (+)';
  if (pValue < 0.05 && lift < (1/1.05)) return 'PREDICTIVE (-)';
  if (pValue < 0.05) return 'SIG (no lift)';
  return 'NOISE';
}

// ── Big Road column builder ──
// Returns array of columns; each column is array of 'B' or 'P'
function buildBigRoadCols(nonTieSeq) {
  const cols = [];
  let last = null;
  for (const o of nonTieSeq) {
    if (last === null || o !== last) {
      cols.push([o]);
    } else {
      cols[cols.length - 1].push(o);
    }
    last = o;
  }
  return cols;
}

// Derived road signal from a given columns snapshot and offset
// offset: 1=Big Eye Boy, 2=Small Road, 3=Cockroach
// Signal is generated for the CURRENT hand (last entry in cols):
//   Compare row position in current column to same row in (current-offset) column
//   Repetitive (R): prior column IS at least as long as current row → same length pattern
//   Chaotic (C): prior column is shorter
function derivedSignal(cols, offset) {
  if (cols.length < offset + 1) return null;
  const curColIdx = cols.length - 1;
  const cmpColIdx = curColIdx - offset;
  if (cmpColIdx < 0) return null;
  const curRowIdx = cols[curColIdx].length - 1; // 0-based row of last entry in current col
  const cmpCol = cols[cmpColIdx];
  // Repetitive if compare col has a card at this row (length > curRowIdx)
  return cmpCol.length > curRowIdx ? 'R' : 'C';
}

// ── Simulate one shoe, return array of hand records ──
function simShoe(numDecks = 8, reshuffleAt = 104) {
  const TOTAL = numDecks * 52;
  const shoe = shuffle(buildShoe(numDecks));
  let cursor = 0;
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
  console.log('\n' + '='.repeat(70));
  console.log('PART 2: SCOREBOARD ROADS PREDICTIVE POWER ANALYSIS');
  console.log('='.repeat(70));
  console.log(`Config: ${numShoes} simulated 8-deck shoes, 75% penetration`);
  console.log('Running simulation...');
  console.log('');

  // Accumulators
  // We test: given state at hand i, what happens at hand i+1?
  // So we always look at prefix [0..i] and check outcome[i+1].

  const P = {
    // Big Road
    a: { label: 'After 3+ Banker streak → next Banker?',          n:0, hit:0 },
    b: { label: 'After 3+ Player streak → next Banker? (SBF)',    n:0, hit:0 },
    c: { label: 'After streak of exactly 2 → streak continues?',  n:0, hit:0 },
    d: { label: 'After chop 4+ alternating → chop continues?',    n:0, hit:0 },
    // Bead Plate
    e: { label: 'Last 6 split 3-3 → next matches last seen?',     n:0, hit:0 },
    f: { label: 'Majority Banker (4+) in last 6 → next Banker?',  n:0, hit:0 },
    // Big Eye Boy
    gR: { label: 'Big Eye Boy: Repetitive → next repeats?',        n:0, hit:0 },
    gC: { label: 'Big Eye Boy: Chaotic    → next switches?',       n:0, hit:0 },
    // Small Road
    hR: { label: 'Small Road: Repetitive → next repeats?',         n:0, hit:0 },
    hC: { label: 'Small Road: Chaotic    → next switches?',        n:0, hit:0 },
    // Cockroach
    kR: { label: 'Cockroach:  Repetitive → next repeats?',         n:0, hit:0 },
    kC: { label: 'Cockroach:  Chaotic    → next switches?',        n:0, hit:0 },
    // Dragon / Panda
    i:  { label: 'After natural (8/9) → Dragon 7 next hand?',      n:0, hit:0 },
    j:  { label: 'After 3+ Banker streak → Dragon 7 next?',        n:0, hit:0 },
    m:  { label: 'After Tie → Panda 8 next hand?',                 n:0, hit:0 },
    l1: { label: 'Current streak=1 → Dragon 7 this hand?',         n:0, hit:0 },
    l3: { label: 'Current streak=3+ → Dragon 7 this hand?',        n:0, hit:0 },
  };

  let totalHands = 0, totalNonTie = 0, totalBanker = 0;
  let totalDragon7 = 0, totalPanda8 = 0, totalTies = 0;

  for (let s = 0; s < numShoes; s++) {
    const hands = simShoe(8, 104);

    // Build non-tie sequence and mapping from all-hand index to non-tie index
    const nonTie = []; // { winner, isDragon7, isPanda8, isNatural, origIdx }
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

    // We iterate i from 0 to NT-2, look at state at i, predict i+1
    // Build Big Road columns incrementally using nonTie[0..i]
    // For efficiency, precompute Big Road columns snapshot at each index

    // Precompute: for each i, what are the columns for nonTie[0..i]?
    // We do this incrementally.

    const cols = []; // current Big Road columns

    for (let i = 0; i < NT - 1; i++) {
      const cur = nonTie[i];
      const next = nonTie[i + 1];

      // Update Big Road columns with nonTie[i]
      if (cols.length === 0 || cur.winner !== cols[cols.length-1][cols[cols.length-1].length-1]) {
        cols.push([cur.winner]);
      } else {
        cols[cols.length - 1].push(cur.winner);
      }

      const nextW = next.winner; // what we're predicting

      // ── Compute streak ending at i (in non-tie sequence) ──
      let streak = 0;
      let streakW = cur.winner;
      for (let k = i; k >= 0; k--) {
        if (nonTie[k].winner === streakW) streak++;
        else break;
      }

      // ── BIG ROAD PATTERNS ──
      // a) 3+ Banker streak → next Banker?
      if (streak >= 3 && streakW === 'B') {
        P.a.n++;
        if (nextW === 'B') P.a.hit++;
      }
      // b) 3+ Player streak → next Banker? (SBF premise)
      if (streak >= 3 && streakW === 'P') {
        P.b.n++;
        if (nextW === 'B') P.b.hit++;
      }
      // c) Exactly 2 → continues?
      if (streak === 2) {
        P.c.n++;
        if (nextW === streakW) P.c.hit++;
      }
      // d) Chop (last 4 all alternating) → next continues chop?
      if (i >= 3) {
        const l4 = nonTie.slice(i-3, i+1).map(x => x.winner);
        if (l4[0] !== l4[1] && l4[1] !== l4[2] && l4[2] !== l4[3]) {
          const expectedChop = l4[3] === 'B' ? 'P' : 'B';
          P.d.n++;
          if (nextW === expectedChop) P.d.hit++;
        }
      }

      // ── BEAD PLATE ──
      if (i >= 5) {
        const last6 = nonTie.slice(i-5, i+1).map(x => x.winner);
        const bCount = last6.filter(w => w === 'B').length;
        // e) 3-3 split
        if (bCount === 3) {
          P.e.n++;
          if (nextW === last6[5]) P.e.hit++; // predict same as last in bead plate
        }
        // f) Majority Banker (4+) → next Banker?
        if (bCount >= 4) {
          P.f.n++;
          if (nextW === 'B') P.f.hit++;
        }
      }

      // ── DERIVED ROADS ──
      // Signal is computed from columns state AFTER adding nonTie[i]
      // (i.e., signal reflects what has happened, predicts next hand)

      const beSig   = derivedSignal(cols, 1); // Big Eye Boy
      const smSig   = derivedSignal(cols, 2); // Small Road
      const ckSig   = derivedSignal(cols, 3); // Cockroach

      // "Repeats" means next outcome === current outcome (streak continues)
      // "Switches" means next outcome !== current outcome (streak breaks)
      const nextRepeats  = nextW === cur.winner;
      const nextSwitches = nextW !== cur.winner;

      if (beSig === 'R') { P.gR.n++; if (nextRepeats)  P.gR.hit++; }
      if (beSig === 'C') { P.gC.n++; if (nextSwitches) P.gC.hit++; }
      if (smSig === 'R') { P.hR.n++; if (nextRepeats)  P.hR.hit++; }
      if (smSig === 'C') { P.hC.n++; if (nextSwitches) P.hC.hit++; }
      if (ckSig === 'R') { P.kR.n++; if (nextRepeats)  P.kR.hit++; }
      if (ckSig === 'C') { P.kC.n++; if (nextSwitches) P.kC.hit++; }

      // ── DRAGON 7 / PANDA 8 PATTERNS ──
      // These test current hand (i+1) given state at i.
      // i) After natural at hand i → Dragon 7 at i+1?
      if (cur.isNatural) {
        P.i.n++;
        if (next.isDragon7) P.i.hit++;
      }
      // j) After 3+ Banker streak → Dragon 7 next?
      if (streak >= 3 && streakW === 'B') {
        P.j.n++;
        if (next.isDragon7) P.j.hit++;
      }

      // l) streak at i → Dragon 7 at i (current hand's dragon prob given streak context)
      // Use cur hand's dragon status against streak context
      if (streak === 1) { P.l1.n++; if (cur.isDragon7) P.l1.hit++; }
      if (streak >= 3)  { P.l3.n++; if (cur.isDragon7) P.l3.hit++; }
    }

    // m) After Tie → Panda 8 next non-tie hand?
    // Need all-hands sequence for ties
    for (let i = 0; i < hands.length - 1; i++) {
      if (hands[i].winner === 'T') {
        // Find next non-tie hand
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

  const baseBanker  = totalBanker / totalNonTie;
  const baseDragon  = totalDragon7 / totalNonTie; // per non-tie hand
  const basePanda   = totalPanda8  / totalNonTie;
  const baseCont    = 0.5; // continuation probability under H0

  console.log(`Total hands simulated:    ${totalHands.toLocaleString()}`);
  console.log(`Total non-tie hands:      ${totalNonTie.toLocaleString()}`);
  console.log(`Ties:                     ${totalTies.toLocaleString()} (${(totalTies/totalHands*100).toFixed(2)}%)`);
  console.log(`Baseline Banker rate:     ${(baseBanker * 100).toFixed(4)}%`);
  console.log(`Baseline Dragon 7 rate:   ${(baseDragon * 100).toFixed(4)}% (per non-tie hand)`);
  console.log(`Baseline Panda 8 rate:    ${(basePanda  * 100).toFixed(4)}% (per non-tie hand)`);
  console.log('');

  // ── Print tables ──

  function row(pObj, baseRate) {
    const obs = pObj.n > 0 ? pObj.hit / pObj.n : 0;
    const { pValue } = chiSquared(pObj.hit, pObj.n, baseRate);
    const lift = baseRate > 0 ? obs / baseRate : 0;
    const v = verdict(pValue, lift, pObj.n);
    const lbl = pObj.label.length > 54 ? pObj.label.slice(0,51)+'...' : pObj.label;
    console.log(
      lbl.padEnd(55) +
      String(pObj.n.toLocaleString()).padStart(10) +
      (baseRate*100).toFixed(3).padStart(9)+'%' +
      (obs*100).toFixed(3).padStart(9)+'%' +
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

  // ── Summary ──
  console.log('');
  console.log('── FINAL SUMMARY ────────────────────────────────────────────────────');
  const predictive = allR.filter(r => r.v.startsWith('PREDICTIVE'));
  const noise      = allR.filter(r => r.v === 'NOISE' || r.v === 'SIG (no lift)');

  if (predictive.length === 0) {
    console.log('  NONE — all patterns are NOISE (p>=0.05 or |lift-1| < 5%)');
  } else {
    for (const r of predictive) {
      console.log(`  [${r.v}] ${r.label}`);
      console.log(`         n=${r.n.toLocaleString()}, lift=${r.lift.toFixed(4)}, p=${r.p.toExponential(3)}`);
    }
  }
  console.log('');
  console.log(`  ${predictive.length} pattern(s) PREDICTIVE   |   ${noise.length} NOISE   |   ${allR.length - predictive.length - noise.length} SIG/no-lift`);

  console.log('');
  console.log('── INTERPRETATION ───────────────────────────────────────────────────');
  if (predictive.length === 0) {
    console.log('  All roads tested show NO predictive power beyond chance.');
    console.log('  Baccarat outcomes are statistically independent events.');
    console.log('  Scoreboards (Big Road, Big Eye Boy, Small Road, Cockroach)');
    console.log('  are entertainment tools only — they carry zero predictive signal.');
  } else {
    const allWeak = predictive.every(r => Math.abs(r.lift - 1) < 0.02);
    if (allWeak) {
      console.log('  Some patterns are statistically significant but lifts are tiny (<2%).');
      console.log('  With ~3M hands these are real dependencies in the math, but are:');
      console.log('  (a) not exploitable after house edge, and');
      console.log('  (b) mechanical card-counting artifacts, not scoreboard "streaks".');
    } else {
      console.log('  NOTABLE: some patterns show meaningful lift. Investigate further.');
      console.log('  Remember: multiple testing inflates false positive rate.');
      console.log('  Bonferroni threshold for 17 tests: p < 0.003');
      const bonf = predictive.filter(r => r.p < 0.003);
      console.log(`  Surviving Bonferroni correction (p<0.003): ${bonf.length} pattern(s)`);
      for (const r of bonf) {
        console.log(`    → ${r.label}  (lift=${r.lift.toFixed(4)}, p=${r.p.toExponential(3)})`);
      }
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  EZ BACCARAT: COUNTING SIMULATION + ROADS ANALYSIS                  ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');
console.log(`Started: ${new Date().toISOString()}`);

runCountingSim(5000, 500);
runRoadsAnalysis(10000);

console.log(`Completed: ${new Date().toISOString()}`);
