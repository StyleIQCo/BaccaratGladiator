'use strict';

// ============================================================
// BACCARAT EZ – DROUGHT PROGRESSIVE SIDE BET BACKTEST
// ============================================================
// Dragon 7: Banker wins with exactly 3 cards totaling 7
// Panda 8:  Player wins with exactly 3 cards totaling 8
// EZ Baccarat: no commission on Banker wins, Dragon 7 push
// ============================================================

const NUM_DECKS = 8;
const RESHUFFLE_AT = 14;          // reshuffle when < 14 cards remain
const SHOE_SIMS_FREQ = 100_000;   // Part 1: frequency estimation
const SHOE_SIMS_BT   = 10_000;    // Part 3: backtest sims

// ── Shoe helpers ─────────────────────────────────────────────

function buildShoe() {
  // ranks 1-13, value = min(rank,10); aces=1
  const shoe = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (let rank = 1; rank <= 13; rank++) {
      const val = rank >= 10 ? 0 : rank; // 10/J/Q/K = 0
      for (let s = 0; s < 4; s++) shoe.push(val);
    }
  }
  return shoe;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

// ── Baccarat draw rules ───────────────────────────────────────
// Returns { playerCards, bankerCards, playerTotal, bankerTotal, winner }
// winner: 'Player' | 'Banker' | 'Tie'

function dealHand(shoe, idx) {
  // Deal: P1 B1 P2 B2
  const p = [shoe[idx], shoe[idx+2]];
  const b = [shoe[idx+1], shoe[idx+3]];
  let used = 4;

  const mod10 = arr => arr.reduce((s,v) => (s+v)%10, 0);
  let pTotal = mod10(p);
  let bTotal = mod10(b);

  let pDrewThird = false;
  let bDrewThird = false;

  // Natural: no draw
  if (pTotal >= 8 || bTotal >= 8) {
    // no draw
  } else {
    // Player draws?
    let pThird = null;
    if (pTotal <= 5) {
      pThird = shoe[idx + used]; used++;
      p.push(pThird);
      pTotal = mod10(p);
      pDrewThird = true;
    }

    // Banker draws?
    if (pThird === null) {
      // Player stood (pTotal was 6 or 7)
      if (bTotal <= 5) {
        b.push(shoe[idx + used]); used++;
        bTotal = mod10(b);
        bDrewThird = true;
      }
    } else {
      // Player drew; banker rule depends on pThird
      const pt = pThird; // value 0-9
      if (
        bTotal <= 2 ||
        (bTotal === 3 && pt !== 8) ||
        (bTotal === 4 && pt >= 2 && pt <= 7) ||
        (bTotal === 5 && pt >= 4 && pt <= 7) ||
        (bTotal === 6 && pt >= 6 && pt <= 7)
      ) {
        b.push(shoe[idx + used]); used++;
        bTotal = mod10(b);
        bDrewThird = true;
      }
    }
  }

  let winner;
  if (pTotal > bTotal) winner = 'Player';
  else if (bTotal > pTotal) winner = 'Banker';
  else winner = 'Tie';

  // Dragon 7: Banker wins with exactly 3 cards totaling 7
  const isDragon7 = winner === 'Banker' && b.length === 3 && bTotal === 7;
  // Panda 8: Player wins with exactly 3 cards totaling 8
  const isPanda8  = winner === 'Player' && p.length === 3 && pTotal === 8;

  return { playerCards: p, bankerCards: b, pTotal, bTotal, winner, isDragon7, isPanda8, used };
}

// ── Deal an entire shoe, return array of hand results ─────────

function dealShoe() {
  const shoe = buildShoe();
  shuffle(shoe);
  const hands = [];
  let idx = 0;
  while (idx + RESHUFFLE_AT < shoe.length) {
    // Max cards per hand = 6
    if (idx + 6 > shoe.length) break;
    const h = dealHand(shoe, idx);
    hands.push(h);
    idx += h.used;
  }
  return hands;
}

// ═══════════════════════════════════════════════════════════════
// PART 1 – FREQUENCY ESTIMATION
// ═══════════════════════════════════════════════════════════════

console.log('='.repeat(70));
console.log('PART 1: FREQUENCY ESTIMATION (100,000 shoes)');
console.log('='.repeat(70));
console.log('Simulating shoes...');

