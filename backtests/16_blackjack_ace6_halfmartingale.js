'use strict';

// ════════════════════════════════════════════════════════════════════════
// Blackjack Ace-6 Count + Half-Martingale Backtest
// ════════════════════════════════════════════════════════════════════════
//
// COUNT:  Six dealt → RC +1  (fewer dealer-friendly 6s remaining = better)
//         Ace dealt → RC -1  (fewer player-friendly aces remaining = worse)
//         True Count (TC) = RC / DecksRemaining
//
// BETTING:
//   TC ≤ 0  → bet $40, reset martingale state (no edge = sit out progression)
//   TC > 0  → half-martingale: ×1.5 on loss, drop on win (÷2 or ÷3 tested)
//             bet capped by TC-based ceiling
//
// CEIL SCHEDULES:
//   flat40      — $40 flat always (no count, baseline)
//   conservative— gentle ramp, camouflage-friendly
//   moderate    — balanced ramp
//   aggressive  — steep ramp
//   kelly       — dynamic % of current bankroll / edge / variance
//
// Rules: 6 decks · BJ 3:2 · Dealer stands soft 17 · DAS · No surrender
// ════════════════════════════════════════════════════════════════════════

const DECKS        = 6;
const BASE_BET     = 40;
const TABLE_MAX    = 1000;
const STARTING_BK  = 5000;
const NUM_SHOES    = 30000;
const RESHUFFLE_AT = 78;    // cards remaining → reshuffle (~75% penetration)

// ── Shoe ──────────────────────────────────────────────────────────────────
// Represent 10/J/Q/K all as 'T' — same basic-strategy rank value
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

function isNatural(cards) {
  return cards.length === 2 && total(cards) === 21;
}

// ── Ace-6 count value ─────────────────────────────────────────────────────
function a6(r) {
  if (r === '6') return  1;  // 6 exits → count up (fewer low cards = better for player)
  if (r === 'A') return -1;  // A exits → count down (fewer aces = worse for player)
  return 0;
}

// ── Perfect basic strategy (6 deck, S17, DAS) ────────────────────────────
// Returns: 'H' | 'S' | 'D' | 'P'
function bsPlay(cards, dealerUp, canDbl, canSpl, fromSplitAce) {
  const pt  = total(cards);
  const sft = isSoft(cards);
  const du  = cv(dealerUp);  // 2–11  (A counted as 11)

  // ── Pairs ──
  if (canSpl && cards.length === 2 && cards[0] === cards[1] && !fromSplitAce) {
    const p  = cards[0];
    const pv = cv(p);
    if (p  === 'A') return 'P';
    if (p  === 'T') return 'S';                                  // TT: never split
    if (pv === 9)   return (du === 7 || du === 10 || du === 11) ? 'S' : 'P';
    if (pv === 8)   return 'P';                                  // 88: always split
    if (pv === 7)   return du <= 7 ? 'P' : 'H';
    if (pv === 6)   return du <= 6 ? 'P' : 'H';
    if (pv === 4)   return (du === 5 || du === 6) ? 'P' : 'H';
    if (pv === 3 || pv === 2) return du <= 7 ? 'P' : 'H';
    // pv === 5: fall through to hard-10 logic
  }

  // ── Soft hands ──
  if (sft) {
    if (pt >= 20) return 'S';
    if (pt === 19) return (canDbl && du === 6)             ? 'D' : 'S';
    if (pt === 18) {
      if (canDbl && du >= 2 && du <= 6) return 'D';
      return du <= 8 ? 'S' : 'H';
    }
    if (pt === 17) return (canDbl && du >= 3 && du <= 6)   ? 'D' : 'H';
    if (pt === 16 || pt === 15) return (canDbl && du >= 4 && du <= 6) ? 'D' : 'H';
    if (pt === 14 || pt === 13) return (canDbl && du >= 5 && du <= 6) ? 'D' : 'H';
    return 'H';
  }

  // ── Hard hands ──
  if (pt >= 17) return 'S';
  if (pt >= 13) return du <= 6 ? 'S' : 'H';
  if (pt === 12) return (du >= 4 && du <= 6) ? 'S' : 'H';
  if (pt === 11) return canDbl ? 'D' : 'H';
  if (pt === 10) return (canDbl && du <= 9)  ? 'D' : 'H';
  if (pt === 9)  return (canDbl && du >= 3 && du <= 6) ? 'D' : 'H';
  return 'H';
}

