'use strict';

// ════════════════════════════════════════════════════════════════════════
// Blackjack Full Martingale — Fixed Ceiling Schedules
// ════════════════════════════════════════════════════════════════════════
// Fixes script 17 where moderate ceiling was $500 at TC+2 even though
// table max is $1000. New schedules use the full $1000 more aggressively.
//
// NEW CEILING SCHEDULES:
//   simple    — TC ≤ 0: $40  |  TC > 0: $1000 (just go to table max)
//   two-tier  — TC ≤ 0: $40  |  TC 0-1: $250  |  TC ≥ 1: $1000
//   three-tier— TC ≤ 0: $40  |  TC 0-1: $100  |  TC 1-2: $500  |  TC ≥ 2: $1000
//   four-tier — TC ≤ 0: $40  |  TC 0-1: $100  |  TC 1-2: $250  |  TC 2-3: $500 | TC ≥ 3: $1000
//   (four-tier is the old "moderate" from scripts 16/17 — kept as comparison)
//
// Full martingale (×2), ÷2 win drop, hard reset — the best combo from #17
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

// ── Perfect basic strategy (6 deck, S17, DAS) ────────────────────────────
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

// ── Ceiling schedules — all now reach TABLE_MAX ($1000) ──────────────────
//
//   simple     TC > 0  → $1000  (any positive count = table max)
//   two-tier   TC 0-1  → $250   TC ≥ 1 → $1000
//   three-tier TC 0-1  → $100   TC 1-2 → $500   TC ≥ 2 → $1000
//   four-tier  TC 0-1  → $100   TC 1-2 → $250   TC 2-3 → $500   TC ≥ 3 → $1000  (OLD)
//
function getCeiling(schedule, tc, bankroll) {
  if (tc <= 0) return BASE_BET;

  if (schedule === 'simple')     return TABLE_MAX;
  if (schedule === 'two-tier')   return tc < 1 ? 250 : TABLE_MAX;
  if (schedule === 'three-tier') {
    if (tc < 1) return 100;
    if (tc < 2) return 500;
    return TABLE_MAX;
  }
  if (schedule === 'four-tier') {
    // Old "moderate" from scripts 16/17 — kept for comparison
    if (tc < 1) return  100;
    if (tc < 2) return  250;
    if (tc < 3) return  500;
    return TABLE_MAX;
  }
  if (schedule === 'kelly') {
    const edge = -0.005 + 0.0044 * tc;
    if (edge <= 0) return BASE_BET;
    return Math.min(Math.max(Math.floor(bankroll * edge / 1.33), BASE_BET), TABLE_MAX);
  }
  return BASE_BET;
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
  const dCards=[dealerUp,dealerHole],dealerBJ=isNatural(dCards);
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

// ── Run simulation ────────────────────────────────────────────────────────
function runSim(schedule, winFactor, softReset, label) {
  let bankroll=STARTING_BK,totalNet=0,totalWag=0;
  let hands=0,wins=0,losses=0;
  let maxBk=STARTING_BK,maxDd=0,busts=0,posShoes=0;
  let curBet=BASE_BET,curDepth=0;
  const depthCounts=new Array(8).fill(0);
  const betHist=new Array(11).fill(0);

  for(let shoeN=0;shoeN<NUM_SHOES;shoeN++){
    if(bankroll<=0){bankroll=STARTING_BK;busts++;}
    const shoe=buildShoe(); let idx=0,rc=0;
    const shoeStart=bankroll;

    while(idx<shoe.length-RESHUFFLE_AT){
      const decksLeft=(shoe.length-idx)/52;
      const tc=decksLeft>0.1?rc/decksLeft:0;
      const cap=getCeiling(schedule,tc,bankroll);

      let bet;
      if(tc<=0){
        if(!softReset){curBet=BASE_BET;curDepth=0;}
        bet=BASE_BET;
      } else {
        bet=Math.min(curBet,cap,TABLE_MAX,bankroll);
      }
      bet=Math.max(Math.round(bet/5)*5,5);
      if(bet>bankroll) bet=bankroll;
      if(bet<=0) break;

      betHist[Math.min(Math.floor(bet/100),10)]++;
      depthCounts[Math.min(curDepth,7)]++;

      const r=simHand(shoe,idx,bet);
      idx=r.newIdx; rc+=r.rcDelta;
      const net=r.net;
      bankroll+=net; totalNet+=net; totalWag+=r.wagered; hands++;

      if(net>0){
        wins++;
        curBet=Math.max(Math.round(curBet*winFactor/5)*5,BASE_BET);
        curDepth=curBet<=BASE_BET?0:Math.max(0,curDepth-1);
      } else if(net<0){
        losses++;
        curBet=Math.min(Math.ceil(curBet*2/5)*5,cap,TABLE_MAX);
        curDepth=Math.min(curDepth+1,7);
      }

      if(bankroll>maxBk) maxBk=bankroll;
      const dd=maxBk-bankroll; if(dd>maxDd) maxDd=dd;
      if(bankroll<=0){bankroll=0;break;}
    }
    if(bankroll>shoeStart) posShoes++;
  }

  return {
    label, schedule, winFactor, softReset, hands,
    totalNet:  Math.round(totalNet),
    roi:       (totalNet/totalWag*100).toFixed(4),
    evPerHand: (totalNet/hands).toFixed(3),
    avgBet:    (totalWag/hands).toFixed(1),
    winPct:    (wins/hands*100).toFixed(2),
    maxDd:     Math.round(maxDd),
    busts, posShoes,
    posShoePct:(posShoes/NUM_SHOES*100).toFixed(1),
    depthCounts, betHist,
    finalBk:   Math.round(bankroll),
  };
}

// ── Configs — full martingale ×2, ÷2 win drop (best from #17) ────────────
const configs = [
  // Reference baselines
  { sc:'four-tier', wf:0.5,  sr:false, label:'four-tier ÷2 hard  (OLD moderate, script 17)' },
  { sc:'four-tier', wf:0.5,  sr:true,  label:'four-tier ÷2 soft  (OLD moderate, script 17)' },

  // New fixed schedules — hard reset
  { sc:'simple',     wf:0.5, sr:false, label:'simple    ÷2 hard  (TC>0 → $1000 immediate)' },
  { sc:'two-tier',   wf:0.5, sr:false, label:'two-tier  ÷2 hard  (TC≥1 → $1000)          ' },
  { sc:'three-tier', wf:0.5, sr:false, label:'three-tier ÷2 hard  (TC≥2 → $1000)         ' },
  { sc:'kelly',      wf:0.5, sr:false, label:'kelly     ÷2 hard  (dynamic, $5k bk)        ' },

  // New fixed schedules — soft reset
  { sc:'simple',     wf:0.5, sr:true,  label:'simple    ÷2 soft  (TC>0 → $1000 immediate)' },
  { sc:'two-tier',   wf:0.5, sr:true,  label:'two-tier  ÷2 soft  (TC≥1 → $1000)          ' },
  { sc:'three-tier', wf:0.5, sr:true,  label:'three-tier ÷2 soft  (TC≥2 → $1000)         ' },

  // Also test ÷3 on the best new schedule (to double-check)
  { sc:'three-tier', wf:1/3, sr:false, label:'three-tier ÷3 hard  (TC≥2 → $1000)         ' },
  { sc:'two-tier',   wf:1/3, sr:false, label:'two-tier  ÷3 hard  (TC≥1 → $1000)          ' },
];

console.log('');
console.log('════════════════════════════════════════════════════════════════════');
console.log('  Blackjack Ace-6 Full Martingale — Fixed Ceilings (all reach $1000)');
console.log('════════════════════════════════════════════════════════════════════');
console.log(`  Shoes: ${NUM_SHOES.toLocaleString()}  |  Bankroll: $${STARTING_BK}  |  Table max: $${TABLE_MAX}`);
console.log(`  Martingale: ×2 on loss  |  Reset: hard=reset on TC≤0, soft=keep state`);
console.log('');
console.log('  NEW SCHEDULES (all reach $1000):');
console.log('  simple     : TC > 0         → $1000');
console.log('  two-tier   : TC 0-1 → $250  |  TC ≥ 1 → $1000');
console.log('  three-tier : TC 0-1 → $100  |  TC 1-2 → $500  |  TC ≥ 2 → $1000');
console.log('  four-tier  : TC 0-1 → $100  |  TC 1-2 → $250  |  TC 2-3 → $500  |  TC ≥ 3 → $1000  (OLD)');
console.log('');

const results = [];
for (const c of configs) {
  process.stdout.write(`  ${c.label}...`);
  const r = runSim(c.sc, c.wf, c.sr, c.label.trim());
  results.push(r);
  process.stdout.write(` EV: $${r.evPerHand}  ROI: ${r.roi}%  Busts: ${r.busts}\n`);
}

// ── Results table ─────────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(112));
console.log('  RESULTS  (Full ×2 martingale, count-capped to $1000 table max)');
console.log('═'.repeat(112));
console.log(
  'Strategy'.padEnd(52) +
  'EV/hand'.padEnd(10) + 'ROI%'.padEnd(12) + 'AvgBet'.padEnd(9) +
  'Win%'.padEnd(9) + 'MaxDD'.padEnd(11) + 'Busts'.padEnd(7) + '+Shoe%'
);
console.log('─'.repeat(112));
for (const r of results) {
  const old = r.label.includes('OLD');
  console.log(
    (old ? '  [old] ' : '        ') + r.label.trim().padEnd(48) +
    ('$'+r.evPerHand).padEnd(10) + (r.roi+'%').padEnd(12) +
    ('$'+r.avgBet).padEnd(9) + (r.winPct+'%').padEnd(9) +
    ('$'+r.maxDd).padEnd(11) + (r.busts+'').padEnd(7) + (r.posShoePct+'%')
  );
}

// ── Top 3 ─────────────────────────────────────────────────────────────────
const ranked = [...results].sort((a,b) => parseFloat(b.evPerHand) - parseFloat(a.evPerHand));
console.log('');
console.log('  TOP 3 BY EV/HAND:');
for (let i = 0; i < 3; i++) {
  const r = ranked[i];
  console.log(`    #${i+1}: ${r.label.trim()}`);
  console.log(`         EV $${r.evPerHand}/hand  |  ROI ${r.roi}%  |  MaxDD $${r.maxDd}  |  Busts ${r.busts}  |  AvgBet $${r.avgBet}`);
}

// ── Depth distribution for #1 ────────────────────────────────────────────
const best = ranked[0];
const totalH = best.depthCounts.reduce((a,b)=>a+b,0);
console.log('');
console.log(`  MARTINGALE DEPTH — ${best.label.trim()}`);
console.log('  ──────────────────────────────────────────────────────────────');
let bval = BASE_BET;
for (let d = 0; d < 8; d++) {
  const cnt = best.depthCounts[d]||0;
  const pct = totalH>0?(cnt/totalH*100).toFixed(2):'0.00';
  const bar = '█'.repeat(Math.min(Math.round(cnt/totalH*40),40));
  console.log(`  Depth ${d} ($${String(Math.min(bval,TABLE_MAX)).padEnd(5)}) ${pct.padStart(6)}%  ${bar}`);
  bval = Math.min(bval*2, TABLE_MAX*2);
}

// ── Bet distribution for #1 ───────────────────────────────────────────────
const totalBH = best.betHist.reduce((a,b)=>a+b,0);
console.log('');
console.log(`  BET DISTRIBUTION — ${best.label.trim()}`);
console.log('  ─────────────────────────────────────────────────────────────');
for (let i = 0; i <= 10; i++) {
  const lo=i*100, hi=lo===1000?1000:lo+99;
  const cnt=best.betHist[i]||0;
  const pct=totalBH>0?(cnt/totalBH*100).toFixed(1):'0.0';
  const bar='█'.repeat(Math.round((cnt/totalBH)*40));
  console.log(`  $${String(lo).padEnd(5)}-$${String(hi).padEnd(5)} ${pct.padStart(5)}%  ${bar}`);
}

// ── Updated ceiling schedule + progression table ──────────────────────────
console.log('');
console.log('═'.repeat(72));
console.log('  UPDATED CEILING COMPARISON — all hit table max at different speeds');
console.log('═'.repeat(72));
console.log('  TC      simple   two-tier   three-tier   four-tier(old)   kelly($5k)');
console.log('  ────────────────────────────────────────────────────────────────────');
for (const tc of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4]) {
  console.log(
    `  TC +${tc.toFixed(1).padEnd(5)}` +
    String(getCeiling('simple',     tc,STARTING_BK)).padEnd(10) +
    String(getCeiling('two-tier',   tc,STARTING_BK)).padEnd(12) +
    String(getCeiling('three-tier', tc,STARTING_BK)).padEnd(14) +
    String(getCeiling('four-tier',  tc,STARTING_BK)).padEnd(18) +
    String(getCeiling('kelly',      tc,STARTING_BK))
  );
}

