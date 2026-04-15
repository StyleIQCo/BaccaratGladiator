'use strict';

// ════════════════════════════════════════════════════════════════════════
// RC Jump Optimization  —  8-deck, $10 min, Hard+Step reset
// ════════════════════════════════════════════════════════════════════════
//
// Script 24 showed rc_jump (RC 1-5→$100, RC 6-9→$500, RC≥10→$1000)
// outperformed gradual/linear RC schedules. This script finds the optimal
// jump breakpoints by sweeping first-jump threshold (RC 3–7) and
// second-jump threshold, plus tests a 3-tier version with a $250 mid step.
//
// Schedules:
//   flat_100    — flat $100 ceiling whenever RC>0 (baseline: how much does
//                 raising the ceiling above $100 actually help?)
//   jump_3      — RC 1-2→$100, RC 3-5→$500, RC≥6→$1000
//   jump_4      — RC 1-3→$100, RC 4-7→$500, RC≥8→$1000
//   jump_5      — RC 1-4→$100, RC 5-8→$500, RC≥9→$1000
//   jump_6      — RC 1-5→$100, RC 6-9→$500, RC≥10→$1000  (script 24 rc_jump)
//   jump_7      — RC 1-6→$100, RC 7-10→$500, RC≥11→$1000
//   jump3tier_5 — RC 1-4→$100, RC 5-7→$300, RC 8-10→$600, RC≥11→$1000
//   jump3tier_6 — RC 1-5→$100, RC 6-8→$350, RC 9-11→$700, RC≥12→$1000
//   twostep     — RC 1-5→$100, RC≥6→$1000 (skip the $500 tier entirely)
//
// 500,000 shoes for tighter confidence intervals (~0.02/hand std error)
// ════════════════════════════════════════════════════════════════════════

const DECKS        = 8;
const BASE_BET     = 10;
const TABLE_MAX    = 1000;
const STARTING_BK  = 5000;
const NUM_SHOES    = 500000;
const RESHUFFLE_AT = 104;

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