const d7PerShoe = [];
const p8PerShoe = [];
const allD7Gaps  = [];  // hands between consecutive Dragon 7s (within shoe)
const allP8Gaps  = [];;
let maxD7Drought = 0;
let maxP8Drought = 0;

// For drought-probability table (Part 2)
// droughtData[type][N] = { total: hands at drought N, hits: how many were hit }
const droughtData = { d7: {}, p8: {} };
const droughtNs = [10,20,30,40,50,60,80,100,120,150,200];
droughtNs.forEach(n => {
  droughtData.d7[n] = { total: 0, hits: 0 };
  droughtData.p8[n] = { total: 0, hits: 0 };
});

let totalHands = 0;
let totalD7Hits = 0;
let totalP8Hits = 0;

const t0 = Date.now();

for (let sim = 0; sim < SHOE_SIMS_FREQ; sim++) {
  const hands = dealShoe();
  let d7Count = 0, p8Count = 0;
  let lastD7 = -1, lastP8 = -1;
  const shoeD7Gaps = [], shoeP8Gaps = [];

  totalHands += hands.length;

  for (let hi = 0; hi < hands.length; hi++) {
    const h = hands[hi];

    // Drought counters at THIS hand (before we know the result)
    const d7Drought = lastD7 === -1 ? hi : hi - lastD7 - 1;
    const p8Drought = lastP8 === -1 ? hi : hi - lastP8 - 1;

    // Accumulate drought data for Part 2
    for (const n of droughtNs) {
      if (d7Drought === n) {
        droughtData.d7[n].total++;
        if (h.isDragon7) droughtData.d7[n].hits++;
      }
      if (p8Drought === n) {
        droughtData.p8[n].total++;
        if (h.isPanda8) droughtData.p8[n].hits++;
      }
    }

    if (h.isDragon7) {
      d7Count++;
      totalD7Hits++;
      if (lastD7 !== -1) {
        const gap = hi - lastD7 - 1;
        shoeD7Gaps.push(gap);
        allD7Gaps.push(gap);
      }
      lastD7 = hi;
    }
    if (h.isPanda8) {
      p8Count++;
      totalP8Hits++;
      if (lastP8 !== -1) {
        const gap = hi - lastP8 - 1;
        shoeP8Gaps.push(gap);
        allP8Gaps.push(gap);
      }
      lastP8 = hi;
    }
  }

  // Drought at end of shoe
  const endD7Drought = lastD7 === -1 ? hands.length : hands.length - lastD7 - 1;
  const endP8Drought = lastP8 === -1 ? hands.length : hands.length - lastP8 - 1;
  if (endD7Drought > maxD7Drought) maxD7Drought = endD7Drought;
  if (endP8Drought > maxP8Drought) maxP8Drought = endP8Drought;

  d7PerShoe.push(d7Count);
  p8PerShoe.push(p8Count);
}

const t1 = Date.now();
console.log(`Done in ${((t1-t0)/1000).toFixed(1)}s\n`);

// ── Stats helpers ─────────────────────────────────────────────

function stats(arr) {
  const sorted = [...arr].sort((a,b)=>a-b);
  const n = sorted.length;
  const mean = arr.reduce((s,v)=>s+v,0)/n;
  const variance = arr.reduce((s,v)=>s+(v-mean)**2,0)/n;
  const std = Math.sqrt(variance);
  const pct = p => sorted[Math.floor(p*n)];
  return {
    n, mean, std,
    min: sorted[0],
    p5:  pct(0.05),
    p25: pct(0.25),
    median: pct(0.50),
    p75: pct(0.75),
    p95: pct(0.95),
    max: sorted[n-1]
  };
}

function countDist(arr, maxBucket) {
  const dist = {};
  for (const v of arr) {
    const k = v > maxBucket ? `${maxBucket}+` : v;
    dist[k] = (dist[k]||0) + 1;
  }
  return dist;
}

// ── Print frequency report ────────────────────────────────────

const d7Stats = stats(d7PerShoe);
const p8Stats = stats(p8PerShoe);
const d7GapStats = stats(allD7Gaps);
const p8GapStats = stats(allP8Gaps);

const avgHandsPerShoe = totalHands / SHOE_SIMS_FREQ;

