'use strict';

// ════════════════════════════════════════════════════════════════════════
// Four-Tier ÷2 Soft-Reset — Deep Dive Analysis
// ════════════════════════════════════════════════════════════════════════
//
// STRATEGY:
//   Count: Six +1, Ace -1. True Count = RC / decks remaining.
//   TC ≤ 0  → bet $40 flat, keep martingale state (soft reset)
//   TC > 0  → full ×2 martingale, capped by four-tier ceiling:
//               TC 0-1  → $100
//               TC 1-2  → $250
//               TC 2-3  → $500
//               TC ≥ 3  → $1000 (table max)
//   WIN:    drop bet to ÷2 of previous (floor $40)
//   SOFT RESET: when TC drops ≤ 0, bet $40 but keep current martingale
//               depth — resume escalation when count goes positive again
//
// OUTPUT: depth dist · bet dist · per-shoe P/L · count profile ·
//         bankroll trajectory buckets · session risk analysis
// ════════════════════════════════════════════════════════════════════════

const DECKS        = 6;
const BASE_BET     = 40;
const TABLE_MAX    = 1000;
const STARTING_BK  = 5000;
const NUM_SHOES    = 100000;   // 100k shoes ≈ 7.2M hands for tight stats
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
function cv(r) { return r==='A'?11:r==='T'?10:parseInt(r,10); }
function total(cards) {
  let t=0,aces=0;
  for(const r of cards){if(r==='A'){t+=11;aces++;}else t+=cv(r);}
  while(t>21&&aces>0){t-=10;aces--;}
  return t;
}
function isSoft(cards){
  let t=0,aces=0;
  for(const r of cards){if(r==='A'){t+=11;aces++;}else t+=cv(r);}
  while(t>21&&aces>0){t-=10;aces--;}
  return aces>0&&t<=21;
}
function isNatural(cards){return cards.length===2&&total(cards)===21;}
function a6(r){return r==='6'?1:r==='A'?-1:0;}

// ── Basic strategy (6 deck, S17, DAS) ────────────────────────────────────
function bsPlay(cards, dealerUp, canDbl, canSpl, fromSplitAce) {
  const pt=total(cards),sft=isSoft(cards),du=cv(dealerUp);
  if(canSpl&&cards.length===2&&cards[0]===cards[1]&&!fromSplitAce){
    const p=cards[0],pv=cv(p);
    if(p==='A') return 'P'; if(p==='T') return 'S';
    if(pv===9) return(du===7||du===10||du===11)?'S':'P';
    if(pv===8) return 'P'; if(pv===7) return du<=7?'P':'H';
    if(pv===6) return du<=6?'P':'H'; if(pv===4) return(du===5||du===6)?'P':'H';
    if(pv===3||pv===2) return du<=7?'P':'H';
  }
  if(sft){
    if(pt>=20) return 'S';
    if(pt===19) return(canDbl&&du===6)?'D':'S';
    if(pt===18){if(canDbl&&du>=2&&du<=6)return 'D'; return du<=8?'S':'H';}
    if(pt===17) return(canDbl&&du>=3&&du<=6)?'D':'H';
    if(pt===16||pt===15) return(canDbl&&du>=4&&du<=6)?'D':'H';
    if(pt===14||pt===13) return(canDbl&&du>=5&&du<=6)?'D':'H';
    return 'H';
  }
  if(pt>=17) return 'S'; if(pt>=13) return du<=6?'S':'H';
  if(pt===12) return(du>=4&&du<=6)?'S':'H';
  if(pt===11) return canDbl?'D':'H';
  if(pt===10) return(canDbl&&du<=9)?'D':'H';
  if(pt===9) return(canDbl&&du>=3&&du<=6)?'D':'H';
  return 'H';
}

// ── Four-tier ceiling ─────────────────────────────────────────────────────
function getCeiling(tc) {
  if (tc <= 0) return BASE_BET;
  if (tc < 1)  return  100;
  if (tc < 2)  return  250;
  if (tc < 3)  return  500;
  return TABLE_MAX;   // TC ≥ 3 → $1000
}

