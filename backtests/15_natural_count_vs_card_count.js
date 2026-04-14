'use strict';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const NUM_DECKS      = 8;
const RESHUFFLE_AT   = 14;
const NUM_SHOES      = 200_000;

// ─── SHOE BUILDER ────────────────────────────────────────────────────────────
function buildShoe() {
  // 0-9 face values; 10/J/Q/K = 0, A = 1
  const shoe = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 1; rank <= 13; rank++) {
        const val = rank >= 10 ? 0 : rank;
        const is89 = (rank === 8 || rank === 9) ? 1 : 0;
        shoe.push({ val, is89 });
      }
    }
  }
  return shoe;
}

// Fisher-Yates shuffle
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

// ─── BACCARAT DRAW RULES ─────────────────────────────────────────────────────
function baccTotal(cards) {
  return cards.reduce((s, c) => s + c.val, 0) % 10;
}

function needsThird(pTotal, bTotal) {
  // player draws on 0-5 (natural check done before calling)
  const pDraws = pTotal <= 5;
  let bDraws = false;

  if (!pDraws) {
    bDraws = bTotal <= 5;
  } else {
    // player drew – banker draws based on player's third card handled outside
    // (we call this only to check if banker draws given player DID draw)
    bDraws = bTotal <= 5; // placeholder; real logic below
  }
  return { pDraws, bDraws };
}

// Full draw: returns { pCards, bCards, pTotal, bTotal }
function playHand(deck, pos) {
  // deal 2 each
  const pCards = [deck[pos], deck[pos+2]];
  const bCards = [deck[pos+1], deck[pos+3]];
  let cursor = pos + 4;

  const pNat = baccTotal(pCards);
  const bNat = baccTotal(bCards);

  if (pNat >= 8 || bNat >= 8) {
    return { pCards, bCards, cursor, natural: true };
  }

  // Player draws?
  const pTotal = pNat;
  let pThird = null;
  if (pTotal <= 5) {
    pThird = deck[cursor++];
    pCards.push(pThird);
  }

  // Banker draws?
  const bTotal = bNat;
  let bDraws = false;
  if (pThird === null) {
    // player stood
    bDraws = bTotal <= 5;
  } else {
    const p3 = pThird.val;
    if      (bTotal <= 2) bDraws = true;
    else if (bTotal === 3) bDraws = p3 !== 8;
    else if (bTotal === 4) bDraws = p3 >= 2 && p3 <= 7;
    else if (bTotal === 5) bDraws = p3 >= 4 && p3 <= 7;
    else if (bTotal === 6) bDraws = p3 === 6 || p3 === 7;
    else bDraws = false; // 7
  }

  if (bDraws) {
    bCards.push(deck[cursor++]);
  }

  return { pCards, bCards, cursor, natural: false };
}

// ─── ACCUMULATORS ────────────────────────────────────────────────────────────

// Part 1: natural composition
const naturalCombos = new Map();   // "A+B" -> {trueNat, synthetic, count}
let totalNaturals  = 0;
let trueNaturals   = 0;
let synthNaturals  = 0;

// Part 2: binned Dragon7 rates
// Bin by board_natural_count: 0-2, 3-5, 6-8, 9-11, 12-14, 15+
const NATURAL_BINS  = [[0,2],[3,5],[6,8],[9,11],[12,14],[15,999]];
const CARD89_BINS   = [[0,5],[6,10],[11,15],[16,20],[21,25],[26,30],[31,999]];

function binIndex(val, bins) {
  for (let i = 0; i < bins.length; i++) {
    if (val >= bins[i][0] && val <= bins[i][1]) return i;
  }
  return bins.length - 1;
}

const natBinHands   = new Array(NATURAL_BINS.length).fill(0);
const natBinD7      = new Array(NATURAL_BINS.length).fill(0);
const c89BinHands   = new Array(CARD89_BINS.length).fill(0);
const c89BinD7      = new Array(CARD89_BINS.length).fill(0);