console.log(`Average hands per shoe: ${avgHandsPerShoe.toFixed(1)}`);
console.log(`Overall Dragon 7 rate:  ${(totalD7Hits/totalHands*100).toFixed(4)}% (1 in ${(totalHands/totalD7Hits).toFixed(1)})`);
console.log(`Overall Panda 8 rate:   ${(totalP8Hits/totalHands*100).toFixed(4)}% (1 in ${(totalHands/totalP8Hits).toFixed(1)})`);
console.log();

function printStats(label, s) {
  console.log(`${label} per shoe:`);
  console.log(`  Mean±Std: ${s.mean.toFixed(2)} ± ${s.std.toFixed(2)}`);
  console.log(`  Min/Max:  ${s.min} / ${s.max}`);
  console.log(`  5th/25th/50th/75th/95th: ${s.p5} / ${s.p25} / ${s.median} / ${s.p75} / ${s.p95}`);
}

printStats('Dragon 7 hits', d7Stats);
console.log();
printStats('Panda 8 hits',  p8Stats);
console.log();

// Count distribution
const d7Dist = countDist(d7PerShoe, 5);
const p8Dist = countDist(p8PerShoe, 5);

console.log('Dragon 7 count distribution per shoe:');
for (const k of [0,1,2,3,4,'5+']) {
  const cnt = d7Dist[k]||0;
  console.log(`  ${k}: ${cnt.toLocaleString()} shoes (${(cnt/SHOE_SIMS_FREQ*100).toFixed(2)}%)`);
}
console.log();
console.log('Panda 8 count distribution per shoe:');
for (const k of [0,1,2,3,4,'5+']) {
  const cnt = p8Dist[k]||0;
  console.log(`  ${k}: ${cnt.toLocaleString()} shoes (${(cnt/SHOE_SIMS_FREQ*100).toFixed(2)}%)`);
}
console.log();

console.log('Gap between consecutive Dragon 7s (hands):');
printStats('', d7GapStats);
console.log(`  Longest observed drought across all shoes: ${maxD7Drought}`);
console.log();
console.log('Gap between consecutive Panda 8s (hands):');
printStats('', p8GapStats);
console.log(`  Longest observed drought across all shoes: ${maxP8Drought}`);

// ═══════════════════════════════════════════════════════════════
// PART 2 – DOES DROUGHT PREDICT THE NEXT HIT?
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(70));
console.log('PART 2: DROUGHT PREDICTABILITY TEST');
console.log('='.repeat(70));

const baselineD7 = totalD7Hits / totalHands;
const baselineP8 = totalP8Hits / totalHands;

function chiSquared(hits, total, baseRate) {
  if (total < 5) return { chi2: NaN, p: NaN };
  const expected = total * baseRate;
  const expectedNeg = total * (1 - baseRate);
  const obs = hits;
  const obsNeg = total - hits;
  if (expected < 1 || expectedNeg < 1) return { chi2: NaN, p: NaN };
  const chi2 = (obs-expected)**2/expected + (obsNeg-expectedNeg)**2/expectedNeg;
  // p-value approximation for chi2 with 1 df
  const p = Math.exp(-chi2/2) * (1 + chi2/2); // rough; good for large samples
  return { chi2, p };
}

function printDroughtTable(label, data, baseline) {
  console.log(`\n${label} (baseline rate: ${(baseline*100).toFixed(4)}%)`);
  console.log('-'.repeat(80));
  console.log(
    'Drought N'.padEnd(12) +
    'Sample'.padEnd(12) +
    'Hit Rate'.padEnd(14) +
    'Baseline'.padEnd(14) +
    'Lift'.padEnd(10) +
    'Chi2 p'.padEnd(14) +
    'Predictive?'
  );
  console.log('-'.repeat(80));
  for (const n of droughtNs) {
    const d = data[n];
    if (!d || d.total < 5) {
      console.log(`${String(n).padEnd(12)}${'(n<5)'.padEnd(12)}`);
      continue;
    }
    const hitRate = d.hits / d.total;
    const lift    = hitRate / baseline;
    const { chi2, p } = chiSquared(d.hits, d.total, baseline);
    const predictive = p < 0.05 && lift > 1.05;
    console.log(
      String(n).padEnd(12) +
      String(d.total).padEnd(12) +
      (hitRate*100).toFixed(4).padEnd(14) + '%' +
      (baseline*100).toFixed(4).padEnd(13) + '%' +
      lift.toFixed(4).padEnd(10) +
      (isNaN(p)?'N/A':p.toExponential(2)).padEnd(14) +
      (predictive ? 'YES ***' : 'no')
    );
  }
}

