'use strict';

// ════════════════════════════════════════════════════════════════════════
// Blackjack Ace-6 Count + Full Martingale (Count-Capped) Backtest
// ════════════════════════════════════════════════════════════════════════
//
// COUNT:  Six dealt → RC +1  (fewer 6s remaining = better for player)
//         Ace dealt → RC -1  (fewer aces remaining = worse for player)
//         True Count (TC) = RC / DecksRemaining
//
// BETTING:
//   TC ≤ 0  → bet $40 flat, reset martingale state
//   TC > 0  → FULL martingale: ×2 on each loss
//             capped by TC-based ceiling (count stops the runaway)
//
// WIN DROP:  ÷2 and ÷3 of previous bet tested
//
// RESET MODES:
//   hard  — when TC drops to ≤ 0, immediately reset to $40
//   soft  — when TC drops to ≤ 0, bet $40 but KEEP martingale state;
//           resume progression when TC comes back positive
//
// Also shows martingale depth distribution and streak analysis.
// ════════════════════════════════════════════════════════════════════════

const DECKS        = 6;
const BASE_BET     = 40;
const TABLE_MAX    = 1000;
const STARTING_BK  = 5000;
const NUM_SHOES    = 30000;
const RESHUFFLE_AT = 78;

// ── Shoe ──────────────────────────────────────────────────────────────────
const SHOE_RANKS = ['A','2','3','4','5','6','7','8','9','T','T','T','T'];

