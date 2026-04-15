'use strict';

// ════════════════════════════════════════════════════════════════════════
// RC-Based Tiering  —  8-deck, $10 min, Hard+Step reset
// ════════════════════════════════════════════════════════════════════════
//
// Previous scripts used TC-based ceilings (requires dividing RC by decks
// remaining). This tests RC-based ceilings — simpler at the table, just
// track (sixes seen) − (aces seen).
//
// With 8 decks: max RC = 32 (all sixes out). Practical positive range is
// RC +1 to +12 (most common positive territory mid-shoe).
//
// RESET MODE: hard+step (script 23 winner)
//   — TC ≤ 0: hard reset to $10
//   — if curBet > ceiling(rc): hard reset to $10
//
// SCHEDULES TESTED:
//   tc_baseline — four-tier TC schedule (script 23 winner for reference)
//                 TC 0-1→$100, TC 1-2→$250, TC 2-3→$500, TC≥3→$1000
//
//   rc_linear   — evenly spread across RC 1-12, then max
//                 RC 1-2→$100, RC 3-4→$250, RC 5-6→$400, RC 7-9→$600, RC 10-12→$800, RC≥13→$1000
//
//   rc_steep    — slow early, then jumps hard at RC 6+
//                 RC 1-3→$100, RC 4-5→$200, RC 6-7→$400, RC 8-10→$700, RC≥11→$1000
//
//   rc_gradual  — many small steps, slower escalation
//                 RC 1→$50, RC 2→$100, RC 3→$150, RC 4→$200, RC 5→$300, RC 6→$400,
//                 RC 7→$500, RC 8→$600, RC 9→$700, RC 10→$800, RC 11→$900, RC≥12→$1000
//
//   rc_jump     — flat low bet until RC is clearly positive, then jump
//                 RC 1-5→$100, RC 6-9→$500, RC≥10→$1000
//
// 8 decks · $10 base · $1000 table max · 75% penetration · 100,000 shoes
// ════════════════════════════════════════════════════════════════════════

const DECKS        = 8;
const BASE_BET     = 10;
const TABLE_MAX    = 1000;
const STARTING_BK  = 5000;
const NUM_SHOES    = 100000;
const RESHUFFLE_AT = 104;  // ~75% of 416

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

// ── Ceiling schedules ─────────────────────────────────────────────────────

function getTCCeiling(tc) {
  if (tc <= 0) return BASE_BET;
  if (tc < 1)  return  100;
  if (tc < 2)  return  250;
  if (tc < 3)  return  500;
  return TABLE_MAX;
}

// RC-based ceilings (no division needed at the table)
function getRCCeiling(rc, schedule) {
  if (rc <= 0) return BASE_BET;
  switch(schedule) {
    case 'rc_linear':
      if (rc <= 2)  return  100;
      if (rc <= 4)  return  250;
      if (rc <= 6)  return  400;
      if (rc <= 9)  return  600;
      if (rc <= 12) return  800;
      return TABLE_MAX;
    case 'rc_steep':
      if (rc <= 3)  return  100;
      if (rc <= 5)  return  200;
      if (rc <= 7)  return  400;
      if (rc <= 10) return  700;
      return TABLE_MAX;
    case 'rc_gradual':
      if (rc === 1) return   50;
      if (rc === 2) return  100;
      if (rc === 3) return  150;
      if (rc === 4) return  200;
      if (rc === 5) return  300;
      if (rc === 6) return  400;
      if (rc === 7) return  500;
      if (rc === 8) return  600;
      if (rc === 9) return  700;
      if (rc === 10) return 800;
      if (rc === 11) return 900;
      return TABLE_MAX;
    case 'rc_jump':
      if (rc <= 5)  return  100;
      if (rc <= 9)  return  500;
      return TABLE_MAX;
    default:
      return TABLE_MAX;
  }
}

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