printDroughtTable('Dragon 7 Drought Analysis', droughtData.d7, baselineD7);
printDroughtTable('Panda 8 Drought Analysis',  droughtData.p8, baselineP8);

console.log('\nNote: p-value uses chi-squared approximation (1 df). Positive lift');
console.log('alone does NOT mean predictive — requires p < 0.05 AND lift > 1.05.');

// ═══════════════════════════════════════════════════════════════
// PART 3 – BACKTEST PROGRESSIVE SIDE BET STRATEGY
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(70));
console.log('PART 3: PROGRESSIVE SIDE BET BACKTEST (10,000 shoes × 4 variants)');
console.log('='.repeat(70));

// ── Bet sizing functions ──────────────────────────────────────

// Scale A (default progressive)
function betA_D7(drought) {
  if (drought < 30)  return 0;
  if (drought < 45)  return 1;
  if (drought < 60)  return 2;
  if (drought < 80)  return 4;
  if (drought < 100) return 8;
  if (drought < 120) return 16;
  return 32;
}
// Same scale for Panda
const betA_P8 = betA_D7;

// Scale B: start at 50, double every 10
function betB(drought) {
  if (drought < 50) return 0;
  const tier = Math.min(Math.floor((drought - 50) / 10), 6);
  return Math.pow(2, tier); // 1,2,4,8,16,32,64
}

// Scale C: start at 44, flat 5
function betC(drought) {
  return drought >= 44 ? 5 : 0;
}

// Scale D: start at 44, +1 per 5 hands, cap 20
function betD(drought) {
  if (drought < 44) return 0;
  return Math.min(Math.floor((drought - 44) / 5) + 1, 20);
}

// ── Simulate one shoe with given strategy config ──────────────
// Returns stats object

function simShoe(config) {
  const { useD7, useP8, scaleD7, scaleP8 } = config;
  const MAIN_BET = 100;
  const D7_PAYS  = 40;
  const P8_PAYS  = 25;

  const hands = dealShoe();

  let bankroll = 10_000;
  let d7Drought = 0, p8Drought = 0;
  let totalWagered = 0, totalWon = 0;
  let d7BetsPlaced = 0, d7BetsWon = 0;
  let p8BetsPlaced = 0, p8BetsWon = 0;
  let maxD7Bet = 0, maxP8Bet = 0;
  let totalMainBets = 0, totalMainWon = 0;

  // EV by tier accumulators (D7)
  const tierDataD7 = { '30-44':{ w:0,l:0 }, '45-59':{ w:0,l:0 }, '60-79':{ w:0,l:0 },
                       '80-99':{ w:0,l:0 }, '100-119':{ w:0,l:0 }, '120+':{ w:0,l:0 } };
  const tierDataP8 = { '30-44':{ w:0,l:0 }, '45-59':{ w:0,l:0 }, '60-79':{ w:0,l:0 },
                       '80-99':{ w:0,l:0 }, '100-119':{ w:0,l:0 }, '120+':{ w:0,l:0 } };

  function getTier(drought) {
    if (drought >= 120) return '120+';
    if (drought >= 100) return '100-119';
    if (drought >= 80)  return '80-99';
    if (drought >= 60)  return '60-79';
    if (drought >= 45)  return '45-59';
    if (drought >= 30)  return '30-44';
    return null;
  }

  let bust = false;

  for (const h of hands) {
    if (bankroll <= 0) { bust = true; break; }

    // --- Main bet: flat Banker ---
    const mainBet = Math.min(MAIN_BET, bankroll);
    totalMainBets += mainBet;

    // EZ Baccarat: Dragon 7 pushes banker bet, otherwise Banker win pays 1:1
    let mainResult = 0;
    if (h.winner === 'Banker') {
      if (h.isDragon7) {
        mainResult = 0; // push
      } else {
        mainResult = mainBet; // win
      }
    } else if (h.winner === 'Player') {
      mainResult = -mainBet;
    } else {
      mainResult = 0; // Tie
    }
    totalMainWon += mainResult;
    bankroll += mainResult;

    // --- Dragon 7 side bet ---
    if (useD7) {
      const d7Bet = scaleD7(d7Drought);
      if (d7Bet > 0 && bankroll > 0) {
        const b = Math.min(d7Bet, bankroll);
        d7BetsPlaced += b;
        if (b > maxD7Bet) maxD7Bet = b;
        const tier = getTier(d7Drought);
        if (h.isDragon7) {
          const win = b * D7_PAYS;
          bankroll += win;
          d7BetsWon += win;
          if (tier) tierDataD7[tier].w++;
        } else {
          bankroll -= b;
          d7BetsPlaced += 0; // already added
          if (tier) tierDataD7[tier].l++;
        }
        totalWagered += b;
      }
    }

    // --- Panda 8 side bet ---
    if (useP8) {
      const p8Bet = scaleP8(p8Drought);
      if (p8Bet > 0 && bankroll > 0) {
        const b = Math.min(p8Bet, bankroll);
        p8BetsPlaced += b;
        if (b > maxP8Bet) maxP8Bet = b;
        const tier = getTier(p8Drought);
        if (h.isPanda8) {
          const win = b * P8_PAYS;
          bankroll += win;
          p8BetsWon += win;
          if (tier) tierDataP8[tier].w++;
        } else {
          bankroll -= b;
          if (tier) tierDataP8[tier].l++;
        }
        totalWagered += b;
      }
    }

    // Update droughts
    if (h.isDragon7) d7Drought = 0; else d7Drought++;
    if (h.isPanda8)  p8Drought = 0; else p8Drought++;
  }

  return {
    finalBankroll: bankroll,
    bust,
    hands: hands.length,
    totalMainBets,
    totalMainWon,
    d7BetsPlaced,
    d7BetsWon,
    p8BetsPlaced,
    p8BetsWon,
    maxD7Bet,
    maxP8Bet,
    tierDataD7,
    tierDataP8
  };
}