function buildShoe() {
  const shoe = [];
  for (let d = 0; d < DECKS; d++)
    for (const r of SHOE_RANKS)
      for (let s = 0; s < 4; s++) shoe.push(r);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

// ── Card math ─────────────────────────────────────────────────────────────
function cv(r) {
  if (r === 'A') return 11;
  if (r === 'T') return 10;
  return parseInt(r, 10);
}
function total(cards) {
  let t = 0, aces = 0;
  for (const r of cards) {
    if (r === 'A') { t += 11; aces++; } else t += cv(r);
  }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return t;
}
function isSoft(cards) {
  let t = 0, aces = 0;
  for (const r of cards) {
    if (r === 'A') { t += 11; aces++; } else t += cv(r);
  }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return aces > 0 && t <= 21;
}
function isNatural(cards) { return cards.length === 2 && total(cards) === 21; }
function a6(r) {
  if (r === '6') return  1;
  if (r === 'A') return -1;
  return 0;
}

// ── Perfect basic strategy (6 deck, S17, DAS) ────────────────────────────
function bsPlay(cards, dealerUp, canDbl, canSpl, fromSplitAce) {
  const pt  = total(cards);
  const sft = isSoft(cards);
  const du  = cv(dealerUp);

  if (canSpl && cards.length === 2 && cards[0] === cards[1] && !fromSplitAce) {
    const p = cards[0], pv = cv(p);
    if (p  === 'A') return 'P';
    if (p  === 'T') return 'S';
    if (pv === 9)   return (du === 7 || du === 10 || du === 11) ? 'S' : 'P';
    if (pv === 8)   return 'P';
    if (pv === 7)   return du <= 7 ? 'P' : 'H';
    if (pv === 6)   return du <= 6 ? 'P' : 'H';
    if (pv === 4)   return (du === 5 || du === 6) ? 'P' : 'H';
    if (pv === 3 || pv === 2) return du <= 7 ? 'P' : 'H';
  }
  if (sft) {
    if (pt >= 20) return 'S';
    if (pt === 19) return (canDbl && du === 6)            ? 'D' : 'S';
    if (pt === 18) {
      if (canDbl && du >= 2 && du <= 6) return 'D';
      return du <= 8 ? 'S' : 'H';
    }
    if (pt === 17) return (canDbl && du >= 3 && du <= 6)  ? 'D' : 'H';
    if (pt === 16 || pt === 15) return (canDbl && du >= 4 && du <= 6) ? 'D' : 'H';
    if (pt === 14 || pt === 13) return (canDbl && du >= 5 && du <= 6) ? 'D' : 'H';
    return 'H';
  }
  if (pt >= 17) return 'S';
  if (pt >= 13) return du <= 6 ? 'S' : 'H';
  if (pt === 12) return (du >= 4 && du <= 6) ? 'S' : 'H';
  if (pt === 11) return canDbl ? 'D' : 'H';
  if (pt === 10) return (canDbl && du <= 9) ? 'D' : 'H';
  if (pt === 9)  return (canDbl && du >= 3 && du <= 6) ? 'D' : 'H';
  return 'H';
}

// ── Ceiling schedules ─────────────────────────────────────────────────────
function getCeiling(schedule, tc, bankroll) {
  if (schedule === 'flat40') return BASE_BET;
  if (tc <= 0)               return BASE_BET;
  if (schedule === 'conservative') {
    if (tc < 1) return   80;
    if (tc < 2) return  160;
    if (tc < 3) return  320;
    if (tc < 4) return  640;
    return TABLE_MAX;
  }
  if (schedule === 'moderate') {
    if (tc < 1) return  100;
    if (tc < 2) return  250;
    if (tc < 3) return  500;
    return TABLE_MAX;
  }
  if (schedule === 'aggressive') {
    if (tc < 1) return  200;
    if (tc < 2) return  400;
    if (tc < 3) return  800;
    return TABLE_MAX;
  }
  if (schedule === 'kelly') {
    const edge = -0.005 + 0.0044 * tc;
    if (edge <= 0) return BASE_BET;
    return Math.min(Math.max(Math.floor(bankroll * edge / 1.33), BASE_BET), TABLE_MAX);
  }
  return BASE_BET;
}

// How many full-martingale steps fit under a ceiling
// $40 → $80 → $160 → $320 → $640 → $1000(capped) = depths 0-4
function maxMGDepth(cap) {
  let bet = BASE_BET, depth = 0;
  while (bet * 2 <= cap) { bet *= 2; depth++; }
  return depth;   // number of doublings before hitting cap
}

// ── Simulate one hand ─────────────────────────────────────────────────────
function simHand(shoe, idx0, bet) {
  let idx = idx0, rcDelta = 0, totalWagered = bet;
  function deal() { const r = shoe[idx++]; rcDelta += a6(r); return r; }

  const pCards     = [deal(), deal()];
  const dealerUp   = deal();
  const dealerHole = shoe[idx++];

  function playHand(cards, wager, depth, splitAce) {
    if (isNatural(cards) && !splitAce)
      return { cards, wager, isBJ: true, isSplit: false };
    for (;;) {
      const t = total(cards);
      if (t >= 21) break;
      const canD = cards.length === 2 && !splitAce;
      const canS = cards.length === 2 && cards[0] === cards[1] && depth < 3;
      const action = bsPlay(cards, dealerUp, canD, canS, splitAce);
      if (action === 'S') break;
      if (action === 'H') { cards.push(deal()); continue; }
      if (action === 'D') {
        cards.push(deal());
        totalWagered += wager;
        wager *= 2;
        break;
      }
      if (action === 'P') {
        const isAce = cards[0] === 'A';
        const h1 = [cards[0], deal()], h2 = [cards[1], deal()];
        totalWagered += wager;
        return { isSplit: true,
          r1: playHand(h1, wager, depth + 1, isAce),
          r2: playHand(h2, wager, depth + 1, isAce) };
      }
    }
    return { cards, wager, isBJ: false, isSplit: false };
  }

  const playerResult = playHand(pCards, bet, 0, false);
  rcDelta += a6(dealerHole);
  const dCards = [dealerUp, dealerHole];
  const dealerBJ = isNatural(dCards);
  if (!dealerBJ) { while (total(dCards) < 17) dCards.push(deal()); }
  const dt = total(dCards), dBust = dt > 21;

  function resolve(res, isTop) {
    if (res.isSplit) return resolve(res.r1, false) + resolve(res.r2, false);
    const t = total(res.cards), w = res.wager;
    if (res.isBJ && isTop) return dealerBJ ? 0 : Math.round(w * 1.5);
    if (t > 21)   return -w;
    if (dealerBJ) return -w;
    if (dBust)    return  w;
    if (t > dt)   return  w;
    if (t === dt) return  0;
    return -w;
  }

  return { net: resolve(playerResult, true), wagered: totalWagered, rcDelta, newIdx: idx };
}

// ── Run simulation ────────────────────────────────────────────────────────
function runSim(schedule, winFactor, softReset, label) {
  let bankroll  = STARTING_BK;
  let totalNet = 0, totalWag = 0;
  let hands = 0, wins = 0, losses = 0, pushes = 0;
  let maxBk = STARTING_BK, maxDd = 0;
  let busts = 0, posShoes = 0;
  let curBet = BASE_BET;
  // Track martingale depth counts (how deep the sequence went)
  const depthCounts = new Array(8).fill(0);   // 0=base, 1=first loss, ...7=7th loss
  let curDepth = 0;
  // Bet histogram bucketed by $100
  const betHist = new Array(11).fill(0);

  for (let shoeN = 0; shoeN < NUM_SHOES; shoeN++) {
    if (bankroll <= 0) { bankroll = STARTING_BK; busts++; }
    const shoe = buildShoe();
    let idx = 0, rc = 0;
    const shoeStart = bankroll;

    while (idx < shoe.length - RESHUFFLE_AT) {
      const decksLeft = (shoe.length - idx) / 52;
      const tc  = decksLeft > 0.1 ? rc / decksLeft : 0;
      const cap = getCeiling(schedule, tc, bankroll);

      let bet;
      if (tc <= 0 || schedule === 'flat40') {
        if (!softReset) {
          curBet   = BASE_BET;
          curDepth = 0;
        }
        bet = BASE_BET;
      } else {
        // Cap current progression by the ceiling
        bet = Math.min(curBet, cap, TABLE_MAX, bankroll);
      }
      bet = Math.max(Math.round(bet / 5) * 5, 5);
      if (bet > bankroll) bet = bankroll;
      if (bet <= 0) break;

      betHist[Math.min(Math.floor(bet / 100), 10)]++;
      depthCounts[Math.min(curDepth, 7)]++;

      const r = simHand(shoe, idx, bet);
      idx      = r.newIdx;
      rc      += r.rcDelta;

      const net = r.net;
      bankroll += net;
      totalNet += net;
      totalWag += r.wagered;
      hands++;

      if (net > 0) {
        wins++;
        // Win: drop bet
        const dropped = Math.max(Math.round(curBet * winFactor / 5) * 5, BASE_BET);
        curBet   = dropped;
        curDepth = dropped <= BASE_BET ? 0 : Math.max(0, curDepth - 1);
      } else if (net < 0) {
        losses++;
        // Loss: full double, capped by ceiling
        const doubled = Math.min(Math.ceil(curBet * 2 / 5) * 5, cap, TABLE_MAX);
        curBet   = doubled;
        curDepth = Math.min(curDepth + 1, 7);
      }
      // push: keep same bet

      if (bankroll > maxBk) maxBk = bankroll;
      const dd = maxBk - bankroll;
      if (dd > maxDd) maxDd = dd;
      if (bankroll <= 0) { bankroll = 0; break; }
    }

    if (bankroll > shoeStart) posShoes++;
  }

  return {
    label, schedule, winFactor, softReset, hands,
    totalNet:   Math.round(totalNet),
    roi:        (totalNet / totalWag * 100).toFixed(4),
    evPerHand:  (totalNet / hands).toFixed(3),
    avgBet:     (totalWag / hands).toFixed(1),
    winPct:     (wins / hands * 100).toFixed(2),
    maxDd:      Math.round(maxDd),
    busts,
    posShoePct: (posShoes / NUM_SHOES * 100).toFixed(1),
    depthCounts,
    betHist,
    finalBk:    Math.round(bankroll),
  };
}

// ── Configs ────────────────────────────────────────────────────────────────
const configs = [
  // ── Baselines from script 16 (flat count, no MG) ──
  { sc: 'flat40',       wf: 1,   sr: false, label: '$40 FLAT no count (baseline)         ' },
  { sc: 'moderate',     wf: 1,   sr: false, label: 'Moderate FLAT count (best from #16)  ' },

  // ── Full martingale ×2, hard reset ──
  { sc: 'conservative', wf: 0.5, sr: false, label: 'Consv   ÷2 ×2-MG hard-reset          ' },
  { sc: 'conservative', wf: 1/3, sr: false, label: 'Consv   ÷3 ×2-MG hard-reset          ' },
  { sc: 'moderate',     wf: 0.5, sr: false, label: 'Moderate ÷2 ×2-MG hard-reset         ' },
  { sc: 'moderate',     wf: 1/3, sr: false, label: 'Moderate ÷3 ×2-MG hard-reset         ' },
  { sc: 'aggressive',   wf: 0.5, sr: false, label: 'Agg     ÷2 ×2-MG hard-reset          ' },
  { sc: 'aggressive',   wf: 1/3, sr: false, label: 'Agg     ÷3 ×2-MG hard-reset          ' },
  { sc: 'kelly',        wf: 0.5, sr: false, label: 'Kelly   ÷2 ×2-MG hard-reset          ' },
  { sc: 'kelly',        wf: 1/3, sr: false, label: 'Kelly   ÷3 ×2-MG hard-reset          ' },

  // ── Full martingale ×2, soft reset (keep state when TC dips) ──
  { sc: 'conservative', wf: 0.5, sr: true,  label: 'Consv   ÷2 ×2-MG soft-reset          ' },
  { sc: 'conservative', wf: 1/3, sr: true,  label: 'Consv   ÷3 ×2-MG soft-reset          ' },
  { sc: 'moderate',     wf: 0.5, sr: true,  label: 'Moderate ÷2 ×2-MG soft-reset         ' },
  { sc: 'moderate',     wf: 1/3, sr: true,  label: 'Moderate ÷3 ×2-MG soft-reset         ' },
  { sc: 'aggressive',   wf: 0.5, sr: true,  label: 'Agg     ÷2 ×2-MG soft-reset          ' },
  { sc: 'aggressive',   wf: 1/3, sr: true,  label: 'Agg     ÷3 ×2-MG soft-reset          ' },
];

// ── Run ────────────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Blackjack Ace-6 Count + Full Martingale (Count-Capped)');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes : ${NUM_SHOES.toLocaleString()} × ~72 hands  |  Bankroll: $${STARTING_BK}`);
console.log(`  Rules : ${DECKS}-deck · S17 · BJ 3:2 · DAS · 75% penetration`);
console.log(`  MG    : ×2 (full double) on loss | capped by count ceiling`);
console.log(`  Reset : hard = reset to $40 when TC≤0 | soft = keep state`);
console.log('');

const results = [];
for (const c of configs) {
  process.stdout.write(`  ${c.label}...`);
  const r = runSim(c.sc, c.wf, c.sr, c.label.trim());
  results.push(r);
  process.stdout.write(` EV: $${r.evPerHand}  ROI: ${r.roi}%\n`);
}

// ── Results table ─────────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(110));
console.log('  FULL RESULTS  (×2 full martingale, count-capped)');
console.log('═'.repeat(110));
console.log(
  'Strategy'.padEnd(42) +
  'EV/hand'.padEnd(10) + 'ROI%'.padEnd(12) + 'AvgBet'.padEnd(9) +
  'Win%'.padEnd(9) + 'MaxDD'.padEnd(10) + 'Busts'.padEnd(8) + '+Shoe%'
);
console.log('─'.repeat(110));
for (const r of results) {
  const isBl = r.label.startsWith('$40') || r.label.startsWith('Moderate FLAT');
  console.log(
    (isBl ? '  [BL] ' : '       ') + r.label.trim().padEnd(38) +
    ('$'+r.evPerHand).padEnd(10) + (r.roi+'%').padEnd(12) +
    ('$'+r.avgBet).padEnd(9) + (r.winPct+'%').padEnd(9) +
    ('$'+r.maxDd).padEnd(10) + (r.busts+'').padEnd(8) + (r.posShoePct+'%')
  );
}

// ── Top 3 ─────────────────────────────────────────────────────────────────
const ranked = [...results].sort((a, b) => parseFloat(b.evPerHand) - parseFloat(a.evPerHand));
console.log('');
console.log('  TOP 3 BY EV/HAND:');
for (let i = 0; i < 3; i++) {
  const r = ranked[i];
  console.log(`    #${i+1}: ${r.label.trim()}`);
  console.log(`         EV $${r.evPerHand}/hand  ROI ${r.roi}%  MaxDD $${r.maxDd}  Busts ${r.busts}`);
}

// ── Depth distribution for best martingale ────────────────────────────────
const bestMG = ranked.find(r => !r.label.startsWith('$40') && !r.label.includes('FLAT'));
if (bestMG) {
  const total_h = bestMG.depthCounts.reduce((a, b) => a + b, 0);
  console.log('');
  console.log(`  MARTINGALE DEPTH DISTRIBUTION — ${bestMG.label.trim()}`);
  console.log('  Depth = number of consecutive losses in current streak');
  console.log('  ────────────────────────────────────────────────────────────');
  let bets = BASE_BET;
  for (let d = 0; d < 8; d++) {
    const cnt = bestMG.depthCounts[d] || 0;
    const pct = total_h > 0 ? (cnt / total_h * 100).toFixed(2) : '0.00';
    const bar = '█'.repeat(Math.min(Math.round(cnt / total_h * 50), 50));
    const capLabel = `($${Math.min(bets, TABLE_MAX)} bet)`;
    console.log(`  Depth ${d} ${capLabel.padEnd(16)} ${pct.padStart(6)}%  ${bar}`);
    bets = Math.min(bets * 2, TABLE_MAX);
  }
}

// ── Full martingale progression under each ceiling ───────────────────────
console.log('');
console.log('═'.repeat(70));
console.log('  FULL MARTINGALE PROGRESSION — what the count cap allows');
console.log('═'.repeat(70));
console.log('  Schedule       L0:$40  L1:$80  L2:$160  L3:$320  L4:$640  L5:$1000');
console.log('  ────────────────────────────────────────────────────────────────────');

function showProgression(schedule, tc) {
  const cap = getCeiling(schedule, tc, STARTING_BK);
  const steps = [];
  let bet = BASE_BET;
  for (let i = 0; i < 6; i++) {
    steps.push(bet <= cap ? `$${bet}` : `STOP`);
    if (bet > cap) break;
    bet = Math.min(bet * 2, cap);
  }
  return steps;
}

for (const [sched, label] of [
  ['conservative','Conservative'],
  ['moderate',    'Moderate    '],
  ['aggressive',  'Aggressive  '],
]) {
  for (const tc of [0.5, 1.5, 2.5, 3.5]) {
    const cap   = getCeiling(sched, tc, STARTING_BK);
    const depth = maxMGDepth(cap);
    const loss  = BASE_BET * (Math.pow(2, depth + 1) - 1);  // total at risk in sequence
    const steps = [];
    let b = BASE_BET;
    for (let i = 0; i <= 5; i++) {
      if (b <= cap) { steps.push('$'+b); b = Math.min(b*2, TABLE_MAX); }
      else { steps.push('CAPPED'); break; }
    }
    console.log(
      `  ${label} TC+${tc.toFixed(1)}  cap $${String(cap).padEnd(5)}` +
      `  depth ${depth}  max-loss $${loss.toLocaleString().padEnd(6)}  ` +
      steps.join(' → ')
    );
  }
  console.log('');
}

// ── Count-based ceiling vs max loss at risk ───────────────────────────────
console.log('═'.repeat(68));
console.log('  MODERATE CEILING — loss exposure before MG is broken (capped)');
console.log('  "Broken" = next loss would exceed ceiling, bet stays at cap');
console.log('═'.repeat(68));
console.log('  TC     Ceiling   MG depths   Total at risk   Loss if capped hit');
console.log('  ──────────────────────────────────────────────────────────────');
for (const tc of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
  const cap   = getCeiling('moderate', tc, STARTING_BK);
  const depth = maxMGDepth(cap);
  const risk  = BASE_BET * (Math.pow(2, depth + 1) - 1);
  const extra = cap;  // if cap hit and lose again
  const edge  = (-0.005 + 0.0044 * tc * 100).toFixed(2);
  console.log(
    `  TC +${tc.toFixed(1).padEnd(5)} $${String(cap).padEnd(7)} ` +
    `${depth} doubles    $${String(risk).padEnd(15)} $${extra} then stuck  (edge: ${edge}%)`
  );
}

// ── Live count table ──────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(78));
console.log('  LIVE COUNT TABLE  →  MODERATE ceiling  (what to bet at each RC/depth)');
console.log('  RC = 6s seen − Aces seen  |  MG depth = consecutive losses in streak');
console.log('═'.repeat(78));
console.log('  RC  | Decks    | TC     | Ceiling | Bet at depth: 0    1     2     3     4');
console.log('  ──────────────────────────────────────────────────────────────────────────');
for (const [rc, decks] of [[0,5],[1,4],[2,3],[3,3],[4,2],[5,2],[6,2],[8,1],[10,1]]) {
  const tc  = decks > 0 ? rc / decks : 0;
  const cap = getCeiling('moderate', tc, STARTING_BK);
  const bets = [40, 80, 160, 320, 640].map(b => '$' + Math.min(b, cap));
  console.log(
    `  ${('RC='+rc).padEnd(4)}| ${(decks+'d').padEnd(9)}| ${('TC+'+tc.toFixed(1)).padEnd(7)}| $${String(cap).padEnd(8)}| ` +
    bets.join('  ')
  );
}

// ── Comparison: half vs full martingale ──────────────────────────────────
console.log('');
console.log('═'.repeat(60));
console.log('  HALF(×1.5) vs FULL(×2) MARTINGALE — Moderate ÷3 head-to-head');
console.log('═'.repeat(60));
const modDiv3Full = results.find(r => r.label.includes('Moderate') && r.label.includes('÷3') && r.label.includes('hard'));
if (modDiv3Full) {
  console.log(`  Full ×2 hard-reset:  EV $${modDiv3Full.evPerHand}  ROI ${modDiv3Full.roi}%  MaxDD $${modDiv3Full.maxDd}  Busts ${modDiv3Full.busts}`);
  console.log(`  Half ×1.5 (from #16): EV $-0.161  ROI -0.2905%  MaxDD $54,380  Busts 40`);
  console.log('');
  const diff = parseFloat(modDiv3Full.evPerHand) - (-0.161);
  console.log(`  Full MG EV difference: ${diff >= 0 ? '+' : ''}$${diff.toFixed(3)}/hand vs half MG`);
}

console.log('');
console.log('  KEY INSIGHT:');
console.log('  The count cap is doing double duty here:');
console.log('  1. Limits bet size during unfavorable shoes (TC drops → cap drops)');
console.log('  2. Breaks the martingale chain before catastrophic loss territory');
console.log('  3. When TC > 0 you have real edge — so doubling into a cap is rational');
console.log('  4. Hard reset is safer (fewer busts); soft reset chases broken chains');
console.log('');