// ── Ceiling schedules ─────────────────────────────────────────────────────
function getCeiling(schedule, tc, bankroll) {
  if (schedule === 'flat40')  return BASE_BET;
  if (tc <= 0)                return BASE_BET;

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
    // Ace-6 Betting Correlation ≈ 0.88 vs Hi-Lo
    // Edge per TC unit ≈ 0.44%.  Base house edge ≈ −0.5%
    const edge = -0.005 + 0.0044 * tc;
    if (edge <= 0) return BASE_BET;
    const kellyBet = Math.floor(bankroll * edge / 1.33); // BJ variance ≈ 1.33
    return Math.min(Math.max(kellyBet, BASE_BET), TABLE_MAX);
  }
  return BASE_BET;
}

// ── Simulate one blackjack hand ───────────────────────────────────────────
// Returns { net, wagered, rcDelta, newIdx }
function simHand(shoe, idx0, bet) {
  let idx     = idx0;
  let rcDelta = 0;
  let totalWagered = bet;

  // deal() counts the card in rcDelta immediately (visible cards)
  function deal() {
    const r = shoe[idx++];
    rcDelta += a6(r);
    return r;
  }

  // Initial deal
  const pCards     = [deal(), deal()];
  const dealerUp   = deal();
  const dealerHole = shoe[idx++];   // face-down — counted only when flipped

  // Play all player hands (supports splits up to depth 3)
  function playHand(cards, wager, depth, splitAce) {
    if (isNatural(cards) && !splitAce)
      return { cards, wager, isBJ: true, isSplit: false };

    for (;;) {
      const t = total(cards);
      if (t >= 21) break;
      const canD  = cards.length === 2 && !splitAce;
      const canS  = cards.length === 2 && cards[0] === cards[1] && depth < 3;
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
        const h1 = [cards[0], deal()];
        const h2 = [cards[1], deal()];
        totalWagered += wager;               // second bet for split
        const r1 = playHand(h1, wager, depth + 1, isAce);
        const r2 = playHand(h2, wager, depth + 1, isAce);
        return { isSplit: true, r1, r2 };
      }
    }
    return { cards, wager, isBJ: false, isSplit: false };
  }

  const playerResult = playHand(pCards, bet, 0, false);

  // Reveal hole card + dealer plays
  rcDelta += a6(dealerHole);
  const dCards   = [dealerUp, dealerHole];
  const dealerBJ = isNatural(dCards);
  if (!dealerBJ) {
    while (total(dCards) < 17) dCards.push(deal());   // S17
  }
  const dt    = total(dCards);
  const dBust = dt > 21;

  function resolve(res, isTop) {
    if (res.isSplit) return resolve(res.r1, false) + resolve(res.r2, false);
    const t = total(res.cards);
    const w = res.wager;
    if (res.isBJ && isTop) {
      return dealerBJ ? 0 : Math.round(w * 1.5);   // 3:2 BJ or push
    }
    if (t > 21)    return -w;    // player bust
    if (dealerBJ)  return -w;    // dealer BJ beats non-BJ
    if (dBust)     return  w;
    if (t > dt)    return  w;
    if (t === dt)  return  0;
    return -w;
  }

  const net = resolve(playerResult, true);
  return { net, wagered: totalWagered, rcDelta, newIdx: idx };
}

// ── Run simulation ────────────────────────────────────────────────────────
function runSim(schedule, winFactor, useMartingale, label) {
  let bankroll = STARTING_BK;
  let totalNet = 0, totalWag = 0;
  let hands = 0, wins = 0, losses = 0, pushes = 0;
  let maxBk = STARTING_BK, maxDd = 0;
  let busts = 0, posShoes = 0;
  let handsAtTC2plus = 0;
  let curBet = BASE_BET;

  // Bet histogram (key = $0, $100, $200, ... $1000)
  const betHist = new Array(11).fill(0);

  for (let shoeN = 0; shoeN < NUM_SHOES; shoeN++) {
    if (bankroll <= 0) { bankroll = STARTING_BK; busts++; }
    const shoe      = buildShoe();
    let idx         = 0;
    let rc          = 0;
    const shoeStart = bankroll;

    while (idx < shoe.length - RESHUFFLE_AT) {
      const decksLeft = (shoe.length - idx) / 52;
      const tc = decksLeft > 0.1 ? rc / decksLeft : 0;
      const cap = getCeiling(schedule, tc, bankroll);

      // ── Determine bet ──
      let bet;
      if (tc <= 0 || schedule === 'flat40') {
        curBet = BASE_BET;
        bet    = BASE_BET;
      } else if (useMartingale) {
        bet = Math.min(curBet, cap, TABLE_MAX, bankroll);
      } else {
        // Flat count: just bet the ceiling when count is good
        bet = Math.min(cap, TABLE_MAX, bankroll);
      }

      // Round to nearest $5, enforce minimums
      bet = Math.max(Math.round(bet / 5) * 5, 5);
      if (bet > bankroll) bet = bankroll;
      if (bet <= 0) break;

      // Record in histogram
      const histBkt = Math.min(Math.floor(bet / 100), 10);
      betHist[histBkt]++;

      if (tc >= 2) handsAtTC2plus++;

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
        if (useMartingale)
          curBet = Math.max(Math.round(curBet * winFactor / 5) * 5, BASE_BET);
      } else if (net < 0) {
        losses++;
        if (useMartingale)
          curBet = Math.min(Math.ceil(curBet * 1.5 / 5) * 5, cap, TABLE_MAX);
      } else {
        pushes++;
        // push: keep same bet
      }

      if (bankroll > maxBk) maxBk = bankroll;
      const dd = maxBk - bankroll;
      if (dd > maxDd) maxDd = dd;
      if (bankroll <= 0) { bankroll = 0; break; }
    }

    if (bankroll > shoeStart) posShoes++;
  }

  return {
    label, schedule, winFactor, useMartingale, hands,
    totalNet:   Math.round(totalNet),
    roi:        (totalNet / totalWag * 100).toFixed(4),
    evPerHand:  (totalNet / hands).toFixed(3),
    avgBet:     (totalWag / hands).toFixed(1),
    winPct:     (wins / hands * 100).toFixed(2),
    maxDd:      Math.round(maxDd),
    busts,
    posShoePct: (posShoes / NUM_SHOES * 100).toFixed(1),
    handsAtTC2plus,
    betHist,
    finalBk:    Math.round(bankroll),
  };
}