// ── Aggregate tier data across sims ──────────────────────────

function mergeTiers(agg, src) {
  for (const key of Object.keys(src)) {
    if (!agg[key]) agg[key] = { w:0, l:0 };
    agg[key].w += src[key].w;
    agg[key].l += src[key].l;
  }
}

// ── Run a variant ─────────────────────────────────────────────

function runVariant(label, config) {
  console.log(`\nRunning: ${label}...`);
  const results = [];
  const aggTierD7 = {};
  const aggTierP8 = {};

  for (let i = 0; i < SHOE_SIMS_BT; i++) {
    const r = simShoe(config);
    results.push(r);
    mergeTiers(aggTierD7, r.tierDataD7);
    mergeTiers(aggTierP8, r.tierDataP8);
  }

  const finals = results.map(r => r.finalBankroll).sort((a,b)=>a-b);
  const n = finals.length;
  const meanBR = finals.reduce((s,v)=>s+v,0)/n;
  const medianBR = finals[(n/2)|0];
  const profitableCount = finals.filter(v => v > 10_000).length;
  const bustCount = results.filter(r => r.bust).length;

  const totalHands2 = results.reduce((s,r)=>s+r.hands,0);
  const totalMainBets = results.reduce((s,r)=>s+r.totalMainBets,0);
  const totalMainWon  = results.reduce((s,r)=>s+r.totalMainWon,0);
  const totalD7Placed = results.reduce((s,r)=>s+r.d7BetsPlaced,0);
  const totalD7Won    = results.reduce((s,r)=>s+r.d7BetsWon,0);
  const totalP8Placed = results.reduce((s,r)=>s+r.p8BetsPlaced,0);
  const totalP8Won    = results.reduce((s,r)=>s+r.p8BetsWon,0);
  const avgMaxD7Bet   = results.reduce((s,r)=>s+r.maxD7Bet,0)/n;
  const avgMaxP8Bet   = results.reduce((s,r)=>s+r.maxP8Bet,0)/n;
  const avgHandsPerSim = totalHands2/n;

  const totalSidePlaced = totalD7Placed + totalP8Placed;
  const totalSideWon    = totalD7Won    + totalP8Won - totalSidePlaced; // net
  const totalWagered    = totalMainBets + totalSidePlaced;

  // EV per hand: (total net result) / total hands
  // net result per hand = (mainWon + sideWon_gross - sidePlaced) / hands
  const totalMainNet = totalMainWon;
  const totalSideNet = (totalD7Won - totalD7Placed) + (totalP8Won - totalP8Placed);
  const evPerHand    = (totalMainNet + totalSideNet) / totalHands2;
  const evPerWagered = (totalMainNet + totalSideNet) / totalWagered;

  const avgD7PlacedPerShoe = totalD7Placed / n;
  const avgD7WonPerShoe    = totalD7Won / n;
  const avgP8PlacedPerShoe = totalP8Placed / n;
  const avgP8WonPerShoe    = totalP8Won / n;

  console.log(`\n  ── ${label} ──`);
  console.log(`  Mean final bankroll:  ${meanBR.toFixed(1)} (start: 10,000)`);
  console.log(`  Median final bankroll:${medianBR.toFixed(1)}`);
  console.log(`  % shoes profitable:   ${(profitableCount/n*100).toFixed(2)}%`);
  console.log(`  % shoes bust:         ${(bustCount/n*100).toFixed(2)}%`);
  console.log(`  Avg hands per shoe:   ${avgHandsPerSim.toFixed(1)}`);
  console.log(`  EV per hand (net):    ${evPerHand.toFixed(4)} units`);
  console.log(`  EV per unit wagered:  ${(evPerWagered*100).toFixed(4)}%`);
  console.log(`  Main bet net/shoe:    ${(totalMainNet/n).toFixed(2)}`);
  if (config.useD7) {
    console.log(`  D7 side units placed/shoe: ${avgD7PlacedPerShoe.toFixed(2)}`);
    console.log(`  D7 side units won/shoe:    ${avgD7WonPerShoe.toFixed(2)}`);
    console.log(`  D7 net/shoe:               ${((totalD7Won-totalD7Placed)/n).toFixed(2)}`);
    console.log(`  Avg max D7 bet reached:    ${avgMaxD7Bet.toFixed(2)}`);
  }
  if (config.useP8) {
    console.log(`  P8 side units placed/shoe: ${avgP8PlacedPerShoe.toFixed(2)}`);
    console.log(`  P8 side units won/shoe:    ${avgP8WonPerShoe.toFixed(2)}`);
    console.log(`  P8 net/shoe:               ${((totalP8Won-totalP8Placed)/n).toFixed(2)}`);
    console.log(`  Avg max P8 bet reached:    ${avgMaxP8Bet.toFixed(2)}`);
  }

  // EV by drought tier
  if (config.useD7 && totalD7Placed > 0) {
    console.log(`\n  Dragon 7 EV by drought tier (Scale A):`);
    console.log('  ' + 'Tier'.padEnd(12) + 'Bets'.padEnd(10) + 'Wins'.padEnd(10) + 'Hit%'.padEnd(12) + 'EV/unit');
    const tiers = ['30-44','45-59','60-79','80-99','100-119','120+'];
    for (const tier of tiers) {
      const d = aggTierD7[tier] || { w:0, l:0 };
      const total = d.w + d.l;
      if (total === 0) { console.log(`  ${tier.padEnd(12)}(none)`); continue; }
      const hitRate = d.w / total;
      const evPerUnit = hitRate * 40 - 1; // pays 40:1, costs 1
      console.log(
        '  ' +
        tier.padEnd(12) +
        String(total).padEnd(10) +
        String(d.w).padEnd(10) +
        (hitRate*100).toFixed(4).padEnd(12) + '%' +
        evPerUnit.toFixed(4)
      );
    }
  }
  if (config.useP8 && totalP8Placed > 0) {
    console.log(`\n  Panda 8 EV by drought tier (Scale A):`);
    console.log('  ' + 'Tier'.padEnd(12) + 'Bets'.padEnd(10) + 'Wins'.padEnd(10) + 'Hit%'.padEnd(12) + 'EV/unit');
    const tiers = ['30-44','45-59','60-79','80-99','100-119','120+'];
    for (const tier of tiers) {
      const d = aggTierP8[tier] || { w:0, l:0 };
      const total = d.w + d.l;
      if (total === 0) { console.log(`  ${tier.padEnd(12)}(none)`); continue; }
      const hitRate = d.w / total;
      const evPerUnit = hitRate * 25 - 1; // pays 25:1, costs 1
      console.log(
        '  ' +
        tier.padEnd(12) +
        String(total).padEnd(10) +
        String(d.w).padEnd(10) +
        (hitRate*100).toFixed(4).padEnd(12) + '%' +
        evPerUnit.toFixed(4)
      );
    }
  }

  return { label, meanBR, medianBR, profitableCount, bustCount, evPerHand, evPerWagered };
}

