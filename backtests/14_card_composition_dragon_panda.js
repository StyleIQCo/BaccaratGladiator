'use strict';

// ============================================================
// EZ BACCARAT — DRAGON 7 / PANDA 8 COMPOSITION ANALYSIS
// 8-deck shoe, 500k shoes, full draw rules
// ============================================================

const TOTAL_DECKS = 8;
const TOTAL_CARDS = TOTAL_DECKS * 52; // 416
const RESHUFFLE_AT = 14;

// In 8 decks:
//   value 0 (10/J/Q/K) = 4 ranks × 4 suits × 8 decks = 128
//   values 1-9         = 1 rank  × 4 suits × 8 decks = 32 each
const SHOE_COUNTS = new Array(10).fill(0);
SHOE_COUNTS[0] = 4 * 4 * TOTAL_DECKS; // 128
for (let v = 1; v <= 9; v++) SHOE_COUNTS[v] = 4 * TOTAL_DECKS; // 32

const BASELINE_DENSITY = new Array(10);
for (let v = 0; v <= 9; v++) BASELINE_DENSITY[v] = SHOE_COUNTS[v] / TOTAL_CARDS;

// ---- Build + shuffle shoe ----
function buildShoe() {
  const shoe = [];
  for (let v = 0; v <= 9; v++)
    for (let i = 0; i < SHOE_COUNTS[v]; i++) shoe.push(v);
  return shoe;
}

function shuffleShoe(shoe) {
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = shoe[i]; shoe[i] = shoe[j]; shoe[j] = tmp;
  }
}

// ---- Baccarat draw rules ----
function handValue(cards) {
  let s = 0;
  for (const c of cards) s += c;
  return s % 10;
}

// Returns { playerCards, bankerCards, pos }
// pos = next card index after this hand
function playHand(shoe, idx) {
  const p1 = shoe[idx], b1 = shoe[idx+1], p2 = shoe[idx+2], b2 = shoe[idx+3];
  let pos = idx + 4;

  const playerCards = [p1, p2];
  const bankerCards = [b1, b2];

  const pNat = (p1 + p2) % 10;
  const bNat = (b1 + b2) % 10;

  if (pNat >= 8 || bNat >= 8) return { playerCards, bankerCards, pos };

  let p3 = null;
  if (pNat <= 5) { p3 = shoe[pos++]; playerCards.push(p3); }

  const bTotal = bNat;
  let draws = false;
  if (p3 === null) {
    draws = bTotal <= 5;
  } else {
    if      (bTotal <= 2) draws = true;
    else if (bTotal === 3) draws = p3 !== 8;
    else if (bTotal === 4) draws = p3 >= 2 && p3 <= 7;
    else if (bTotal === 5) draws = p3 >= 4 && p3 <= 7;
    else if (bTotal === 6) draws = p3 === 6 || p3 === 7;
    else draws = false;
  }
  if (draws) bankerCards.push(shoe[pos++]);

  return { playerCards, bankerCards, pos };
}

// ============================================================
// PART 1 — Card contribution analysis (50k shoes)
// ============================================================

