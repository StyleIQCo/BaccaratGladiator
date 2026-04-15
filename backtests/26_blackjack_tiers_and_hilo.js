'use strict';

// ════════════════════════════════════════════════════════════════════════
// Extra Tiers + Hi-Lo Count  —  8-deck, $10 min, Hard+Step reset
// ════════════════════════════════════════════════════════════════════════
//
// Two questions:
//
// Q1: Is adding a tier inside jump_4's gaps beneficial?
//   jump_4 baseline: RC 1-3→$100, RC 4-7→$500, RC≥8→$1000
//   jump_4_mid:      RC 1-3→$100, RC 4-5→$250, RC 6-7→$500, RC≥8→$1000
//   jump_4_top:      RC 1-3→$100, RC 4-7→$500, RC 8-10→$750, RC≥11→$1000
//   jump_4_both:     RC 1-3→$100, RC 4-5→$250, RC 6-7→$500, RC 8-10→$750, RC≥11→$1000
//
// Q2: Does tracking 10s + 5s (Hi-Lo) beat tracking only Aces + 6s?
//   Count systems:
//   ace6  — 6=+1, A=-1               (current, 8 tags per deck)
//   ace56 — 5=+1, 6=+1, A=-1         (10 tags, adds 5s)
//   hilo  — 2,3,4,5,6=+1, T,A=-1     (full Hi-Lo, 20 tags per deck)
//
//   For Hi-Lo: max RC = ±160 (8 decks × 20 tags each side)
//   Tier breakpoints scaled to equivalent TC thresholds:
//     hilo_jump4: same TC thresholds as jump_4 but expressed in Hi-Lo RC
//     At 4 decks remaining: RC 1-11→$100, RC 12-28→$500, RC≥29→$1000
//     (RC/4 = TC; TC<1→$100, TC 1-2→$500, TC≥2→$1000 maps to RC<4, 4-8, 8+
//      but Hi-Lo has 5x more tags per card so scales by 5: RC<20, 20-40, 40+
//      using conservative scale; calibrated to TC=1 and TC=2 breakpoints)
//
//   ace6 edge per TC unit ≈ 0.44%/TC (well-established)
//   hilo edge per TC unit ≈ 0.50%/TC (higher correlation = more reliable)
//
// All use Hard+Step reset. 500,000 shoes.
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

// Count delta functions
function a6delta(r)   { return r==='6'?1:r==='A'?-1:0; }
function a56delta(r)  { return (r==='5'||r==='6')?1:r==='A'?-1:0; }
// Hi-Lo: 2,3,4,5,6 = +1; T,A = -1; 7,8,9 = 0
function hilodelta(r) { return (r==='2'||r==='3'||r==='4'||r==='5'||r==='6')?1:(r==='T'||r==='A')?-1:0; }

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

// ── Ceiling functions ──────────────────────────────────────────────────────

// Q1: extra tier variants — all RC-based (ace-6 count, max RC ±32)
function getTierCeiling(rc, variant) {
  if (rc <= 0) return BASE_BET;
  switch(variant) {
    case 'jump_4':      // baseline from script 25
      return rc<=3?100:rc<=7?500:TABLE_MAX;
    case 'jump_4_mid':  // add $250 tier between $100 and $500
      return rc<=3?100:rc<=5?250:rc<=7?500:TABLE_MAX;
    case 'jump_4_top':  // add $750 tier between $500 and $1000
      return rc<=3?100:rc<=7?500:rc<=10?750:TABLE_MAX;
    case 'jump_4_both': // both extra tiers
      return rc<=3?100:rc<=5?250:rc<=7?500:rc<=10?750:TABLE_MAX;
    default: return TABLE_MAX;
  }
}