// ── Variant 1: Flat Banker only ───────────────────────────────
const v1 = runVariant('Variant 1: Flat Banker Only (baseline)', {
  useD7: false, useP8: false,
  scaleD7: () => 0, scaleP8: () => 0
});

// ── Variant 2: Dragon progressive only ───────────────────────
const v2 = runVariant('Variant 2: Dragon 7 Progressive (Scale A)', {
  useD7: true, useP8: false,
  scaleD7: betA_D7, scaleP8: () => 0
});

// ── Variant 3: Panda progressive only ────────────────────────
const v3 = runVariant('Variant 3: Panda 8 Progressive (Scale A)', {
  useD7: false, useP8: true,
  scaleD7: () => 0, scaleP8: betA_P8
});

// ── Variant 4: Both Dragon + Panda ───────────────────────────
const v4 = runVariant('Variant 4: Dragon 7 + Panda 8 Progressive (Scale A)', {
  useD7: true, useP8: true,
  scaleD7: betA_D7, scaleP8: betA_P8
});

// ── Alternative scales (Dragon 7 only for brevity) ───────────

console.log('\n' + '='.repeat(70));
console.log('ALTERNATIVE PROGRESSIVE SCALES (Dragon 7 + Panda 8, combined)');
console.log('='.repeat(70));