// Part 3: per-shoe data for Pearson
// We'll accumulate sums for correlation (running totals)
// corr(board_nat, d7_rate), corr(c89, d7_rate), corr(board_nat, c89)
let totalHands = 0;
let totalD7    = 0;

// For per-shoe correlation we accumulate shoe-level tuples
// Store sums for Pearson: sum_x, sum_y, sum_xy, sum_x2, sum_y2, n
function makePearson() {
  return { sx:0, sy:0, sxy:0, sx2:0, sy2:0, n:0 };
}
function addPearson(p, x, y) {
  p.sx += x; p.sy += y; p.sxy += x*y; p.sx2 += x*x; p.sy2 += y*y; p.n++;
}
function pearsonR(p) {
  const num = p.n * p.sxy - p.sx * p.sy;
  const den = Math.sqrt((p.n * p.sx2 - p.sx*p.sx) * (p.n * p.sy2 - p.sy*p.sy));
  return den === 0 ? 0 : num / den;
}

const corrNatD7   = makePearson();   // per shoe: nat_count vs d7_count/hands
const corrC89D7   = makePearson();   // per shoe: c89_count vs d7_count/hands
const corrNatC89  = makePearson();   // per shoe: nat_count vs c89_count (both at shoe end)

// Part 4: 89s per natural
let totalNaturalsForRatio = 0;
let total89sInNaturals    = 0;
// Also track: for each natural, how many 89s were used
// And per-shoe running correlation between nat_count and c89_count (hand-level)
const corrNatC89_hand = makePearson();  // hand-level

// ─── MAIN SIMULATION ─────────────────────────────────────────────────────────
const shoe = buildShoe();
const TOTAL_89_IN_SHOE = NUM_DECKS * 8;  // 64 eights and nines (8 of each rank * 2 * 4 suits... actually 8 ranks are 8s and 9s: 4 suits * 2 ranks * 8 decks = 64)

console.log(`Starting simulation: ${NUM_SHOES.toLocaleString()} shoes...`);
const t0 = Date.now();