// ── Run all configs ───────────────────────────────────────────────────────
const configs = [
  // ── Baselines ──
  { sc: 'flat40',       wf: 1,   mg: false, label: '$40 Flat  (no count, baseline)     ' },
  { sc: 'moderate',     wf: 1,   mg: false, label: 'Moderate  FLAT count               ' },
  { sc: 'aggressive',   wf: 1,   mg: false, label: 'Aggressive FLAT count              ' },
  { sc: 'kelly',        wf: 1,   mg: false, label: 'Kelly     FLAT count               ' },
  // ── Half-martingale ÷2 ──
  { sc: 'conservative', wf: 0.5, mg: true,  label: 'Conservative  ÷2  half-martingale  ' },
  { sc: 'moderate',     wf: 0.5, mg: true,  label: 'Moderate      ÷2  half-martingale  ' },
  { sc: 'aggressive',   wf: 0.5, mg: true,  label: 'Aggressive    ÷2  half-martingale  ' },
  { sc: 'kelly',        wf: 0.5, mg: true,  label: 'Kelly         ÷2  half-martingale  ' },
  // ── Half-martingale ÷3 ──
  { sc: 'conservative', wf: 1/3, mg: true,  label: 'Conservative  ÷3  half-martingale  ' },
  { sc: 'moderate',     wf: 1/3, mg: true,  label: 'Moderate      ÷3  half-martingale  ' },
  { sc: 'aggressive',   wf: 1/3, mg: true,  label: 'Aggressive    ÷3  half-martingale  ' },
  { sc: 'kelly',        wf: 1/3, mg: true,  label: 'Kelly         ÷3  half-martingale  ' },
];

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Blackjack Ace-6 Count + Half-Martingale Backtest');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes : ${NUM_SHOES.toLocaleString()} × ~72 hands ≈ ${(NUM_SHOES * 72).toLocaleString()} hands`);
console.log(`  Rules : ${DECKS}-deck · S17 · BJ 3:2 · DAS · 75% penetration`);
console.log(`  Base  : $${BASE_BET}   Table max: $${TABLE_MAX}   Bankroll: $${STARTING_BK}`);
console.log(`  Count : 6 → +1 (better without 6s)  |  A → -1 (worse without aces)`);
console.log(`  MG    : ×1.5 loss / ÷2 or ÷3 win`);
console.log('');

const results = [];
for (const c of configs) {
  process.stdout.write(`  ${c.label}...`);
  const r = runSim(c.sc, c.wf, c.mg, c.label.trim());
  results.push(r);
  process.stdout.write(` EV: $${r.evPerHand}/hand  ROI: ${r.roi}%\n`);
}

// ── Summary table ─────────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(108));
console.log('  FULL RESULTS');
console.log('═'.repeat(108));
console.log(
  'Strategy'.padEnd(38) +
  'EV/hand'.padEnd(11) + 'ROI%'.padEnd(12) + 'AvgBet'.padEnd(10) +
  'Win%'.padEnd(9) + 'MaxDD'.padEnd(10) + 'Busts'.padEnd(8) + '+Shoe%'
);
console.log('─'.repeat(108));
for (const r of results) {
  console.log(
    r.label.padEnd(38) +
    ('$'+r.evPerHand).padEnd(11) + (r.roi+'%').padEnd(12) +
    ('$'+r.avgBet).padEnd(10) + (r.winPct+'%').padEnd(9) +
    ('$'+r.maxDd).padEnd(10) + (r.busts+'').padEnd(8) +
    (r.posShoePct+'%')
  );
}