// Q2: Hi-Lo ceiling — RC thresholds scaled for Hi-Lo's larger range
// Hi-Lo: 8 decks × 4 suits × (5 low ranks + 5 high ranks) = 20 tags per deck
// ace-6: 8 decks × 4 suits × (1 six + 1 ace) = 8 tags per deck
// Ratio ≈ 2.5x. Same TC equivalent = 2.5x higher Hi-Lo RC.
// jump_4 breakpoints at RC 4,8 → Hi-Lo equivalents at RC ~10,20
// We test two calibrations around those breakpoints.
function getHiloCeiling(rc, variant) {
  if (rc <= 0) return BASE_BET;
  switch(variant) {
    case 'hilo_tight':   // conservative: RC 1-8→$100, RC 9-19→$500, RC≥20→$1000
      return rc<=8?100:rc<=19?500:TABLE_MAX;
    case 'hilo_loose':   // aggressive: RC 1-6→$100, RC 7-14→$500, RC≥15→$1000
      return rc<=6?100:rc<=14?500:TABLE_MAX;
    case 'hilo_mid':     // middle: RC 1-7→$100, RC 8-16→$500, RC≥17→$1000
      return rc<=7?100:rc<=16?500:TABLE_MAX;
    // ace-56 (5s+6s vs aces): max RC ±24 (8 decks × 4 suits × 3 tags/deck)
    case 'ace56_tight':  // RC 1-5→$100, RC 6-11→$500, RC≥12→$1000
      return rc<=5?100:rc<=11?500:TABLE_MAX;
    case 'ace56_loose':  // RC 1-4→$100, RC 5-9→$500, RC≥10→$1000
      return rc<=4?100:rc<=9?500:TABLE_MAX;
    default: return TABLE_MAX;
  }
}