function getCeiling(rc, schedule) {
  if (rc <= 0) return BASE_BET;
  switch(schedule) {
    case 'flat_100':    return 100;
    case 'jump_3':      return rc<=2?100:rc<=5?500:TABLE_MAX;
    case 'jump_4':      return rc<=3?100:rc<=7?500:TABLE_MAX;
    case 'jump_5':      return rc<=4?100:rc<=8?500:TABLE_MAX;
    case 'jump_6':      return rc<=5?100:rc<=9?500:TABLE_MAX;
    case 'jump_7':      return rc<=6?100:rc<=10?500:TABLE_MAX;
    case 'jump3tier_5': return rc<=4?100:rc<=7?300:rc<=10?600:TABLE_MAX;
    case 'jump3tier_6': return rc<=5?100:rc<=8?350:rc<=11?700:TABLE_MAX;
    case 'twostep':     return rc<=5?100:TABLE_MAX;
    default:            return TABLE_MAX;
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

function runSim(schedule) {
  let bankroll=STARTING_BK,totalNet=0,totalWag=0;
  let hands=0,wins=0,losses=0,pushes=0;
  let maxBk=STARTING_BK,maxDd=0,busts=0,posShoes=0;
  let curBet=BASE_BET,curDepth=0;

  const shoePLbuckets=new Array(21).fill(0);

  for(let shoeN=0;shoeN<NUM_SHOES;shoeN++){
    if(bankroll<=0){bankroll=STARTING_BK;busts++;}
    const shoe=buildShoe(); let idx=0,rc=0;
    const shoeStart=bankroll;

    while(idx<shoe.length-RESHUFFLE_AT){
      const decksLeft=(shoe.length-idx)/52;
      const tc=decksLeft>0.1?rc/decksLeft:0;
      const cap=getCeiling(rc, schedule);

      if (tc <= 0) { curBet=BASE_BET; curDepth=0; }
      if (curBet > cap) { curBet=BASE_BET; curDepth=0; }

      let bet = tc<=0 ? BASE_BET : Math.min(curBet,cap,TABLE_MAX,bankroll);
      bet = Math.max(Math.round(bet/5)*5, BASE_BET);
      if (bet > bankroll) bet = bankroll;
      if (bet <= 0) break;

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
    totalNet:   Math.round(totalNet),
    roi:        (totalNet/totalWag*100).toFixed(4),
    evPerHand:  (totalNet/hands).toFixed(4),
    avgBet:     (totalWag/hands).toFixed(2),
    winPct:     (wins/hands*100).toFixed(2),
    maxDd:      Math.round(maxDd),
    busts,
    bustRate:   Math.round(NUM_SHOES/Math.max(busts,1)),
    posShoePct: (posShoes/NUM_SHOES*100).toFixed(1),
    sessionEV:  (totalNet/NUM_SHOES).toFixed(2),
    shoePLbuckets,
  };
}

// ── Run ───────────────────────────────────────────────────────────────────
const schedules = ['flat_100','jump_3','jump_4','jump_5','jump_6','jump_7','jump3tier_5','jump3tier_6','twostep'];

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  RC Jump Optimization  —  8-deck · $10 min · Hard+Step');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes: ${NUM_SHOES.toLocaleString()}   |   Bankroll: $${STARTING_BK}   |   Table max: $${TABLE_MAX}`);
console.log('');

const results = {};
for(const s of schedules){
  process.stdout.write(`  Running ${s.padEnd(16)}...`);
  results[s] = runSim(s);
  const r = results[s];
  process.stdout.write(` EV: $${r.evPerHand}/hand  ROI: ${r.roi}%  Busts: ${r.busts}  +Shoe: ${r.posShoePct}%\n`);
}

// ── Ranked comparison ─────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(80));
console.log('  RANKED BY EV  (500k shoes, std error ≈ ±$0.02/hand)');
console.log('═'.repeat(80));
const ranked = [...schedules].sort((a,b)=>parseFloat(results[b].evPerHand)-parseFloat(results[a].evPerHand));
console.log('  Rank  Schedule         EV/hand     ROI        Avg bet  Busts       +Shoe%');
console.log('  ' + '─'.repeat(78));
ranked.forEach((s,i)=>{
  const r=results[s];
  console.log(
    `  ${String(i+1).padStart(2)}.   ${s.padEnd(16)} $${r.evPerHand.padStart(8)}   ${r.roi.padStart(8)}%  `+
    `$${r.avgBet.padStart(6)}   ${String(r.busts).padStart(3)} (1:${String(r.bustRate).padStart(6)})   ${r.posShoePct}%`
  );
});

// ── Ceiling schedule table ────────────────────────────────────────────────
console.log('');
console.log('  CEILING SCHEDULES (what max bet does each RC level give you?)');
console.log('  ─────────────────────────────────────────────────────────────────────────────────────');
const W2=14;
console.log('  RC   '+schedules.map(s=>s.padEnd(W2)).join(''));
console.log('  '+'-'.repeat(5+schedules.length*W2));
for(let rc=0; rc<=14; rc++){
  const caps=schedules.map(s=>'$'+getCeiling(rc,s));
  console.log(`  RC${String(rc).padStart(2)} `+caps.map(c=>c.padEnd(W2)).join(''));
}

// ── Per-shoe P/L for top 3 ────────────────────────────────────────────────
const top3 = ranked.slice(0,3);
console.log('');
console.log(`  PER-SHOE P/L — TOP 3: ${top3.join(', ')}`);
console.log('  ──────────────────────────────────────────────────────────────────────────');
console.log('  Result          '+top3.map(s=>s.padEnd(18)).join(''));
console.log('  ──────────────────────────────────────────────────────────────────────────');
const labels=['< -$900','-$800','-$700','-$600','-$500','-$400','-$300','-$200','-$100',
  'break-even','+$0-100','+$100','+$200','+$300','+$400','+$500','+$600','+$700','+$800','+$900','> +$900'];
for(let i=0;i<21;i++){
  const pcts=top3.map(s=>(results[s].shoePLbuckets[i]/NUM_SHOES*100).toFixed(1)+'%');
  if(pcts.some(p=>parseFloat(p)>0.2)){
    console.log(`  ${labels[i].padEnd(16)}`+pcts.map(p=>p.padEnd(18)).join(''));
  }
}

// ── Quick reference for top schedule ──────────────────────────────────────
const winner = ranked[0];
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  WINNER: ${winner.toUpperCase()}`);
console.log('  COMPLETE BET TABLE — WHAT TO DO AT THE TABLE');
console.log('════════════════════════════════════════════════════════════════');
console.log('');
console.log('  TRACK: RC = (sixes seen) − (aces seen)');
console.log('  RESET: if RC ≤ 0 → drop to $10, clear streak depth');
console.log('  STEP:  if RC drops a tier and your bet > new ceiling → drop to $10');
console.log('');
console.log('  CEILING:');
for(let rc=0; rc<=14; rc++){
  const cap=getCeiling(rc,winner);
  const prev=rc>0?getCeiling(rc-1,winner):0;
  const marker=cap>prev&&rc>0?' ← jump':'';
  console.log(`    RC = ${String(rc).padStart(2)} → $${cap}${marker}`);
}
console.log(`    RC ≥ 15 → $1000`);
console.log('');
console.log('  BET AT DEPTH D (consecutive losses in active streak):');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
console.log('  RC   Ceiling   D0    D1    D2    D3    D4    D5    D6    D7');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
for(let rc=0; rc<=13; rc++){
  const cap=getCeiling(rc,winner);
  const depths=[10,20,40,80,160,320,640,1000].map(b=>'$'+String(Math.min(b,cap)).padEnd(5));
  const note=rc===0?' ← reset':'';
  console.log(`  RC${String(rc).padStart(2)}  $${String(cap).padEnd(6)}  ${depths.join(' ')}${note}`);
}
console.log('');
console.log(`  SESSION STATS (6 shoes):  EV ${results[winner].sessionEV}/shoe  →  `+
  `${'$'+(parseFloat(results[winner].sessionEV)*6).toFixed(2)} per session`);
console.log(`  Bust risk: 1 in ${results[winner].bustRate} shoes`);
console.log('');