// ── Simulation ────────────────────────────────────────────────────────────
// schedule: 'tc_baseline' | 'rc_linear' | 'rc_steep' | 'rc_gradual' | 'rc_jump'
function runSim(schedule) {
  let bankroll=STARTING_BK,totalNet=0,totalWag=0;
  let hands=0,wins=0,losses=0,pushes=0;
  let maxBk=STARTING_BK,maxDd=0,busts=0,posShoes=0;
  let curBet=BASE_BET,curDepth=0;

  const depthCounts=new Array(9).fill(0);
  const shoePLbuckets=new Array(21).fill(0);

  // RC distribution when betting above base
  const rcWhenBetting=new Array(33).fill(0); // index = rc, 0..32

  for(let shoeN=0;shoeN<NUM_SHOES;shoeN++){
    if(bankroll<=0){bankroll=STARTING_BK;busts++;}
    const shoe=buildShoe(); let idx=0,rc=0;
    const shoeStart=bankroll;

    while(idx<shoe.length-RESHUFFLE_AT){
      const decksLeft=(shoe.length-idx)/52;
      const tc=decksLeft>0.1?rc/decksLeft:0;

      // Get ceiling based on schedule
      let cap;
      if (schedule === 'tc_baseline') {
        cap = getTCCeiling(tc);
      } else {
        cap = getRCCeiling(rc, schedule);
      }

      // hard reset on TC ≤ 0 (all modes share this)
      if (tc <= 0) {
        curBet = BASE_BET; curDepth = 0;
      }

      // hard+step: full reset if curBet exceeds current ceiling
      if (curBet > cap) { curBet = BASE_BET; curDepth = 0; }

      let bet = tc <= 0 ? BASE_BET : Math.min(curBet, cap, TABLE_MAX, bankroll);
      bet = Math.max(Math.round(bet/5)*5, BASE_BET);
      if (bet > bankroll) bet = bankroll;
      if (bet <= 0) break;

      depthCounts[Math.min(curDepth,8)]++;
      if (bet > BASE_BET) rcWhenBetting[Math.min(Math.max(rc,0),32)]++;

      const r=simHand(shoe,idx,bet);
      idx=r.newIdx; rc+=r.rcDelta;

      const net=r.net;
      bankroll+=net; totalNet+=net; totalWag+=r.wagered; hands++;

      if(net>0){
        wins++;
        curBet=Math.max(Math.round(curBet*0.5/5)*5,BASE_BET);
        curDepth=curBet<=BASE_BET?0:Math.max(0,curDepth-1);
      } else if(net<0){
        losses++;
        curBet=Math.min(Math.ceil(curBet*2/5)*5,cap,TABLE_MAX);
        curDepth=Math.min(curDepth+1,8);
      } else { pushes++; }

      if(bankroll>maxBk) maxBk=bankroll;
      const dd=maxBk-bankroll; if(dd>maxDd) maxDd=dd;
      if(bankroll<=0){bankroll=0;break;}
    }

    if(bankroll>shoeStart) posShoes++;
    const shoeNet=bankroll-shoeStart;
    const bkt=Math.max(0,Math.min(20,Math.floor(shoeNet/100)+10));
    shoePLbuckets[bkt]++;
  }

  return {
    schedule, hands,
    totalNet:    Math.round(totalNet),
    roi:         (totalNet/totalWag*100).toFixed(4),
    evPerHand:   (totalNet/hands).toFixed(4),
    avgBet:      (totalWag/hands).toFixed(2),
    winPct:      (wins/hands*100).toFixed(2),
    maxDd:       Math.round(maxDd),
    busts,
    bustRate:    Math.round(NUM_SHOES/Math.max(busts,1)),
    posShoePct:  (posShoes/NUM_SHOES*100).toFixed(1),
    sessionEV:   (totalNet/NUM_SHOES).toFixed(2),
    depthCounts, shoePLbuckets, rcWhenBetting,
    finalBk:     Math.round(bankroll),
  };
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  RC-Based Tiering  —  8-deck · $10 min · Hard+Step Reset');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes: ${NUM_SHOES.toLocaleString()}   |   Bankroll: $${STARTING_BK}   |   Table max: $${TABLE_MAX}`);
console.log('');
console.log('  SCHEDULES:');
console.log('  tc_baseline  TC 0-1→$100, TC 1-2→$250, TC 2-3→$500, TC≥3→$1000');
console.log('  rc_linear    RC 1-2→$100, RC 3-4→$250, RC 5-6→$400, RC 7-9→$600, RC 10-12→$800, RC≥13→$1000');
console.log('  rc_steep     RC 1-3→$100, RC 4-5→$200, RC 6-7→$400, RC 8-10→$700, RC≥11→$1000');
console.log('  rc_gradual   RC 1→$50 … RC 11→$900, RC≥12→$1000  (one step per RC unit)');
console.log('  rc_jump      RC 1-5→$100, RC 6-9→$500, RC≥10→$1000');
console.log('');

const schedules = ['tc_baseline','rc_linear','rc_steep','rc_gradual','rc_jump'];
const results = {};
for(const s of schedules){
  process.stdout.write(`  Running ${s.padEnd(14)}...`);
  results[s] = runSim(s);
  const r = results[s];
  process.stdout.write(` EV: $${r.evPerHand}/hand  ROI: ${r.roi}%  Busts: ${r.busts}  +Shoe: ${r.posShoePct}%\n`);
}

// ── Comparison table ──────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(110));
console.log('  SIDE-BY-SIDE COMPARISON');
console.log('═'.repeat(110));
const W = 22;
const metrics = [
  ['EV per hand',         r => '$'+r.evPerHand],
  ['ROI',                 r => r.roi+'%'],
  ['Avg bet',             r => '$'+r.avgBet],
  ['Win%',                r => r.winPct+'%'],
  ['Max drawdown',        r => '$'+r.maxDd.toLocaleString()],
  ['Busts',               r => r.busts+' (1:'+r.bustRate+')'],
  ['Win shoe %',          r => r.posShoePct+'%'],
  ['Session EV (1 shoe)', r => '$'+r.sessionEV],
  ['Session EV (6 shoe)', r => '$'+(parseFloat(r.sessionEV)*6).toFixed(2)],
];
const hdrs = ['tc_baseline','rc_linear','rc_steep','rc_gradual','rc_jump'];
console.log('  Metric'.padEnd(28) + hdrs.map(h=>h.padEnd(W)).join(''));
console.log('  ' + '─'.repeat(108));
for(const [label, fn] of metrics){
  console.log('  ' + label.padEnd(26) + schedules.map(s=>fn(results[s]).padEnd(W)).join(''));
}

// ── Ceiling schedule comparison ───────────────────────────────────────────
console.log('');
console.log('  CEILING SCHEDULE COMPARISON  (what is the max bet at each RC level?)');
console.log('  Note: tc_baseline ceiling depends on decks remaining; shown at 4 decks left');
console.log('  ─────────────────────────────────────────────────────────────────────────────────────────');
console.log('  RC   TC@4d   tc_baseline   rc_linear   rc_steep   rc_gradual   rc_jump');
console.log('  ─────────────────────────────────────────────────────────────────────────────────────────');
for(let rc=0; rc<=16; rc++){
  const tc4 = rc/4;
  const tcCap = getTCCeiling(tc4);
  const lin   = rc<=0 ? BASE_BET : getRCCeiling(rc,'rc_linear');
  const steep = rc<=0 ? BASE_BET : getRCCeiling(rc,'rc_steep');
  const grad  = rc<=0 ? BASE_BET : getRCCeiling(rc,'rc_gradual');
  const jump  = rc<=0 ? BASE_BET : getRCCeiling(rc,'rc_jump');
  console.log(
    `  RC${String(rc).padStart(2)}  TC${tc4.toFixed(2).padStart(5)}   `+
    `$${String(tcCap).padEnd(12)} $${String(lin).padEnd(11)} $${String(steep).padEnd(10)} $${String(grad).padEnd(12)} $${jump}`
  );
}

// ── RC distribution when betting above base (tc_baseline vs best RC schedule) ──
console.log('');
console.log('  RC DISTRIBUTION WHEN BETTING ABOVE $10 BASE  (tc_baseline vs rc_gradual)');
console.log('  Shows which RC values trigger above-base bets most often');
console.log('  ─────────────────────────────────────────────────────────────────────────');
const tb = results.tc_baseline.rcWhenBetting;
const rg = results.rc_gradual.rcWhenBetting;
const tbTotal = tb.reduce((a,b)=>a+b,0)||1;
const rgTotal = rg.reduce((a,b)=>a+b,0)||1;
console.log('  RC    tc_baseline%   rc_gradual%');
for(let rc=0; rc<=20; rc++){
  const p1 = (tb[rc]/tbTotal*100).toFixed(1);
  const p2 = (rg[rc]/rgTotal*100).toFixed(1);
  if(parseFloat(p1)>0.5||parseFloat(p2)>0.5){
    const bar1='█'.repeat(Math.round(tb[rc]/tbTotal*30));
    console.log(`  RC${String(rc).padStart(2)}   ${p1.padStart(6)}%       ${p2.padStart(6)}%   ${bar1}`);
  }
}

// ── Martingale depth distribution ─────────────────────────────────────────
console.log('');
console.log('  MARTINGALE DEPTH DISTRIBUTION');
console.log('  ─────────────────────────────────────────────────────────────────────────────────────────');
console.log('  Depth  Bet    ' + hdrs.map(h=>h.padEnd(W)).join(''));
console.log('  ──────────────────────────────────────────────────────');
let bv = BASE_BET;
for(let d=0;d<=8;d++){
  const totals = schedules.map(s=>results[s].depthCounts.reduce((a,b)=>a+b,0));
  const pcts = schedules.map((s,i)=>(results[s].depthCounts[d]/totals[i]*100).toFixed(2)+'%');
  console.log(`  Depth ${d}  $${String(Math.min(bv,TABLE_MAX)).padEnd(5)}  `+pcts.map(p=>p.padEnd(W)).join(''));
  bv = Math.min(bv*2, TABLE_MAX*2);
}

// ── Per-shoe P/L ──────────────────────────────────────────────────────────
console.log('');
console.log('  PER-SHOE P/L COMPARISON  (one ~72-hand session)');
console.log('  ──────────────────────────────────────────────────────────────────────────');
console.log('  Result          '+hdrs.map(h=>h.padEnd(W)).join(''));
console.log('  ──────────────────────────────────────────────────────────────────────────');
const labels=['< -$900','-$800','-$700','-$600','-$500','-$400','-$300','-$200','-$100',
  'break-even','+$0-100','+$100','+$200','+$300','+$400','+$500','+$600','+$700','+$800','+$900','> +$900'];
for(let i=0;i<21;i++){
  const pcts = schedules.map(s=>(results[s].shoePLbuckets[i]/NUM_SHOES*100).toFixed(1)+'%');
  if(pcts.some(p=>parseFloat(p)>0.2)){
    console.log(`  ${labels[i].padEnd(16)}`+pcts.map(p=>p.padEnd(W)).join(''));
  }
}

// ── Practical table for best RC schedule ──────────────────────────────────
// Find best schedule by EV
const best = schedules.slice(1).reduce((a,b)=>
  parseFloat(results[a].evPerHand)>=parseFloat(results[b].evPerHand)?a:b
);
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  BEST RC SCHEDULE: ${best.toUpperCase()}`);
console.log('  QUICK REFERENCE — WHAT TO BET AT THE TABLE');
console.log('════════════════════════════════════════════════════════════════');
console.log('');
console.log('  TRACK: RC = (sixes seen) − (aces seen)');
console.log('  No division required. Reset depth to $10 if RC ≤ 0.');
console.log('');
console.log('  CEILING TABLE:');
for(let rc=0; rc<=14; rc++){
  const cap = rc<=0 ? BASE_BET : getRCCeiling(rc, best);
  const arrow = rc===0?' ← hard reset (if RC flips neg, also reset)':'';
  console.log(`    RC = ${String(rc).padStart(2)} → max bet $${cap}${arrow}`);
}
console.log(`    RC ≥ 15 → max bet $1000`);
console.log('');
console.log('  BET TABLE (depth = consecutive losses in current streak):');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
console.log('  RC   Ceiling   D0    D1    D2    D3    D4    D5    D6    D7');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
const rcRows = [0,1,2,3,4,5,6,7,8,9,10,11,12];
for(const rc of rcRows){
  const cap = rc<=0 ? BASE_BET : getRCCeiling(rc, best);
  const depths = [10,20,40,80,160,320,640,1000].map(b=>'$'+String(Math.min(b,cap)));
  const note = rc===0?' ← reset':'';
  console.log(`  RC${String(rc).padStart(2)}  $${String(cap).padEnd(6)}  ${depths.join('  ')}${note}`);
}
console.log('');