// ── Simulate one hand ─────────────────────────────────────────────────────
function simHand(shoe, idx0, bet) {
  let idx=idx0,rcDelta=0,totalWagered=bet;
  function deal(){const r=shoe[idx++];rcDelta+=a6(r);return r;}
  const pCards=[deal(),deal()],dealerUp=deal(),dealerHole=shoe[idx++];
  function playHand(cards,wager,depth,splitAce){
    if(isNatural(cards)&&!splitAce) return{cards,wager,isBJ:true,isSplit:false};
    for(;;){
      const t=total(cards); if(t>=21) break;
      const canD=cards.length===2&&!splitAce;
      const canS=cards.length===2&&cards[0]===cards[1]&&depth<3;
      const a=bsPlay(cards,dealerUp,canD,canS,splitAce);
      if(a==='S') break;
      if(a==='H'){cards.push(deal());continue;}
      if(a==='D'){cards.push(deal());totalWagered+=wager;wager*=2;break;}
      if(a==='P'){
        const isAce=cards[0]==='A';
        const h1=[cards[0],deal()],h2=[cards[1],deal()];
        totalWagered+=wager;
        return{isSplit:true,r1:playHand(h1,wager,depth+1,isAce),r2:playHand(h2,wager,depth+1,isAce)};
      }
    }
    return{cards,wager,isBJ:false,isSplit:false};
  }
  const pr=playHand(pCards,bet,0,false);
  rcDelta+=a6(dealerHole);
  const dCards=[dealerUp,dealerHole];
  const dealerBJ=isNatural(dCards);
  if(!dealerBJ){while(total(dCards)<17)dCards.push(deal());}
  const dt=total(dCards),dBust=dt>21;
  function resolve(res,isTop){
    if(res.isSplit) return resolve(res.r1,false)+resolve(res.r2,false);
    const t=total(res.cards),w=res.wager;
    if(res.isBJ&&isTop) return dealerBJ?0:Math.round(w*1.5);
    if(t>21) return -w; if(dealerBJ) return -w;
    if(dBust) return w; if(t>dt) return w; if(t===dt) return 0; return -w;
  }
  return{net:resolve(pr,true),wagered:totalWagered,rcDelta,newIdx:idx};
}

// ── Simulation with detailed tracking ────────────────────────────────────
let bankroll  = STARTING_BK;
let totalNet  = 0, totalWag = 0;
let hands     = 0, wins = 0, losses = 0, pushes = 0;
let maxBk     = STARTING_BK, maxDd = 0;
let busts     = 0, posShoes = 0;
let curBet    = BASE_BET;
let curDepth  = 0;

// Detailed histograms
const depthCounts   = new Array(9).fill(0);   // MG depth 0-8
const betHist       = new Array(11).fill(0);  // $0-100, $100-200 ... $1000
const tcBuckets     = new Array(9).fill(0);   // TC buckets: <0, 0-0.5, 0.5-1, 1-1.5, 2, 2.5, 3, 3.5, 4+
const tcWag         = new Array(9).fill(0);   // wagered at each TC bucket
const tcNet         = new Array(9).fill(0);   // net at each TC bucket
const tcHands       = new Array(9).fill(0);   // hands at each TC bucket

// Per-shoe P/L distribution (bucketed)
const shoeResults   = [];   // net per shoe (sampled — store every shoe up to 10k)
const shoeBuckets   = new Array(21).fill(0); // -$1000+ ... +$1000+, each $100 bucket

// Bankroll trajectory (sampled every 100 shoes)
const bkTrajectory  = [];

// Consecutive loss streak distribution
const streakCounts  = new Array(12).fill(0);
let   curStreak     = 0;

// Count frequency — how often is TC in each range
const tcFreq = new Array(9).fill(0);

function tcIdx(tc) {
  if (tc < 0)   return 0;
  if (tc < 0.5) return 1;
  if (tc < 1)   return 2;
  if (tc < 1.5) return 3;
  if (tc < 2)   return 4;
  if (tc < 2.5) return 5;
  if (tc < 3)   return 6;
  if (tc < 4)   return 7;
  return 8;
}

console.log(`Running ${NUM_SHOES.toLocaleString()} shoes...`);