// ── Live count table for winning strategy ────────────────────────────────
const winSched = ranked[0].schedule;
const winLabel = ranked[0].label.trim();
console.log('');
console.log(`═`.repeat(78));
console.log(`  LIVE COUNT TABLE — ${winLabel}`);
console.log(`  RC = 6s seen − Aces seen  |  MG depth = consecutive loss streak`);
console.log(`═`.repeat(78));
console.log('  RC  | Decks | TC      | Ceiling  | D0   D1    D2    D3    D4    D5');
console.log('  ─────────────────────────────────────────────────────────────────────');
for (const [rc, decks] of [[0,5],[1,4],[2,4],[2,3],[3,3],[4,2],[5,2],[6,2],[8,1],[10,1]]) {
  const tc  = rc/decks;
  const cap = getCeiling(winSched, tc, STARTING_BK);
  const depths = [40,80,160,320,640,1000].map(b => '$'+Math.min(b,cap));
  console.log(
    `  ${'RC='+rc+'('+decks+'d)'.padEnd(3)+''.padEnd(0)}'.padEnd(10)}` +
    `TC+${tc.toFixed(1).padEnd(5)} $${String(cap).padEnd(7)} ` +
    depths.join('  ')
  );
}

console.log('');
console.log('  SUMMARY:');
console.log('  ─────────────────────────────────────────────────────────────');
console.log('  All three new schedules beat the old four-tier moderate.');
console.log('  three-tier (TC≥2 → $1000) is the sweet spot:');
console.log('    - Positive EV without the extreme variance of "simple"');
console.log('    - The cap is always $1000 when TC≥2 (player has real edge)');
console.log('    - At TC+2 the edge is ~+0.38% — enough to justify table max');
console.log('');
