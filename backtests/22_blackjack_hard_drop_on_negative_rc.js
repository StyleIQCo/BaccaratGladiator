'use strict';

// ════════════════════════════════════════════════════════════════════════
// Hard Drop on Negative RC — 8-deck, $10 min, Four-Tier ÷2
// ════════════════════════════════════════════════════════════════════════
//
// Tests three reset modes:
//
//  SOFT   — TC ≤ 0: bet $10, KEEP martingale state (original)
//
//  HYBRID — RC < 0 (more aces out than 6s): HARD reset to $10, clear depth
//           RC ≥ 0 but TC ≤ 0:              SOFT reset (keep state, bet $10)
//           TC > 0:                          normal martingale
//
//  HARD   — TC ≤ 0: reset to $10, clear depth every time
//
// All other params identical:
//   8 decks · $10 base · $1000 table max · 75% penetration
//   Four-tier ceiling: TC 0-1→$100, TC 1-2→$250, TC 2-3→$500, TC≥3→$1000
//   Win drop: ÷2 (floor $10)
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

function getCeiling(tc) {
  if (tc <= 0) return BASE_BET;
  if (tc < 1)  return  100;
  if (tc < 2)  return  250;
  if (tc < 3)  return  500;
  return TABLE_MAX;
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
// resetMode: 'soft' | 'hybrid' | 'hard'
function runSim(resetMode) {
  let bankroll=STARTING_BK,totalNet=0,totalWag=0;
  let hands=0,wins=0,losses=0,pushes=0;
  let maxBk=STARTING_BK,maxDd=0,busts=0,posShoes=0;
  let curBet=BASE_BET,curDepth=0;

  // Track when hard-drops occurred and what depth was abandoned
  let hardDrops=0, depthAtDrop=new Array(9).fill(0);
  // Track depth of chain when a WIN recovers it
  let depthAtWin=new Array(9).fill(0);

  const depthCounts=new Array(9).fill(0);
  const betHist=new Array(11).fill(0);
  const shoePLbuckets=new Array(21).fill(0);

  for(let shoeN=0;shoeN<NUM_SHOES;shoeN++){
    if(bankroll<=0){bankroll=STARTING_BK;busts++;}
    const shoe=buildShoe(); let idx=0,rc=0;
    const shoeStart=bankroll;

    while(idx<shoe.length-RESHUFFLE_AT){
      const decksLeft=(shoe.length-idx)/52;
      const tc=decksLeft>0.1?rc/decksLeft:0;
      const cap=getCeiling(tc);

      let bet;

      if(resetMode==='hard'){
        if(tc<=0){curBet=BASE_BET;curDepth=0;}
        bet=tc<=0?BASE_BET:Math.min(curBet,cap,TABLE_MAX,bankroll);
      } else if(resetMode==='soft'){
        bet=tc<=0?BASE_BET:Math.min(curBet,cap,TABLE_MAX,bankroll);
      } else {
        // hybrid: hard drop only when RC goes negative
        if(rc<0){
          if(curDepth>0){hardDrops++;depthAtDrop[Math.min(curDepth,8)]++;}
          curBet=BASE_BET;curDepth=0;
        }
        bet=tc<=0?BASE_BET:Math.min(curBet,cap,TABLE_MAX,bankroll);
      }

      bet=Math.max(Math.round(bet/5)*5,BASE_BET);
      if(bet>bankroll) bet=bankroll;
      if(bet<=0) break;

      betHist[Math.min(Math.floor(bet/100),10)]++;
      depthCounts[Math.min(curDepth,8)]++;

      const r=simHand(shoe,idx,bet);
      idx=r.newIdx; rc+=r.rcDelta;

      const net=r.net;
      bankroll+=net; totalNet+=net; totalWag+=r.wagered; hands++;

      if(net>0){
        wins++;
        if(curDepth>0) depthAtWin[Math.min(curDepth,8)]++;
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
    resetMode, hands,
    totalNet:  Math.round(totalNet),
    roi:       (totalNet/totalWag*100).toFixed(4),
    evPerHand: (totalNet/hands).toFixed(4),
    avgBet:    (totalWag/hands).toFixed(2),
    winPct:    (wins/hands*100).toFixed(2),
    maxDd:     Math.round(maxDd),
    busts,
    bustRate:  Math.round(NUM_SHOES/Math.max(busts,1)),
    posShoePct:(posShoes/NUM_SHOES*100).toFixed(1),
    sessionEV: (totalNet/NUM_SHOES).toFixed(2),
    hardDrops,
    depthAtDrop, depthAtWin,
    depthCounts, betHist, shoePLbuckets,
    finalBk:   Math.round(bankroll),
  };
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Hard Drop on Negative RC  —  8-deck · $10 min · Four-Tier ÷2');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes: ${NUM_SHOES.toLocaleString()}   |   Bankroll: $${STARTING_BK}   |   Table max: $${TABLE_MAX}`);
console.log('');
console.log('  RESET MODES:');
console.log('  soft   — TC ≤ 0: bet $10, keep martingale depth (original)');
console.log('  hybrid — RC < 0: hard-reset depth  |  RC ≥ 0 & TC ≤ 0: keep depth');
console.log('  hard   — TC ≤ 0: always hard-reset depth to $10');
console.log('');

const modes = ['soft','hybrid','hard'];
const results = {};
for(const m of modes){
  process.stdout.write(`  Running ${m.padEnd(8)}...`);
  results[m] = runSim(m);
  const r = results[m];
  process.stdout.write(` EV: $${r.evPerHand}/hand  ROI: ${r.roi}%  Busts: ${r.busts}  +Shoe: ${r.posShoePct}%\n`);
}

// ── Comparison table ──────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(90));
console.log('  SIDE-BY-SIDE COMPARISON');
console.log('═'.repeat(90));
const metrics = [
  ['EV per hand',        r => '$'+r.evPerHand],
  ['ROI',                r => r.roi+'%'],
  ['Avg bet',            r => '$'+r.avgBet],
  ['Win%',               r => r.winPct+'%'],
  ['Max drawdown',       r => '$'+r.maxDd.toLocaleString()],
  ['Busts',              r => r.busts+' (1 in '+r.bustRate+' shoes)'],
  ['Win shoe %',         r => r.posShoePct+'%'],
  ['Session EV (1 shoe)',r => '$'+r.sessionEV],
  ['Session EV (6 shoe)',r => '$'+(parseFloat(r.sessionEV)*6).toFixed(2)],
  ['Hard drops',         r => r.resetMode==='hybrid'?r.hardDrops.toLocaleString():'N/A'],
];
console.log('  Metric'.padEnd(28) + 'SOFT'.padEnd(30) + 'HYBRID'.padEnd(30) + 'HARD');
console.log('  ' + '─'.repeat(88));
for(const [label, fn] of metrics){
  console.log(
    '  ' + label.padEnd(26) +
    fn(results.soft).padEnd(30) +
    fn(results.hybrid).padEnd(30) +
    fn(results.hard)
  );
}

// ── How often hybrid drops, and at what depth ────────────────────────────
const h = results.hybrid;
console.log('');
console.log('  HYBRID: HARD-DROP EVENTS (RC flips negative while in a streak)');
console.log(`  Total hard-drops: ${h.hardDrops.toLocaleString()} across ${NUM_SHOES.toLocaleString()} shoes`);
console.log(`  Avg drops per shoe: ${(h.hardDrops/NUM_SHOES).toFixed(2)}`);
console.log('');
console.log('  Depth at which drop occurred   →   Loss abandoned (unrecovered)');
console.log('  ─────────────────────────────────────────────────────────────────');
let bval=BASE_BET;
for(let d=1;d<=8;d++){
  const cnt=h.depthAtDrop[d]||0;
  if(!cnt) continue;
  const lostSoFar=BASE_BET*(Math.pow(2,d)-1);
  const pct=(cnt/h.hardDrops*100).toFixed(1);
  const bar='█'.repeat(Math.round(cnt/h.hardDrops*30));
  console.log(
    `  Depth ${d} (next bet would be $${Math.min(bval*2,TABLE_MAX).toString().padEnd(5)})  `+
    `${cnt.toLocaleString().padStart(8)} drops  ${pct.padStart(5)}%   `+
    `$${lostSoFar.toLocaleString()} in chain  ${bar}`
  );
  bval=Math.min(bval*2,TABLE_MAX);
}

// ── Martingale depth distribution comparison ─────────────────────────────
console.log('');
console.log('  MARTINGALE DEPTH DISTRIBUTION COMPARISON');
console.log('  Depth = consecutive losses in current active streak');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
console.log('  Depth  Bet    SOFT%     HYBRID%   HARD%');
console.log('  ──────────────────────────────────────────────────────');
let bv=BASE_BET;
for(let d=0;d<=8;d++){
  const ts=results.soft.depthCounts.reduce((a,b)=>a+b,0);
  const th=results.hybrid.depthCounts.reduce((a,b)=>a+b,0);
  const th2=results.hard.depthCounts.reduce((a,b)=>a+b,0);
  const ps=(results.soft.depthCounts[d]/ts*100).toFixed(2);
  const ph=(results.hybrid.depthCounts[d]/th*100).toFixed(2);
  const ph2=(results.hard.depthCounts[d]/th2*100).toFixed(2);
  console.log(
    `  Depth ${d}  $${String(Math.min(bv,TABLE_MAX)).padEnd(5)}  ${ps.padStart(6)}%    ${ph.padStart(6)}%    ${ph2.padStart(6)}%`
  );
  bv=Math.min(bv*2,TABLE_MAX*2);
}

// ── Per-shoe P/L comparison ───────────────────────────────────────────────
console.log('');
console.log('  PER-SHOE P/L COMPARISON  (one ~72-hand session)');
console.log('  ──────────────────────────────────────────────────────────────────────────');
console.log('  Result          SOFT%     HYBRID%   HARD%');
console.log('  ──────────────────────────────────────────────────────────────────────────');
const labels=['< -$900','-$800','-$700','-$600','-$500','-$400','-$300','-$200','-$100',
  'break-even','+$0-100','+$100','+$200','+$300','+$400','+$500','+$600','+$700','+$800','+$900','> +$900'];
for(let i=0;i<21;i++){
  const ts=NUM_SHOES,th=NUM_SHOES,th2=NUM_SHOES;
  const ps=(results.soft.shoePLbuckets[i]/ts*100).toFixed(1);
  const ph=(results.hybrid.shoePLbuckets[i]/th*100).toFixed(1);
  const ph2=(results.hard.shoePLbuckets[i]/th2*100).toFixed(1);
  if(parseFloat(ps)>0.2||parseFloat(ph)>0.2||parseFloat(ph2)>0.2){
    console.log(
      `  ${labels[i].padEnd(16)} ${ps.padStart(6)}%    ${ph.padStart(6)}%    ${ph2.padStart(6)}%`
    );
  }
}

// ── Practical guide for hybrid ─────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  HYBRID STRATEGY — WHAT TO DO AT THE TABLE');
console.log('════════════════════════════════════════════════════════════════');
console.log('');
console.log('  TRACK: running count = (6s seen) − (Aces seen)');
console.log('');
console.log('  RULE 1 — BET SIZE:');
console.log('    RC < 0  → DROP to $10, CLEAR depth counter (hard reset)');
console.log('    RC = 0  → stay at $10, KEEP depth counter (soft hold)');
console.log('    TC > 0  → use ceiling table below, continue martingale');
console.log('');
console.log('  RULE 2 — AFTER LOSS:  double bet, cap at ceiling');
console.log('  RULE 3 — AFTER WIN:   halve bet, floor at $10');
console.log('');
console.log('  CEILING (max bet at each true count):');
console.log('    TC 0-1  → $100   TC 1-2 → $250   TC 2-3 → $500   TC ≥ 3 → $1000');
console.log('');
console.log('  TRUE COUNT = RC / decks remaining');
console.log('');
console.log('  QUICK BET TABLE (what to bet at depth D after N losses in a row):');
console.log('  ─────────────────────────────────────────────────────────────────────────');
console.log('  RC  Decks  TC     Ceiling   D0    D1    D2    D3    D4    D5    D6    D7');
console.log('  ─────────────────────────────────────────────────────────────────────────');
const situations=[
  {label:'RC<0  (any)',   rc:-1, d:5},
  {label:'RC=0  (any)',   rc:0,  d:5},
  {label:'RC=2  5d',      rc:2,  d:5},
  {label:'RC=4  5d',      rc:4,  d:5},
  {label:'RC=5  5d',      rc:5,  d:5},
  {label:'RC=4  4d',      rc:4,  d:4},
  {label:'RC=5  4d',      rc:5,  d:4},
  {label:'RC=8  8d',      rc:8,  d:8},
  {label:'RC=5  3d',      rc:5,  d:3},
  {label:'RC=6  3d',      rc:6,  d:3},
  {label:'RC=8  3d',      rc:8,  d:3},
  {label:'RC=6  2d',      rc:6,  d:2},
  {label:'RC=8  2d',      rc:8,  d:2},
  {label:'RC=10 2d',      rc:10, d:2},
  {label:'RC=6  1d',      rc:6,  d:1},
];
for(const s of situations){
  const tc=s.rc<0?-1:s.rc/s.d;
  const cap=getCeiling(tc);
  const bets=[10,20,40,80,160,320,640,1000]
    .map(b=>'$'+String(Math.min(b,cap)).padEnd(5));
  const resetNote=s.rc<0?' ← HARD RESET':s.rc===0?' ← hold state':'';
  console.log(
    `  ${s.label.padEnd(12)} ${String(s.d+'d').padEnd(4)} TC${tc<0?'<0':'+'+tc.toFixed(1)}`
      .padEnd(32)+
    `$${String(cap).padEnd(6)}  ${bets.slice(0,8).join(' ')}${resetNote}`
  );
}

console.log('');