for (let shoeN = 0; shoeN < NUM_SHOES; shoeN++) {
  if (bankroll <= 0) { bankroll = STARTING_BK; busts++; }
  const shoe = buildShoe(); let idx = 0, rc = 0;
  const shoeStart = bankroll;
  let shoeNet = 0;

  while (idx < shoe.length - RESHUFFLE_AT) {
    const decksLeft = (shoe.length - idx) / 52;
    const tc  = decksLeft > 0.1 ? rc / decksLeft : 0;
    const cap = getCeiling(tc);
    const ti  = tcIdx(tc);
    tcFreq[ti]++;

    let bet;
    if (tc <= 0) {
      // Soft reset: keep curBet/curDepth state but bet base
      bet = BASE_BET;
    } else {
      bet = Math.min(curBet, cap, TABLE_MAX, bankroll);
    }
    bet = Math.max(Math.round(bet / 5) * 5, 5);
    if (bet > bankroll) bet = bankroll;
    if (bet <= 0) break;

    betHist[Math.min(Math.floor(bet / 100), 10)]++;
    depthCounts[Math.min(curDepth, 8)]++;

    const r = simHand(shoe, idx, bet);
    idx = r.newIdx; rc += r.rcDelta;

    const net = r.net;
    bankroll += net; totalNet += net; totalWag += r.wagered;
    shoeNet  += net;
    hands++;

    tcBuckets[ti]++;
    tcWag[ti] += r.wagered;
    tcNet[ti] += net;

    if (net > 0) {
      wins++;
      curBet   = Math.max(Math.round(curBet * 0.5 / 5) * 5, BASE_BET);
      curDepth = curBet <= BASE_BET ? 0 : Math.max(0, curDepth - 1);
      curStreak = 0;
    } else if (net < 0) {
      losses++;
      curStreak++;
      streakCounts[Math.min(curStreak, 11)]++;
      curBet   = Math.min(Math.ceil(curBet * 2 / 5) * 5, cap, TABLE_MAX);
      curDepth = Math.min(curDepth + 1, 8);
    } else {
      pushes++;
      curStreak = 0;
    }

    if (bankroll > maxBk) maxBk = bankroll;
    const dd = maxBk - bankroll; if (dd > maxDd) maxDd = dd;
    if (bankroll <= 0) { bankroll = 0; break; }
  }

  if (bankroll > shoeStart) posShoes++;
  if (shoeN < 100000) {
    const bkt = Math.max(0, Math.min(20, Math.floor(shoeNet / 100) + 10));
    shoeBuckets[bkt]++;
  }
  if (shoeN % 100 === 0) bkTrajectory.push(bankroll);
}

// ── Output ────────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  FOUR-TIER ÷2 SOFT  —  Full Detail Analysis');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes  : ${NUM_SHOES.toLocaleString()}`);
console.log(`  Hands  : ${hands.toLocaleString()}`);
console.log(`  Rules  : ${DECKS}-deck · S17 · BJ 3:2 · DAS · 75% penetration`);
console.log('');
console.log('  STRATEGY:');
console.log('  ─ Count : Six +1  Ace -1  (Ace-6)');
console.log('  ─ TC ≤ 0: bet $40, hold martingale state (soft reset)');
console.log('  ─ TC 0-1: ceiling $100  │  TC 1-2: ceiling $250');
console.log('  ─ TC 2-3: ceiling $500  │  TC ≥ 3: ceiling $1000 (table max)');
console.log('  ─ Loss  : double bet (×2), capped at ceiling');
console.log('  ─ Win   : halve bet (÷2), minimum $40');
console.log('');

// ── Top-line stats ────────────────────────────────────────────────────────
const roi       = (totalNet / totalWag * 100).toFixed(4);
const evPerHand = (totalNet / hands).toFixed(4);
const avgBet    = (totalWag / hands).toFixed(2);
const winPct    = (wins / hands * 100).toFixed(2);
const pushPct   = (pushes / hands * 100).toFixed(2);
const losePct   = (losses / hands * 100).toFixed(2);

console.log('  TOP-LINE RESULTS');
console.log('  ───────────────────────────────────────────────');
console.log(`  EV per hand    : $${evPerHand}`);
console.log(`  ROI            : ${roi}%`);
console.log(`  Avg bet        : $${avgBet}`);
console.log(`  Hands          : ${hands.toLocaleString()}`);
console.log(`  Win / Push / Lose: ${winPct}% / ${pushPct}% / ${losePct}%`);
console.log(`  Max drawdown   : $${maxDd.toLocaleString()}`);
console.log(`  Busts (rebuy)  : ${busts}  (${(busts/NUM_SHOES*100).toFixed(3)}% of shoes)`);
console.log(`  +EV shoes      : ${posShoes.toLocaleString()}  (${(posShoes/NUM_SHOES*100).toFixed(1)}%)`);
console.log(`  Final bankroll : $${bankroll.toLocaleString()}`);