// ── Top 3 ─────────────────────────────────────────────────────────────────
const ranked = [...results].sort((a, b) => parseFloat(b.evPerHand) - parseFloat(a.evPerHand));
console.log('');
console.log('  TOP 3 BY EV/HAND:');
for (let i = 0; i < Math.min(3, ranked.length); i++) {
  const r = ranked[i];
  console.log(`    #${i+1}: ${r.label}`);
  console.log(`         EV $${r.evPerHand}/hand  |  ROI ${r.roi}%  |  MaxDD $${r.maxDd}  |  AvgBet $${r.avgBet}`);
}

// ── Bet distribution for best martingale strategy ─────────────────────────
const bestMG = ranked.find(r => r.useMartingale);
if (bestMG) {
  console.log('');
  console.log(`  BET DISTRIBUTION — ${bestMG.label}`);
  console.log('  ─────────────────────────────────────────────');
  const totalH = bestMG.betHist.reduce((a, b) => a + b, 0);
  for (let i = 0; i <= 10; i++) {
    const lo = i * 100;
    const hi = lo + 99;
    const cnt = bestMG.betHist[i] || 0;
    const pct = totalH > 0 ? (cnt / totalH * 100).toFixed(1) : '0.0';
    const bar = '█'.repeat(Math.round(cnt / totalH * 40));
    console.log(`  $${String(lo).padEnd(4)}-$${String(hi).padEnd(5)} ${pct.padStart(5)}%  ${bar}`);
  }
}

// ── Ceiling schedule reference ────────────────────────────────────────────
console.log('');
console.log('═'.repeat(65));
console.log('  CEILING SCHEDULE — max bet allowed at each true count');
console.log('═'.repeat(65));
console.log('  TC      Consv    Moderate   Aggressive   Kelly($5k)');
console.log('  ──────────────────────────────────────────────────────');
for (const tc of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5]) {
  const cs = [
    getCeiling('conservative', tc, STARTING_BK),
    getCeiling('moderate',     tc, STARTING_BK),
    getCeiling('aggressive',   tc, STARTING_BK),
    getCeiling('kelly',        tc, STARTING_BK),
  ];
  console.log(
    `  TC ${(tc >= 0 ? '+' : '')}${tc.toFixed(1).padEnd(5)}` +
    String(cs[0]).padEnd(10) + String(cs[1]).padEnd(12) +
    String(cs[2]).padEnd(14) + String(cs[3])
  );
}

// ── LIVE COUNT TABLE — print at the table ────────────────────────────────
console.log('');
console.log('═'.repeat(82));
console.log('  LIVE COUNT TABLE  (Moderate ceiling)');
console.log('  Count (6s seen − Aces seen)  →  ceiling bet by decks remaining');
console.log('═'.repeat(82));
console.log('  RC  | 5 decks rem  | 4 decks rem  | 3 decks rem  | 2 decks rem  | 1 deck rem ');
console.log('  ────────────────────────────────────────────────────────────────────────────');
for (const rc of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
  const cells = [5, 4, 3, 2, 1].map(d => {
    const tc  = rc / d;
    const cap = getCeiling('moderate', tc, STARTING_BK);
    return `$${cap}(TC${tc.toFixed(1)})`.padEnd(14);
  });
  console.log(`  ${String(rc).padEnd(4)}| ${cells.join('| ')}`);
}

// ── Edge by TC ────────────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(58));
console.log('  ESTIMATED PLAYER EDGE   (Ace-6, perfect basic strategy)');
console.log('═'.repeat(58));
console.log('  TC       Edge          Bet ceiling (moderate)');
console.log('  ────────────────────────────────────────────────');
for (const tc of [-2, -1, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4]) {
  const edge = -0.005 + 0.0044 * tc;
  const pct  = (edge * 100).toFixed(2) + '%';
  const who  = edge > 0 ? '  ← PLAYER EDGE' : '  (house edge)';
  const cap  = getCeiling('moderate', tc, STARTING_BK);
  console.log(
    `  TC ${(tc >= 0 ? '+' : '')}${tc.toFixed(1).padEnd(6)}` +
    pct.padEnd(16) + `$${cap}`.padEnd(10) + who
  );
}
console.log('');
console.log('  * Ace-6 BC ≈ 0.88 vs Hi-Lo (less powerful but much simpler to track)');
console.log('  * Each TC unit swings edge ~0.44%.  Break-even ≈ TC +1.1');
console.log('  * Kelly sizing with $5k bankroll only justifies ~$40 at TC +3 —');
console.log('    Kelly ceiling requires larger bankroll to justify bigger bets.');
console.log('');