for (let s = 0; s < NUM_SHOES; s++) {
  shuffle(shoe);

  let pos = 0;               // current position in shoe
  let boardNatCount = 0;     // naturals seen this shoe
  let c89Count      = 0;     // 8s/9s seen this shoe
  let shoeD7        = 0;
  let shoeHands     = 0;

  while (pos + 4 + RESHUFFLE_AT <= shoe.length) {
    const remaining = shoe.length - pos;
    if (remaining <= RESHUFFLE_AT) break;

    const result = playHand(shoe, pos);
    const { pCards, bCards, cursor, natural } = result;
    pos = cursor;

    const allCards = [...pCards, ...bCards];

    // Count 89s dealt this hand
    const hand89s = allCards.filter(c => c.is89).length;
    c89Count += hand89s;

    const pFinal = baccTotal(pCards);
    const bFinal = baccTotal(bCards);

    // Dragon 7: banker wins with 3 cards totaling exactly 7
    const isD7 = (bCards.length === 3 && bFinal === 7 && bFinal > pFinal);

    if (isD7) shoeD7++;

    // ── PART 1: natural composition ──────────────────────────────────────
    if (natural) {
      // Either player or banker (or both) had a natural
      // Check player natural
      for (const hand of [pCards, bCards]) {
        const tot = baccTotal(hand);
        if (tot >= 8 && hand.length === 2) {
          // This is the natural hand; analyze composition
          const v0 = hand[0].val, v1 = hand[1].val;
          const key = [Math.min(v0,v1), Math.max(v0,v1)].join('+');
          if (!naturalCombos.has(key)) naturalCombos.set(key, {count:0, trueNat:0, synth:0});
          const rec = naturalCombos.get(key);
          rec.count++;
          const has89 = hand[0].is89 || hand[1].is89;
          if (has89) { rec.trueNat++; trueNaturals++; total89sInNaturals += hand89s; }
          else        { rec.synth++;  synthNaturals++;  }
          totalNaturals++;
          totalNaturalsForRatio++;
        }
      }
    }

    // ── PART 2: binned rates ──────────────────────────────────────────────
    const ni = binIndex(boardNatCount, NATURAL_BINS);
    const ci = binIndex(c89Count, CARD89_BINS);
    natBinHands[ni]++;
    if (isD7) natBinD7[ni]++;
    c89BinHands[ci]++;
    if (isD7) c89BinD7[ci]++;

    // ── hand-level nat vs c89 correlation ────────────────────────────────
    addPearson(corrNatC89_hand, boardNatCount, c89Count);

    // Update board natural count AFTER hand (it reflects what scoreboards show)
    if (natural) boardNatCount++;

    shoeHands++;
    totalHands++;
    totalD7 += isD7 ? 1 : 0;
  }

  // ── PART 3: per-shoe correlations ────────────────────────────────────────
  const shoeD7Rate = shoeHands > 0 ? shoeD7 / shoeHands : 0;
  addPearson(corrNatD7,  boardNatCount, shoeD7Rate);
  addPearson(corrC89D7,  c89Count,      shoeD7Rate);
  addPearson(corrNatC89, boardNatCount, c89Count);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Simulation complete in ${elapsed}s\n`);

// ─── OUTPUT ──────────────────────────────────────────────────────────────────
const baselineD7 = totalD7 / totalHands;

console.log('═══════════════════════════════════════════════════════════════');
console.log('PART 1 — NATURAL COMPOSITION BREAKDOWN');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Total naturals analyzed : ${totalNaturals.toLocaleString()}`);
console.log(`True naturals (has 8/9) : ${trueNaturals.toLocaleString()} (${(100*trueNaturals/totalNaturals).toFixed(2)}%)`);
console.log(`Synthetic naturals      : ${synthNaturals.toLocaleString()} (${(100*synthNaturals/totalNaturals).toFixed(2)}%)`);
console.log();
console.log('Top natural card combinations (sorted by frequency):');
console.log(` ${'Combo'.padEnd(8)} ${'Count'.padStart(10)} ${'% of All'.padStart(10)} ${'True%'.padStart(8)} ${'Synth%'.padStart(8)}`);
console.log(' ' + '-'.repeat(50));

// Sort combos by count
const combosArr = [...naturalCombos.entries()].sort((a,b) => b[1].count - a[1].count);
for (const [key, rec] of combosArr) {
  const pct   = (100*rec.count/totalNaturals).toFixed(2);
  const tPct  = (100*rec.trueNat/rec.count).toFixed(1);
  const sPct  = (100*rec.synth/rec.count).toFixed(1);
  console.log(` ${key.padEnd(8)} ${rec.count.toLocaleString().padStart(10)} ${(pct+'%').padStart(10)} ${(tPct+'%').padStart(8)} ${(sPct+'%').padStart(8)}`);
}