const vB = runVariant('Scale B: start 50, double every 10 (cap 64)', {
  useD7: true, useP8: true,
  scaleD7: betB, scaleP8: betB
});

const vC = runVariant('Scale C: start 44, flat 5 units', {
  useD7: true, useP8: true,
  scaleD7: betC, scaleP8: betC
});

const vD = runVariant('Scale D: start 44, +1/5 hands, cap 20', {
  useD7: true, useP8: true,
  scaleD7: betD, scaleP8: betD
});

// ── Summary table ─────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('SUMMARY TABLE');
console.log('='.repeat(70));
console.log(
  'Variant'.padEnd(48) +
  'Mean BR'.padEnd(12) +
  'Median BR'.padEnd(12) +
  'Profit%'.padEnd(10) +
  'Bust%'.padEnd(10) +
  'EV/hand'
);
console.log('-'.repeat(100));

for (const v of [v1,v2,v3,v4,vB,vC,vD]) {
  console.log(
    v.label.substring(0,47).padEnd(48) +
    v.meanBR.toFixed(1).padEnd(12) +
    v.medianBR.toFixed(1).padEnd(12) +
    (v.profitableCount/SHOE_SIMS_BT*100).toFixed(2).padEnd(10) + '%' +
    (v.bustCount/SHOE_SIMS_BT*100).toFixed(2).padEnd(9) + '%' +
    v.evPerHand.toFixed(4)
  );
}

// ── Final verdict ─────────────────────────────────────────────

console.log('\n' + '='.repeat(70));
console.log('VERDICT: DOES DROUGHT PREDICT THE NEXT HIT?');
console.log('='.repeat(70));
console.log(`
Baccarat is a fixed-probability game dealt from a finite shoe.
The true probability of Dragon 7 or Panda 8 on any given hand is
determined ENTIRELY by the current composition of the remaining shoe,
NOT by how many hands have elapsed since the last hit.

"Drought counting" is a form of the Gambler's Fallacy applied to a
dependent-trial game. While card removal does subtly shift probabilities
hand-to-hand, those shifts are driven by which SPECIFIC cards were dealt,
not by the passage of time since a special event.

Key findings:
 • Dragon 7 hits ~1 in every ${(totalHands/totalD7Hits).toFixed(1)} hands on average
 • Panda 8 hits ~1 in every ${(totalHands/totalP8Hits).toFixed(1)} hands on average
 • The lift ratios at extended drought lengths reflect random sampling
   noise, not a genuine causal mechanism
 • Any progressive strategy increases VARIANCE and RISK, not EV
 • The house edge on Dragon 7 is ~7.6%; on Panda 8 ~10.2% (fixed)
 • No drought threshold or progressive scale can overcome a negative
   fixed-payout side bet with sub-threshold conditional probabilities

The only way to beat Dragon 7 / Panda 8 side bets would be card counting
that specifically tracks 7-valued-banker-3-card compositions, not drought.
`);