// ── Martingale depth distribution ────────────────────────────────────────
const totalH = depthCounts.reduce((a,b)=>a+b,0);
console.log('');
console.log('  MARTINGALE DEPTH DISTRIBUTION');
console.log('  Depth = consecutive unresolved losses in current streak');
console.log('  ──────────────────────────────────────────────────────────────');
let bval = BASE_BET;
let cumPct = 0;
for (let d = 0; d < 9; d++) {
  const cnt = depthCounts[d];
  const pct = (cnt / totalH * 100);
  cumPct += pct;
  const cap = getCeiling(1.5);  // example ceiling — actual cap varies by TC
  const bStr = `$${Math.min(bval, TABLE_MAX)}`;
  const bar  = '█'.repeat(Math.round(pct * 0.6));
  console.log(
    `  Depth ${d} bet ${bStr.padEnd(7)} ${pct.toFixed(2).padStart(6)}%  cumul ${cumPct.toFixed(1).padStart(5)}%  ${bar}`
  );
  bval = Math.min(bval * 2, TABLE_MAX * 2);
}

// ── Bet size distribution ────────────────────────────────────────────────
const totalBH = betHist.reduce((a,b)=>a+b,0);
console.log('');
console.log('  BET SIZE DISTRIBUTION');
console.log('  ─────────────────────────────────────────────────────────────');
for (let i = 0; i <= 10; i++) {
  const lo = i * 100;
  const hi = i === 10 ? 1000 : lo + 99;
  const cnt = betHist[i];
  const pct = (cnt / totalBH * 100);
  const bar = '█'.repeat(Math.round(pct * 0.5));
  console.log(`  $${String(lo).padEnd(5)}-$${String(hi).padEnd(5)}  ${pct.toFixed(2).padStart(6)}%  ${bar}`);
}

// ── True count profile ────────────────────────────────────────────────────
const TC_LABELS = ['TC < 0 ','TC 0-0.5','TC 0.5-1','TC 1-1.5','TC 1.5-2','TC 2-2.5','TC 2.5-3','TC 3-4  ','TC 4+   '];
const TC_CAPS   = [BASE_BET,  BASE_BET,   100,       100,       250,       250,        500,       TABLE_MAX, TABLE_MAX];
const TC_EDGES  = [-0.9,      -0.5,      -0.28,     -0.06,     0.16,      0.38,       0.60,       0.82,       1.26];
console.log('');
console.log('  COUNT PROFILE — how often each TC range is seen & EV contribution');
console.log('  ───────────────────────────────────────────────────────────────────────────────');
console.log('  TC Range    Freq%   AvgBet   ROI at TC   Net contrib   Edge     Ceiling');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
const totHands = tcBuckets.reduce((a,b)=>a+b,0);
for (let i = 0; i < 9; i++) {
  const cnt   = tcBuckets[i];
  if (!cnt) continue;
  const freq  = (cnt / totHands * 100).toFixed(1);
  const aWag  = tcWag[i] / cnt;
  const roiTC = tcWag[i] > 0 ? (tcNet[i] / tcWag[i] * 100).toFixed(3) : '—';
  const netC  = Math.round(tcNet[i]);
  const edge  = TC_EDGES[i];
  const cap   = TC_CAPS[i];
  const bar   = '▓'.repeat(Math.round(cnt / totHands * 30));
  console.log(
    `  ${TC_LABELS[i]}  ${freq.padStart(5)}%  $${aWag.toFixed(0).padStart(5)}   ${roiTC.padStart(8)}%  $${String(netC).padStart(10)}  ${edge>0?'+':''}${edge.toFixed(2)}%  $${cap}   ${bar}`
  );
}

// ── Per-shoe P/L distribution ─────────────────────────────────────────────
const totalShoeCount = shoeBuckets.reduce((a,b)=>a+b,0);
console.log('');
console.log('  PER-SHOE P/L DISTRIBUTION  (per 72-hand session)');
console.log('  ─────────────────────────────────────────────────────────────');
for (let i = 0; i < 21; i++) {
  const lo   = (i - 10) * 100;
  const hi   = lo + 99;
  const cnt  = shoeBuckets[i];
  const pct  = (cnt / totalShoeCount * 100);
  const bar  = '█'.repeat(Math.round(pct * 0.8));
  const sign = lo >= 0 ? '+' : '';
  if (pct > 0.1) {
    console.log(`  ${sign}$${String(lo).padStart(5)}-${sign}$${String(lo<0?hi:hi).padStart(4)}  ${pct.toFixed(1).padStart(5)}%  ${bar}`);
  }
}
const posShoesPct = (posShoes / NUM_SHOES * 100).toFixed(1);
console.log(`  Win shoe: ${posShoesPct}%  |  Lose shoe: ${(100-parseFloat(posShoesPct)).toFixed(1)}%`);