function part1Analysis(numShoes) {
  console.log('\n=== PART 1: Card Contribution to Dragon 7 and Panda 8 ===\n');

  const d7CardCounts = new Array(10).fill(0);
  const p8CardCounts = new Array(10).fill(0);
  const d7TripletMap = new Map();
  const p8TripletMap = new Map();
  let totalD7 = 0, totalP8 = 0, totalHands = 0;

  const shoe = buildShoe();

  for (let s = 0; s < numShoes; s++) {
    shuffleShoe(shoe);
    let idx = 0;
    while (idx + 6 <= shoe.length - RESHUFFLE_AT) {
      const { playerCards, bankerCards, pos } = playHand(shoe, idx);
      idx = pos;
      totalHands++;

      const pTotal = handValue(playerCards);
      const bTotal = handValue(bankerCards);

      if (bankerCards.length === 3 && bTotal === 7 && bTotal > pTotal) {
        totalD7++;
        for (const c of bankerCards) d7CardCounts[c]++;
        const key = [...bankerCards].sort((a, b) => a - b).join(',');
        d7TripletMap.set(key, (d7TripletMap.get(key) || 0) + 1);
      }
      if (playerCards.length === 3 && pTotal === 8 && pTotal > bTotal) {
        totalP8++;
        for (const c of playerCards) p8CardCounts[c]++;
        const key = [...playerCards].sort((a, b) => a - b).join(',');
        p8TripletMap.set(key, (p8TripletMap.get(key) || 0) + 1);
      }
    }
  }

  const d7Rate = totalD7 / totalHands;
  const p8Rate = totalP8 / totalHands;

  console.log(`Total hands: ${totalHands.toLocaleString()}`);
  console.log(`Dragon 7: ${totalD7.toLocaleString()} (${(d7Rate*100).toFixed(4)}%)`);
  console.log(`Panda 8:  ${totalP8.toLocaleString()} (${(p8Rate*100).toFixed(4)}%)`);

  console.log('\n--- Dragon 7: Card value distribution in winning 3-card Banker hands ---');
  console.log('Value | Count     | Per D7 hand | Share of 3 positions');
  for (let v = 0; v <= 9; v++) {
    const perHand = d7CardCounts[v] / totalD7;
    console.log(`  ${v}   | ${d7CardCounts[v].toString().padStart(9)} | ${perHand.toFixed(4)}      | ${(perHand/3*100).toFixed(2)}%`);
  }

  console.log('\n--- Panda 8: Card value distribution in winning 3-card Player hands ---');
  console.log('Value | Count     | Per P8 hand | Share of 3 positions');
  for (let v = 0; v <= 9; v++) {
    const perHand = p8CardCounts[v] / totalP8;
    console.log(`  ${v}   | ${p8CardCounts[v].toString().padStart(9)} | ${perHand.toFixed(4)}      | ${(perHand/3*100).toFixed(2)}%`);
  }

  const d7Sorted = [...d7TripletMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('\n--- Top 20 Dragon 7 triplets (Banker 3-card values, sorted) ---');
  console.log('Cards  | Count    | % of D7');
  for (const [k, cnt] of d7Sorted)
    console.log(`[${k.padEnd(5)}] | ${cnt.toString().padStart(8)} | ${(cnt/totalD7*100).toFixed(3)}%`);

  const p8Sorted = [...p8TripletMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('\n--- Top 20 Panda 8 triplets (Player 3-card values, sorted) ---');
  console.log('Cards  | Count    | % of P8');
  for (const [k, cnt] of p8Sorted)
    console.log(`[${k.padEnd(5)}] | ${cnt.toString().padStart(8)} | ${(cnt/totalP8*100).toFixed(3)}%`);

  return { d7Rate, p8Rate, d7CardCounts, p8CardCounts, totalD7, totalP8, totalHands };
}

// ============================================================
// PART 2 — Shoe composition vs hit probability (500k shoes)
// ============================================================

function part2Analysis(numShoes) {
  console.log('\n=== PART 2: Shoe Composition vs Hit Probability ===\n');

  const richD7 = new Array(10).fill(0);
  const richP8 = new Array(10).fill(0);
  const richTotal = new Array(10).fill(0);
  const poorD7 = new Array(10).fill(0);
  const poorP8 = new Array(10).fill(0);
  const poorTotal = new Array(10).fill(0);

  const comboNames = ['high7_high0', 'low8_high0', 'low8_low9', 'high8', 'lowNat'];
  const comboCounts = {}, comboD7 = {}, comboP8 = {};
  for (const n of comboNames) { comboCounts[n] = [0,0]; comboD7[n] = [0,0]; comboP8[n] = [0,0]; }

  const shoe = buildShoe();
  const rem = new Array(10).fill(0);

  for (let s = 0; s < numShoes; s++) {
    shuffleShoe(shoe);
    for (let v = 0; v <= 9; v++) rem[v] = SHOE_COUNTS[v];
    let remaining = TOTAL_CARDS;
    let idx = 0;

    while (idx + 6 <= shoe.length - RESHUFFLE_AT) {
      // Compute densities BEFORE this hand
      const density = new Array(10);
      for (let v = 0; v <= 9; v++) density[v] = rem[v] / remaining;

      const isRich = new Array(10);
      for (let v = 0; v <= 9; v++) isRich[v] = density[v] > BASELINE_DENSITY[v];

      const flags = {
        high7_high0: isRich[7] && isRich[0],
        low8_high0:  !isRich[8] && isRich[0],
        low8_low9:   !isRich[8] && !isRich[9],
        high8:       isRich[8],
        lowNat:      (density[8] + density[9]) < 0.10
      };

      const { playerCards, bankerCards, pos } = playHand(shoe, idx);
      for (const c of playerCards) { rem[c]--; remaining--; }
      for (const c of bankerCards) { rem[c]--; remaining--; }
      idx = pos;

      const pTotal = handValue(playerCards);
      const bTotal = handValue(bankerCards);
      const isD7 = bankerCards.length === 3 && bTotal === 7 && bTotal > pTotal;
      const isP8 = playerCards.length === 3 && pTotal === 8 && pTotal > bTotal;

      for (let v = 0; v <= 9; v++) {
        if (isRich[v]) {
          richTotal[v]++;
          if (isD7) richD7[v]++;
          if (isP8) richP8[v]++;
        } else {
          poorTotal[v]++;
          if (isD7) poorD7[v]++;
          if (isP8) poorP8[v]++;
        }
      }

      for (const n of comboNames) {
        const fi = flags[n] ? 1 : 0;
        comboCounts[n][fi]++;
        if (isD7) comboD7[n][fi]++;
        if (isP8) comboP8[n][fi]++;
      }
    }
  }

  console.log('--- Per Card Value: Rich vs Poor shoe density -> Dragon 7 ---');
  console.log('Value | Baseline% | RichD7%    | PoorD7%    | D7 Lift | RichN       | PoorN');
  for (let v = 0; v <= 9; v++) {
    const rD7 = richD7[v] / richTotal[v];
    const pD7 = poorD7[v] / poorTotal[v];
    console.log(`  ${v}   | ${(BASELINE_DENSITY[v]*100).toFixed(2)}%    | ${(rD7*100).toFixed(4)}%   | ${(pD7*100).toFixed(4)}%   | ${(rD7/pD7).toFixed(4)}  | ${richTotal[v].toLocaleString().padStart(11)} | ${poorTotal[v].toLocaleString()}`);
  }

  console.log('\n--- Per Card Value: Rich vs Poor shoe density -> Panda 8 ---');
  console.log('Value | Baseline% | RichP8%    | PoorP8%    | P8 Lift | RichN       | PoorN');
  for (let v = 0; v <= 9; v++) {
    const rP8 = richP8[v] / richTotal[v];
    const pP8 = poorP8[v] / poorTotal[v];
    console.log(`  ${v}   | ${(BASELINE_DENSITY[v]*100).toFixed(2)}%    | ${(rP8*100).toFixed(4)}%   | ${(pP8*100).toFixed(4)}%   | ${(rP8/pP8).toFixed(4)}  | ${richTotal[v].toLocaleString().padStart(11)} | ${poorTotal[v].toLocaleString()}`);
  }

  console.log('\n--- Combination Effects ---');
  for (const n of comboNames) {
    const [f0, f1] = comboCounts[n];
    const d7_0 = comboD7[n][0] / f0, d7_1 = comboD7[n][1] / f1;
    const p8_0 = comboP8[n][0] / f0, p8_1 = comboP8[n][1] / f1;
    console.log(`\n  ${n}:`);
    console.log(`    TRUE  (n=${f1.toLocaleString()})  D7: ${(d7_1*100).toFixed(4)}%  P8: ${(p8_1*100).toFixed(4)}%`);
    console.log(`    FALSE (n=${f0.toLocaleString()})  D7: ${(d7_0*100).toFixed(4)}%  P8: ${(p8_0*100).toFixed(4)}%`);
    console.log(`    D7 lift: ${(d7_1/d7_0).toFixed(4)}  P8 lift: ${(p8_1/p8_0).toFixed(4)}`);
  }

  return { richD7, richP8, poorD7, poorP8, richTotal, poorTotal, comboCounts, comboD7, comboP8 };
}

// ============================================================
// PART 3 — Optimal composite count + backtest (100k shoes)
// ============================================================

function part3Analysis(numShoes, part2Data) {
  console.log('\n=== PART 3: Optimal Composite Count Design + Backtest ===\n');

  const { richD7, poorD7, richP8, poorP8, richTotal, poorTotal } = part2Data;

  const liftD7 = new Array(10), liftP8 = new Array(10);
  for (let v = 0; v <= 9; v++) {
    liftD7[v] = (richD7[v]/richTotal[v]) / (poorD7[v]/poorTotal[v]);
    liftP8[v] = (richP8[v]/richTotal[v]) / (poorP8[v]/poorTotal[v]);
  }

  console.log('--- Lift ratios used for count design ---');
  console.log('Value | D7 Lift | P8 Lift');
  for (let v = 0; v <= 9; v++)
    console.log(`  ${v}   | ${liftD7[v].toFixed(4)}  | ${liftP8[v].toFixed(4)}`);

  // Tag assignment:
  // lift > 1 means rich-in-V helps → seeing V (removing it) hurts → tag = -
  // lift < 1 means rich-in-V hurts → seeing V (removing it) helps → tag = +
  // Scale by deviation from 1, round to integer in [-2,+2]
  const d7Tags = new Array(10);
  const p8Tags = new Array(10);
  for (let v = 0; v <= 9; v++) {
    d7Tags[v] = Math.round(Math.max(-2, Math.min(2, -(liftD7[v] - 1) * 10)));
    p8Tags[v] = Math.round(Math.max(-2, Math.min(2, -(liftP8[v] - 1) * 10)));
  }

  console.log('\n--- Dragon 7 Count Tags (per card seen) ---');
  console.log('Value | Tag | Meaning');
  for (let v = 0; v <= 9; v++)
    console.log(`  ${v} (${v===0?'10/J/Q/K':v}) | ${String(d7Tags[v]).padStart(2)}  | ${d7Tags[v]>0?'Seeing this card IMPROVES D7 odds going fwd':d7Tags[v]<0?'Seeing this card REDUCES D7 odds going fwd':'Neutral'}`);

  console.log('\n--- Panda 8 Count Tags (per card seen) ---');
  console.log('Value | Tag | Meaning');
  for (let v = 0; v <= 9; v++)
    console.log(`  ${v} (${v===0?'10/J/Q/K':v}) | ${String(p8Tags[v]).padStart(2)}  | ${p8Tags[v]>0?'Seeing this card IMPROVES P8 odds going fwd':p8Tags[v]<0?'Seeing this card REDUCES P8 odds going fwd':'Neutral'}`);

  // Backtest
  const BT_SHOES = Math.min(numShoes, 100000);
  const thresholds = [-4, -2, 0, 2, 4, 6, 8, 10, 12, 15, 20];
  const d7Stats = {}, p8Stats = {};
  for (const t of thresholds) { d7Stats[t] = {bets:0,wins:0}; p8Stats[t] = {bets:0,wins:0}; }

  const shoe = buildShoe();
  const rem = new Array(10).fill(0);
  let totalHandsBT = 0;

  for (let s = 0; s < BT_SHOES; s++) {
    shuffleShoe(shoe);
    for (let v = 0; v <= 9; v++) rem[v] = SHOE_COUNTS[v];
    let remaining = TOTAL_CARDS;
    let idx = 0;
    let d7Run = 0, p8Run = 0;

    while (idx + 6 <= shoe.length - RESHUFFLE_AT) {
      totalHandsBT++;
      const decks = remaining / 52;
      const d7TC = decks > 0 ? d7Run / decks : 0;
      const p8TC = decks > 0 ? p8Run / decks : 0;

      const { playerCards, bankerCards, pos } = playHand(shoe, idx);
      for (const c of playerCards) { rem[c]--; remaining--; }
      for (const c of bankerCards) { rem[c]--; remaining--; }
      idx = pos;

      const pTotal = handValue(playerCards);
      const bTotal = handValue(bankerCards);
      const isD7 = bankerCards.length === 3 && bTotal === 7 && bTotal > pTotal;
      const isP8 = playerCards.length === 3 && pTotal === 8 && pTotal > bTotal;

      for (const t of thresholds) {
        if (d7TC >= t) { d7Stats[t].bets++; if (isD7) d7Stats[t].wins++; }
        if (p8TC >= t) { p8Stats[t].bets++; if (isP8) p8Stats[t].wins++; }
      }

      for (const c of [...playerCards, ...bankerCards]) {
        d7Run += d7Tags[c];
        p8Run += p8Tags[c];
      }
    }
  }

  const baseD7 = d7Stats[thresholds[0]].wins / d7Stats[thresholds[0]].bets;
  const baseP8 = p8Stats[thresholds[0]].wins / p8Stats[thresholds[0]].bets;

  console.log(`\n--- Dragon 7 Backtest (${BT_SHOES.toLocaleString()} shoes, pays 40:1) ---`);
  console.log('TC >= | Bets        | Hit Rate   | EV/bet    | Lift   | %Hands');
  for (const t of thresholds) {
    const { bets, wins } = d7Stats[t];
    if (bets === 0) continue;
    const hr = wins / bets;
    const ev = hr * 40 - (1 - hr);
    const lift = hr / baseD7;
    const pct = bets / totalHandsBT * 100;
    console.log(` ${String(t).padStart(3)}  | ${bets.toString().padStart(11)} | ${(hr*100).toFixed(4)}%   | ${ev.toFixed(5)}   | ${lift.toFixed(4)} | ${pct.toFixed(2)}%`);
  }

  console.log(`\n--- Panda 8 Backtest (${BT_SHOES.toLocaleString()} shoes, pays 25:1) ---`);
  console.log('TC >= | Bets        | Hit Rate   | EV/bet    | Lift   | %Hands');
  for (const t of thresholds) {
    const { bets, wins } = p8Stats[t];
    if (bets === 0) continue;
    const hr = wins / bets;
    const ev = hr * 25 - (1 - hr);
    const lift = hr / baseP8;
    const pct = bets / totalHandsBT * 100;
    console.log(` ${String(t).padStart(3)}  | ${bets.toString().padStart(11)} | ${(hr*100).toFixed(4)}%   | ${ev.toFixed(5)}   | ${lift.toFixed(4)} | ${pct.toFixed(2)}%`);
  }

  return { d7Tags, p8Tags, liftD7, liftP8 };
}

// ============================================================
// PART 4 — Natural depletion analysis (500k shoes)
// ============================================================

function part4Analysis(numShoes) {
  console.log('\n=== PART 4: Natural (8+9) Depletion Analysis ===\n');

  const BASELINE_NAT = BASELINE_DENSITY[8] + BASELINE_DENSITY[9];
  console.log(`Baseline natural (8+9) density: ${(BASELINE_NAT*100).toFixed(4)}% (${SHOE_COUNTS[8]+SHOE_COUNTS[9]} of ${TOTAL_CARDS} cards)`);

  // Density buckets for natural cards
  //  0: >=18%  1: [16,18)  2: [14,16)  3: [12,14)  4: [10,12)  5: [8,10)  6: <8%
  const bucketLabels = ['>= 18%', '16-18%', '14-16%', '12-14%', '10-12%', '8-10%', '< 8%'];
  const bucketMin    = [0.18,    0.16,    0.14,    0.12,    0.10,    0.08,   0.00];
  const NUM_BUCKETS = 7;

  const bktN  = new Array(NUM_BUCKETS).fill(0);
  const bktD7 = new Array(NUM_BUCKETS).fill(0);
  const bktP8 = new Array(NUM_BUCKETS).fill(0);

  // Natural count backtest: run count = +1 for each 8/9 seen
  const natThresholds = [0, 2, 4, 6, 8, 10, 15, 20];
  const ncD7 = {}, ncP8 = {};
  for (const t of natThresholds) { ncD7[t] = {bets:0,wins:0}; ncP8[t] = {bets:0,wins:0}; }

  const shoe = buildShoe();
  const rem = new Array(10).fill(0);

  for (let s = 0; s < numShoes; s++) {
    shuffleShoe(shoe);
    for (let v = 0; v <= 9; v++) rem[v] = SHOE_COUNTS[v];
    let remaining = TOTAL_CARDS;
    let idx = 0;
    let natRun = 0;

    while (idx + 6 <= shoe.length - RESHUFFLE_AT) {
      const natDensity = (rem[8] + rem[9]) / remaining;
      const decks = remaining / 52;
      const natTC = decks > 0 ? natRun / decks : 0;

      // Find bucket (0=highest density)
      let b = 6; // default <8%
      for (let i = 0; i < NUM_BUCKETS - 1; i++) {
        if (natDensity >= bucketMin[i]) { b = i; break; }
      }

      const { playerCards, bankerCards, pos } = playHand(shoe, idx);
      for (const c of playerCards) { rem[c]--; remaining--; }
      for (const c of bankerCards) { rem[c]--; remaining--; }
      idx = pos;

      const pTotal = handValue(playerCards);
      const bTotal = handValue(bankerCards);
      const isD7 = bankerCards.length === 3 && bTotal === 7 && bTotal > pTotal;
      const isP8 = playerCards.length === 3 && pTotal === 8 && pTotal > bTotal;

      bktN[b]++;
      if (isD7) bktD7[b]++;
      if (isP8) bktP8[b]++;

      for (const t of natThresholds) {
        if (natTC >= t) {
          ncD7[t].bets++; if (isD7) ncD7[t].wins++;
          ncP8[t].bets++; if (isP8) ncP8[t].wins++;
        }
      }

      for (const c of [...playerCards, ...bankerCards])
        if (c === 8 || c === 9) natRun++;
    }
  }

  // Baseline = bucket 2 (14-16%, contains the actual baseline 15.38%)
  const BASE_BKT = 2;
  const baseD7 = bktD7[BASE_BKT] / bktN[BASE_BKT];
  const baseP8 = bktP8[BASE_BKT] / bktN[BASE_BKT];

  const D7_BREAKEVEN = 1/41;
  const P8_BREAKEVEN = 1/26;

  console.log('\n--- Natural Density Buckets: Dragon 7 and Panda 8 Rates ---');
  console.log('Bucket   | N           | D7 Rate    | P8 Rate    | D7 Lift | P8 Lift | D7 EV(40:1)  | P8 EV(25:1)');
  for (let b = 0; b < NUM_BUCKETS; b++) {
    if (bktN[b] === 0) { console.log(`${bucketLabels[b].padEnd(8)} | NO DATA`); continue; }
    const d7r = bktD7[b] / bktN[b];
    const p8r = bktP8[b] / bktN[b];
    const d7ev = d7r * 40 - (1 - d7r);
    const p8ev = p8r * 25 - (1 - p8r);
    const d7lift = d7r / baseD7;
    const p8lift = p8r / baseP8;
    const marker = b === BASE_BKT ? ' <-- baseline' : '';
    console.log(`${bucketLabels[b].padEnd(8)} | ${bktN[b].toString().padStart(11)} | ${(d7r*100).toFixed(4)}%   | ${(p8r*100).toFixed(4)}%   | ${d7lift.toFixed(4)}  | ${p8lift.toFixed(4)}  | ${d7ev > 0 ? '+' : ''}${d7ev.toFixed(5)}       | ${p8ev > 0 ? '+' : ''}${p8ev.toFixed(5)}${marker}`);
  }

  console.log(`\nBreak-even hit rate Dragon 7 (40:1): ${(D7_BREAKEVEN*100).toFixed(4)}%`);
  console.log(`Break-even hit rate Panda 8  (25:1): ${(P8_BREAKEVEN*100).toFixed(4)}%`);

  // Identify at which bucket D7/P8 goes +EV
  let d7FlipBucket = 'never';
  let p8FlipBucket = 'never';
  for (let b = NUM_BUCKETS - 1; b >= 0; b--) {
    if (bktN[b] > 0) {
      const d7r = bktD7[b] / bktN[b];
      const p8r = bktP8[b] / bktN[b];
      if (d7r >= D7_BREAKEVEN && d7FlipBucket === 'never') d7FlipBucket = bucketLabels[b];
      if (p8r >= P8_BREAKEVEN && p8FlipBucket === 'never') p8FlipBucket = bucketLabels[b];
    }
  }
  console.log(`\nDragon 7 flips +EV at natural density: ${d7FlipBucket}`);
  console.log(`Panda 8  flips +EV at natural density: ${p8FlipBucket}`);

  // Natural count backtest
  const ncBT = 100000;
  const base_ncD7 = ncD7[0].wins / ncD7[0].bets;
  const base_ncP8 = ncP8[0].wins / ncP8[0].bets;
  const totalHandsNC = ncD7[0].bets;

  console.log('\n--- Natural Count Backtest (TC = naturals dealt per deck remaining, bet both D7+P8) ---');
  console.log('TC >= | D7 Bets     | D7 Hit%    | D7 EV     | D7 Lift | P8 Hit%    | P8 EV     | P8 Lift | %Hands');
  for (const t of natThresholds) {
    const db = ncD7[t].bets, pb = ncP8[t].bets;
    if (db === 0) continue;
    const d7r = ncD7[t].wins / db;
    const p8r = ncP8[t].wins / pb;
    const d7ev = d7r * 40 - (1 - d7r);
    const p8ev = p8r * 25 - (1 - p8r);
    const d7lift = d7r / base_ncD7;
    const p8lift = p8r / base_ncP8;
    const pct = db / totalHandsNC * 100;
    console.log(` ${String(t).padStart(2)}   | ${db.toString().padStart(11)} | ${(d7r*100).toFixed(4)}%   | ${d7ev > 0 ? '+' : ''}${d7ev.toFixed(5)}   | ${d7lift.toFixed(4)}  | ${(p8r*100).toFixed(4)}%   | ${p8ev > 0 ? '+' : ''}${p8ev.toFixed(5)}   | ${p8lift.toFixed(4)}  | ${pct.toFixed(2)}%`);
  }

  // Detailed summary
  console.log('\n--- Summary: Magnitude of Natural Depletion Effect ---');
  console.log(`Baseline (14-16% nat density):`);
  console.log(`  Dragon 7 rate: ${(baseD7*100).toFixed(4)}%  EV: ${(baseD7*40-(1-baseD7)).toFixed(5)}`);
  console.log(`  Panda 8  rate: ${(baseP8*100).toFixed(4)}%  EV: ${(baseP8*25-(1-baseP8)).toFixed(5)}`);
  if (bktN[6] > 0) {
    const d7lo = bktD7[6]/bktN[6], p8lo = bktP8[6]/bktN[6];
    console.log(`\nAt extreme depletion (<8% nat density):`);
    console.log(`  Dragon 7 rate: ${(d7lo*100).toFixed(4)}%  EV: ${(d7lo*40-(1-d7lo)).toFixed(5)}  Lift: ${(d7lo/baseD7).toFixed(4)}x`);
    console.log(`  Panda 8  rate: ${(p8lo*100).toFixed(4)}%  EV: ${(p8lo*25-(1-p8lo)).toFixed(5)}  Lift: ${(p8lo/baseP8).toFixed(4)}x`);
    console.log(`  Hands in this bucket: ${bktN[6].toLocaleString()} / ${bktN.reduce((a,b)=>a+b,0).toLocaleString()} = ${(bktN[6]/bktN.reduce((a,b)=>a+b,0)*100).toFixed(2)}%`);
  }

  // Natural count practicality
  console.log('\n--- Practicality Assessment for Natural Count ---');
  console.log('The natural count tracks: +1 each time an 8 or 9 is dealt.');
  console.log('True count = (running count) / (decks remaining).');
  console.log(`Starting naturals: ${SHOE_COUNTS[8]+SHOE_COUNTS[9]} in ${TOTAL_DECKS} decks (${(BASELINE_NAT*100).toFixed(2)}% of shoe).`);
  console.log('This count is extremely simple — track just two card values.');
  console.log('High TC means many 8s and 9s have been dealt → shoe is natural-poor → more drawing.');
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const NUM_SHOES = 500000;
  const t0 = Date.now();

  console.log('==========================================================');
  console.log(' EZ BACCARAT — DRAGON 7 / PANDA 8 COMPOSITION ANALYSIS');
  console.log(`  ${NUM_SHOES.toLocaleString()} shoes  |  8 decks  |  reshuffle at ${RESHUFFLE_AT} cards`);
  console.log('==========================================================');

  console.log('\nShoe composition:');
  for (let v = 0; v <= 9; v++)
    console.log(`  Value ${v} (${v===0?'10/J/Q/K':v}): ${SHOE_COUNTS[v].toString().padStart(3)} cards  baseline density = ${(BASELINE_DENSITY[v]*100).toFixed(4)}%`);

  const p1 = part1Analysis(50000);
  const p2 = part2Analysis(NUM_SHOES);
  const p3 = part3Analysis(NUM_SHOES, p2);
  part4Analysis(NUM_SHOES);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n==========================================================');
  console.log(' EXECUTIVE SUMMARY');
  console.log('==========================================================');
  console.log(`\nBaseline Dragon 7 rate: ~${(p1.d7Rate*100).toFixed(4)}%  (1 in ${(1/p1.d7Rate).toFixed(1)} hands)`);
  console.log(`Baseline Panda 8  rate: ~${(p1.p8Rate*100).toFixed(4)}%  (1 in ${(1/p1.p8Rate).toFixed(1)} hands)`);
  console.log(`Dragon 7 break-even (40:1 pay): need ${(1/41*100).toFixed(4)}% hit rate`);
  console.log(`Panda 8  break-even (25:1 pay): need ${(1/26*100).toFixed(4)}% hit rate`);

  console.log('\n[Part 1] Key card values in Dragon 7 banker hands:');
  const d7sorted = [...p1.d7CardCounts.entries ? p1.d7CardCounts.map((c,i)=>({v:i,c})) : Object.entries(p1.d7CardCounts).map(([i,c])=>({v:+i,c}))].sort((a,b)=>b.c-a.c);
  for (const {v, c} of d7sorted.slice(0,5))
    console.log(`  Value ${v}: appears ${c.toLocaleString()} times (${(c/p1.totalD7/3*100).toFixed(2)}% of positions)`);

  console.log('\n[Part 2] Card values with strongest D7 impact (rich shoe lift > |0.03|):');
  for (let v = 0; v <= 9; v++) {
    const lift = (p2.richD7[v]/p2.richTotal[v]) / (p2.poorD7[v]/p2.poorTotal[v]);
    if (Math.abs(lift - 1) > 0.03)
      console.log(`  Value ${v}: D7 lift = ${lift.toFixed(4)} when shoe is rich in this value`);
  }

  console.log('\n[Part 3] Optimal count tags:');
  console.log(`  Dragon 7 count: ${p3.d7Tags.map((t,i)=>`${i}:${t>=0?'+':''}${t}`).join(' ')}`);
  console.log(`  Panda 8  count: ${p3.p8Tags.map((t,i)=>`${i}:${t>=0?'+':''}${t}`).join(' ')}`);

  console.log(`\nCompleted in ${elapsed}s`);
}

main().catch(console.error);