// Highlight purely synthetic combos
console.log();
console.log('Purely synthetic combos (NO 8 or 9 card involved):');
for (const [key, rec] of combosArr) {
  if (rec.synth === rec.count) {
    console.log(`  ${key}  →  ${rec.count.toLocaleString()} (${(100*rec.count/totalNaturals).toFixed(2)}% of all naturals)`);
  }
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('PART 2 — PREDICTIVE ACCURACY: BINNED DRAGON 7 RATES');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Baseline Dragon 7 rate  : ${(baselineD7*100).toFixed(4)}%\n`);

console.log('By Board Natural Count (scoreboard):');
console.log(` ${'Bin'.padEnd(10)} ${'Hands'.padStart(12)} ${'D7 Rate'.padStart(10)} ${'Lift'.padStart(8)}`);
console.log(' ' + '-'.repeat(44));
for (let i = 0; i < NATURAL_BINS.length; i++) {
  if (natBinHands[i] === 0) continue;
  const label = NATURAL_BINS[i][1] === 999
    ? `${NATURAL_BINS[i][0]}+`
    : `${NATURAL_BINS[i][0]}-${NATURAL_BINS[i][1]}`;
  const rate  = natBinD7[i] / natBinHands[i];
  const lift  = rate / baselineD7;
  console.log(` ${label.padEnd(10)} ${natBinHands[i].toLocaleString().padStart(12)} ${(rate*100).toFixed(4).padStart(9)}% ${lift.toFixed(3).padStart(8)}x`);
}

console.log();
console.log('By Card 8/9 Seen Count (manual tracking):');
console.log(` ${'Bin'.padEnd(10)} ${'Hands'.padStart(12)} ${'D7 Rate'.padStart(10)} ${'Lift'.padStart(8)}`);
console.log(' ' + '-'.repeat(44));
for (let i = 0; i < CARD89_BINS.length; i++) {
  if (c89BinHands[i] === 0) continue;
  const label = CARD89_BINS[i][1] === 999
    ? `${CARD89_BINS[i][0]}+`
    : `${CARD89_BINS[i][0]}-${CARD89_BINS[i][1]}`;
  const rate  = c89BinD7[i] / c89BinHands[i];
  const lift  = rate / baselineD7;
  console.log(` ${label.padEnd(10)} ${c89BinHands[i].toLocaleString().padStart(12)} ${(rate*100).toFixed(4).padStart(9)}% ${lift.toFixed(3).padStart(8)}x`);
}

// Compute lift gradient steepness
const natRates  = NATURAL_BINS.map((_,i) => natBinHands[i]>0 ? natBinD7[i]/natBinHands[i] : null).filter(x=>x!==null);
const c89Rates  = CARD89_BINS.map((_,i)  => c89BinHands[i]>0 ? c89BinD7[i]/c89BinHands[i] : null).filter(x=>x!==null);
const natRange  = Math.max(...natRates)  - Math.min(...natRates);
const c89Range  = Math.max(...c89Rates) - Math.min(...c89Rates);
console.log();
console.log(`Lift range (max−min D7 rate across bins):`);
console.log(`  Board natural count bins : ${(natRange*100).toFixed(5)}%`);
console.log(`  Card 8/9 count bins      : ${(c89Range*100).toFixed(5)}%`);

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('PART 3 — PEARSON CORRELATION COEFFICIENTS');
console.log('═══════════════════════════════════════════════════════════════');

const rNatD7   = pearsonR(corrNatD7);
const rC89D7   = pearsonR(corrC89D7);
const rNatC89s = pearsonR(corrNatC89);
const rHandNatC89 = pearsonR(corrNatC89_hand);

console.log(`Per-shoe correlations:`);
console.log(`  Board_Natural_Count vs Dragon7_Rate : r = ${rNatD7.toFixed(6)}`);
console.log(`  Card_89_Count       vs Dragon7_Rate : r = ${rC89D7.toFixed(6)}`);
console.log(`  Board_Natural_Count vs Card_89_Count: r = ${rNatC89s.toFixed(6)}`);
console.log();
console.log(`Hand-level (running counts):`);
console.log(`  Board_Natural_Count vs Card_89_Count: r = ${rHandNatC89.toFixed(6)}`);

// Assess which is a better predictor
console.log();
console.log(`Which is a better Dragon 7 predictor?`);
const winner = Math.abs(rC89D7) > Math.abs(rNatD7) ? 'Card 8/9 Count' : 'Board Natural Count';
const margin = Math.abs(Math.abs(rC89D7) - Math.abs(rNatD7));
console.log(`  Winner: ${winner} (|r| advantage: ${margin.toFixed(6)})`);

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('PART 4 — PRACTICAL RECOMMENDATION');
console.log('═══════════════════════════════════════════════════════════════');

// 8s/9s per natural
// Note: we double-counted naturals (both player and banker could natural)
// Let's use total89sInNaturals / totalNaturalsForRatio but that's per-hand-role
// Actually total89sInNaturals counts the 8/9s in each HAND that had a natural total
// totalNaturalsForRatio is the count of "natural hands" (player or banker)
const avg89PerNatHand = total89sInNaturals / totalNaturalsForRatio;

console.log(`Average 8/9 cards per natural hand    : ${avg89PerNatHand.toFixed(4)}`);
console.log(`  (not per-event; this is per natural occurrence)`);
console.log();

// Estimating 8/9 depletion from natural count
// Use the hand-level regression: c89 ≈ a * natCount + b
// We have Pearson data; estimate slope from corrNatC89_hand
const n_hl = corrNatC89_hand.n;
const slope = (n_hl * corrNatC89_hand.sxy - corrNatC89_hand.sx * corrNatC89_hand.sy) /
              (n_hl * corrNatC89_hand.sx2 - corrNatC89_hand.sx * corrNatC89_hand.sx);
const intercept = (corrNatC89_hand.sy - slope * corrNatC89_hand.sx) / n_hl;

console.log(`Linear regression: Card89_Seen ≈ ${slope.toFixed(4)} × NaturalCount + ${intercept.toFixed(4)}`);
console.log(`  → Every 1 new natural on the board implies ~${slope.toFixed(2)} additional 8/9s seen`);
console.log();

// Noise/error estimate: residual variance
// For a proper RMSE we'd need to store all points, but approximate from r²
const r2 = rHandNatC89 * rHandNatC89;
// Variance of c89 (hand level): from corrNatC89_hand
const meanC89 = corrNatC89_hand.sy / n_hl;
const varC89  = corrNatC89_hand.sy2 / n_hl - meanC89 * meanC89;
const residualVar = varC89 * (1 - r2);
const rmse = Math.sqrt(residualVar);

console.log(`Predictive error of using Board Naturals as proxy for 8/9 depletion:`);
console.log(`  R² (board_nat explains ___ of 8/9 variance) : ${(r2*100).toFixed(2)}%`);
console.log(`  Residual RMSE (≈ cards)                     : ±${rmse.toFixed(2)} 8/9 cards`);
console.log(`  (i.e., if board shows N naturals, your 8/9 estimate is off by ~±${rmse.toFixed(1)} cards)`);
console.log();

// Total 8s and 9s in 8-deck shoe
console.log(`Context: An 8-deck shoe contains ${TOTAL_89_IN_SHOE} total 8s and 9s`);
console.log(`  RMSE as % of total 8/9s in shoe: ${(100*rmse/TOTAL_89_IN_SHOE).toFixed(2)}%`);
console.log();

// Final recommendation
console.log('FINAL RECOMMENDATION:');
console.log('─────────────────────');
const rDiff = Math.abs(rC89D7) - Math.abs(rNatD7);
if (rDiff > 0.01) {
  console.log(`  Card 8/9 tracking is meaningfully better (Δr = ${rDiff.toFixed(4)}).`);
  console.log(`  The extra mental effort IS justified for serious advantage play.`);
} else if (rDiff > 0.001) {
  console.log(`  Card 8/9 tracking is marginally better (Δr = ${rDiff.toFixed(4)}).`);
  console.log(`  The extra mental effort offers only small gains.`);
} else {
  console.log(`  Both signals are nearly identical as Dragon 7 predictors (Δr = ${rDiff.toFixed(4)}).`);
  console.log(`  Using board naturals alone is sufficient — the extra mental effort is NOT worth it.`);
}
console.log(`  Board naturals predict ~${(r2*100).toFixed(1)}% of 8/9 depletion variation (R²=${r2.toFixed(4)}).`);
console.log(`  Estimation error: ±${rmse.toFixed(1)} out of ${TOTAL_89_IN_SHOE} possible 8/9 cards.`);