// ── Consecutive loss streak analysis ────────────────────────────────────
const totalStreaks = streakCounts.reduce((a,b)=>a+b,0);
console.log('');
console.log('  CONSECUTIVE LOSS STREAK ANALYSIS');
console.log('  ─────────────────────────────────────────────────────────────────────────');
console.log('  Streak  Frequency   Bet after   Total at risk if this streak hit');
let runBet = BASE_BET;
for (let s = 1; s <= 11; s++) {
  const cnt = streakCounts[s] || 0;
  const pct = (cnt / totalStreaks * 100).toFixed(3);
  runBet    = Math.min(runBet * 2, TABLE_MAX);
  const totalRisk = BASE_BET * (Math.pow(2, s) - 1);
  console.log(
    `  ${String(s).padStart(3)} loss   ${pct.padStart(8)}%   $${String(Math.min(runBet, TABLE_MAX)).padEnd(6)}  $${totalRisk.toLocaleString()} total lost`
  );
  if (s === 3) console.log('  ───── ceiling kicks in below here for most TC levels ─────');
}

// ── Full progression cheat sheet ─────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  QUICK REFERENCE — What to bet at each count and loss depth');
console.log('  RC = (6s seen) − (Aces seen)');
console.log('════════════════════════════════════════════════════════════════');
console.log('');
console.log('  Situation         | Ceiling | D0    D1    D2    D3    D4    D5');
console.log('  ────────────────────────────────────────────────────────────────────');

const situations = [
  { label: 'RC ≤ 0  (any depth)', tc: -0.5 },
  { label: 'RC=1, 5 decks (TC+0.2)', tc: 0.2 },
  { label: 'RC=2, 4 decks (TC+0.5)', tc: 0.5 },
  { label: 'RC=3, 4 decks (TC+0.75)',tc: 0.75},
  { label: 'RC=4, 4 decks (TC+1.0)', tc: 1.0 },
  { label: 'RC=4, 3 decks (TC+1.3)', tc: 1.3 },
  { label: 'RC=5, 3 decks (TC+1.7)', tc: 1.7 },
  { label: 'RC=6, 3 decks (TC+2.0)', tc: 2.0 },
  { label: 'RC=6, 2 decks (TC+3.0)', tc: 3.0 },
  { label: 'RC=8, 2 decks (TC+4.0)', tc: 4.0 },
];

for (const s of situations) {
  const cap   = getCeiling(s.tc);
  const bets  = [40,80,160,320,640,1000].map(b => '$'+String(Math.min(b,cap)).padEnd(5));
  console.log(`  ${s.label.padEnd(28)}| $${String(cap).padEnd(5)}  ${bets.join(' ')}`);
}

// ── Key stats summary ──────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  BOTTOM LINE');
console.log('════════════════════════════════════════════════════════════════');
const handsAtEdge = tcBuckets.slice(5).reduce((a,b)=>a+b,0);
const edgePct = (handsAtEdge / totHands * 100).toFixed(1);
console.log(`  ${edgePct}% of hands played at TC≥2 (positive player edge)`);
console.log(`  ${(tcBuckets[0]/totHands*100).toFixed(1)}% of hands at TC<0 (sitting on $40 soft-reset)`);
console.log(`  Average bet when count is positive: $${(tcWag.slice(2).reduce((a,b)=>a+b,0)/tcBuckets.slice(2).reduce((a,b)=>a+b,0)||0).toFixed(0)}`);
console.log(`  Average bet when count is negative: $${(tcWag[0]/tcBuckets[0]||0).toFixed(0)}`);
console.log(`  Bust rate: 1 in ${Math.round(NUM_SHOES/Math.max(busts,1))} shoes`);
console.log(`  Expected session P/L ($5k bankroll, 1 shoe): $${(totalNet/NUM_SHOES).toFixed(2)}`);
console.log(`  Expected session P/L ($5k bankroll, 6 hours ≈ 6 shoes): $${(totalNet/NUM_SHOES*6).toFixed(2)}`);
console.log('');