function simHand(shoe, idx0, bet, countFn) {
  let idx=idx0,rcDelta=0,totalWagered=bet;
  function deal(){const r=shoe[idx++];rcDelta+=countFn(r);return r;}
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
  rcDelta+=countFn(dealerHole);
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
function runSim(label, ceilFn, countFn) {
  let bankroll=STARTING_BK,totalNet=0,totalWag=0;
  let hands=0,wins=0,busts=0,posShoes=0;
  let maxBk=STARTING_BK,maxDd=0;
  let curBet=BASE_BET,curDepth=0;
  const shoePLbuckets=new Array(21).fill(0);

  for(let shoeN=0;shoeN<NUM_SHOES;shoeN++){
    if(bankroll<=0){bankroll=STARTING_BK;busts++;}
    const shoe=buildShoe(); let idx=0,rc=0;
    const shoeStart=bankroll;

    while(idx<shoe.length-RESHUFFLE_AT){
      const decksLeft=(shoe.length-idx)/52;
      const tc=decksLeft>0.1?rc/decksLeft:0;
      const cap=ceilFn(rc);

      if (tc<=0){ curBet=BASE_BET; curDepth=0; }
      if (curBet>cap){ curBet=BASE_BET; curDepth=0; }

      let bet=tc<=0?BASE_BET:Math.min(curBet,cap,TABLE_MAX,bankroll);
      bet=Math.max(Math.round(bet/5)*5,BASE_BET);
      if(bet>bankroll) bet=bankroll;
      if(bet<=0) break;

      const r=simHand(shoe,idx,bet,countFn);
      idx=r.newIdx; rc+=r.rcDelta;

      const net=r.net;
      bankroll+=net; totalNet+=net; totalWag+=r.wagered; hands++;

      if(net>0){
        wins++;
        curBet=Math.max(Math.round(curBet*0.5/5)*5,BASE_BET);
        curDepth=curBet<=BASE_BET?0:Math.max(0,curDepth-1);
      } else if(net<0){
        curBet=Math.min(Math.ceil(curBet*2/5)*5,cap,TABLE_MAX);
        curDepth=Math.min(curDepth+1,8);
      }

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
    label, hands,
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

// ── Run all configs ────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Extra Tiers + Hi-Lo Count  —  8-deck · $10 min · Hard+Step');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes: ${NUM_SHOES.toLocaleString()}   |   Bankroll: $${STARTING_BK}   |   Table max: $${TABLE_MAX}`);
console.log('');

const configs = [
  // Q1: tier variants (ace-6 count)
  { label:'jump_4',       ceilFn: rc=>getTierCeiling(rc,'jump_4'),      countFn: a6delta,   group:'Q1-tiers' },
  { label:'jump_4_mid',   ceilFn: rc=>getTierCeiling(rc,'jump_4_mid'),  countFn: a6delta,   group:'Q1-tiers' },
  { label:'jump_4_top',   ceilFn: rc=>getTierCeiling(rc,'jump_4_top'),  countFn: a6delta,   group:'Q1-tiers' },
  { label:'jump_4_both',  ceilFn: rc=>getTierCeiling(rc,'jump_4_both'), countFn: a6delta,   group:'Q1-tiers' },
  // Q2: count systems (jump_4-equivalent breakpoints)
  { label:'ace56_loose',  ceilFn: rc=>getHiloCeiling(rc,'ace56_loose'), countFn: a56delta,  group:'Q2-counts' },
  { label:'ace56_tight',  ceilFn: rc=>getHiloCeiling(rc,'ace56_tight'), countFn: a56delta,  group:'Q2-counts' },
  { label:'hilo_loose',   ceilFn: rc=>getHiloCeiling(rc,'hilo_loose'),  countFn: hilodelta, group:'Q2-counts' },
  { label:'hilo_mid',     ceilFn: rc=>getHiloCeiling(rc,'hilo_mid'),    countFn: hilodelta, group:'Q2-counts' },
  { label:'hilo_tight',   ceilFn: rc=>getHiloCeiling(rc,'hilo_tight'),  countFn: hilodelta, group:'Q2-counts' },
];

const results = {};
for(const c of configs){
  process.stdout.write(`  Running ${c.label.padEnd(16)}...`);
  results[c.label] = runSim(c.label, c.ceilFn, c.countFn);
  const r = results[c.label];
  process.stdout.write(` EV: $${r.evPerHand}/hand  ROI: ${r.roi}%  Busts: ${r.busts}  +Shoe: ${r.posShoePct}%\n`);
}

// ── Q1: Tier comparison ───────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(90));
console.log('  Q1: EXTRA TIERS  (ace-6 count, same hard+step reset)');
console.log('═'.repeat(90));
const q1 = configs.filter(c=>c.group==='Q1-tiers').map(c=>c.label);
console.log('  Metric'.padEnd(28)+q1.map(l=>l.padEnd(20)).join(''));
console.log('  '+'-'.repeat(88));
const metrics = [
  ['EV per hand',         r=>'$'+r.evPerHand],
  ['ROI',                 r=>r.roi+'%'],
  ['Avg bet',             r=>'$'+r.avgBet],
  ['Busts',               r=>r.busts+' (1:'+r.bustRate+')'],
  ['Win shoe %',          r=>r.posShoePct+'%'],
  ['Session EV (6 shoe)', r=>'$'+(parseFloat(r.sessionEV)*6).toFixed(2)],
];
for(const[label,fn] of metrics){
  console.log('  '+label.padEnd(26)+q1.map(l=>fn(results[l]).padEnd(20)).join(''));
}

console.log('');
console.log('  CEILING SCHEDULE (ace-6 RC):');
console.log('  RC  '+q1.map(l=>l.padEnd(20)).join(''));
for(let rc=0;rc<=12;rc++){
  const caps=q1.map(l=>'$'+getTierCeiling(rc,l));
  console.log(`  RC${String(rc).padStart(2)} `+caps.map(c=>c.padEnd(20)).join(''));
}

// ── Q2: Count system comparison ───────────────────────────────────────────
console.log('');
console.log('═'.repeat(90));
console.log('  Q2: COUNT SYSTEMS  (jump_4-equivalent thresholds, same reset)');
console.log('═'.repeat(90));
console.log('  ace-6:  tracks 6s and Aces only (8 tags/deck × 8 decks = ±64 max RC)');
console.log('  ace-56: tracks 5s, 6s, and Aces (10 tags/deck, ±80 max RC)');
console.log('  Hi-Lo:  tracks 2-6 vs T,A       (20 tags/deck, ±160 max RC)');
console.log('');
console.log('  jump_4 baseline (ace-6): RC 1-3→$100, RC 4-7→$500, RC≥8→$1000');
console.log('  ace56 thresholds scaled by 10/8 = 1.25×');
console.log('  Hi-Lo thresholds scaled by 20/8 = 2.5×');
console.log('');

const q2 = ['jump_4', ...configs.filter(c=>c.group==='Q2-counts').map(c=>c.label)];
console.log('  Metric'.padEnd(28)+q2.map(l=>l.padEnd(18)).join(''));
console.log('  '+'-'.repeat(88));
for(const[label,fn] of metrics){
  console.log('  '+label.padEnd(26)+q2.map(l=>fn(results[l]).padEnd(18)).join(''));
}

// ── Best of each group ────────────────────────────────────────────────────
const bestQ1=q1.reduce((a,b)=>parseFloat(results[a].evPerHand)>=parseFloat(results[b].evPerHand)?a:b);
const q2labels=configs.filter(c=>c.group==='Q2-counts').map(c=>c.label);
const bestQ2=q2labels.reduce((a,b)=>parseFloat(results[a].evPerHand)>=parseFloat(results[b].evPerHand)?a:b);

console.log('');
console.log('  RC BREAKPOINTS IN USE (at-a-glance):');
console.log('  ─────────────────────────────────────────────────────────────────────');
console.log('  Label         Count   RC→$100  RC→$500  RC→$1000  Ceiling scale');
console.log('  ─────────────────────────────────────────────────────────────────────');
const breakInfo=[
  ['jump_4',      'ace-6', '1-3',  '4-7',  '≥8',    '±64 max RC'],
  ['jump_4_mid',  'ace-6', '1-3',  '6-7',  '≥8',    '±64 max RC'],
  ['jump_4_top',  'ace-6', '1-3',  '4-7',  '≥11',   '±64 max RC'],
  ['jump_4_both', 'ace-6', '1-3',  '6-7',  '≥11',   '±64 max RC'],
  ['ace56_loose', 'ace-56','1-4',  '5-9',  '≥10',   '±80 max RC'],
  ['ace56_tight', 'ace-56','1-5',  '6-11', '≥12',   '±80 max RC'],
  ['hilo_loose',  'Hi-Lo', '1-6',  '7-14', '≥15',   '±160 max RC'],
  ['hilo_mid',    'Hi-Lo', '1-7',  '8-16', '≥17',   '±160 max RC'],
  ['hilo_tight',  'Hi-Lo', '1-8',  '9-19', '≥20',   '±160 max RC'],
];
for(const[lbl,cnt,r1,r5,r10,scale] of breakInfo){
  const evStr=results[lbl]?('EV $'+results[lbl].evPerHand):'';
  console.log(`  ${lbl.padEnd(14)}${cnt.padEnd(8)}${r1.padEnd(9)}${r5.padEnd(9)}${r10.padEnd(10)}${scale.padEnd(14)} ${evStr}`);
}

console.log('');
console.log('═'.repeat(70));
console.log('  SUMMARY');
console.log('═'.repeat(70));
console.log(`  Best tier variant: ${bestQ1}  (EV $${results[bestQ1].evPerHand}/hand)`);
console.log(`  Best count system: ${bestQ2}  (EV $${results[bestQ2].evPerHand}/hand)`);
console.log(`  Ace-6 jump_4 baseline:         EV $${results['jump_4'].evPerHand}/hand`);
const hiloGain=(parseFloat(results[bestQ2].evPerHand)-parseFloat(results['jump_4'].evPerHand)).toFixed(4);
const tierGain=(parseFloat(results[bestQ1].evPerHand)-parseFloat(results['jump_4'].evPerHand)).toFixed(4);
console.log(`  Gain from extra tiers:         ${tierGain>0?'+':''}$${tierGain}/hand`);
console.log(`  Gain from better count:        ${hiloGain>0?'+':''}$${hiloGain}/hand  vs ace-6`);
console.log('');
console.log('  Practical tradeoff:');
console.log('  ace-6:  track 2 card types (6 and A)');
console.log('  ace-56: track 3 card types (5, 6, and A)');
console.log('  Hi-Lo:  track 10 card types (2,3,4,5,6 up / T,A down)');
console.log('');
