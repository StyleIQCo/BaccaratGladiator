'use strict';

// ════════════════════════════════════════════════════════════════════════
// TC Step-Down — 8-deck, $10 min, Four-Tier ÷2, Hard-Reset baseline
// ════════════════════════════════════════════════════════════════════════
//
// Baseline (script 22 winner): hard reset on TC ≤ 0
// New question: when TC drops a tier while mid-streak (positive → positive),
// should the bet be adjusted downward?
//
//  HARD       — baseline. Ceiling only caps up. curBet unchanged when TC drops.
//               TC ≤ 0 → full reset.
//
//  HARD+CLAMP — when ceiling drops below curBet, update curBet = newCeiling.
//               Depth counter preserved. TC ≤ 0 → full reset.
//               Effect: locks you into the lower tier's ceiling; wins
//               drop off the new ceiling rather than the old one.
//
//  HARD+STEP  — when curBet > newCeiling (TC dropped a tier mid-streak),
//               full hard reset to $10 / depth 0.
//               TC ≤ 0 → full reset.
//               Effect: abandons any in-progress streak when TC falls.
//
// All other params identical:
//   8 decks · $10 base · $1000 table max · 75% penetration
//   Four-tier ceiling: TC 0-1→$100, TC 1-2→$250, TC 2-3→$500, TC≥3→$1000
//   Win drop: ÷2 (floor $10)
//   Shoes: 100,000
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

// Returns which tier bucket (0=base, 1=100, 2=250, 3=500, 4=1000)
function tcTier(tc) {
  if (tc <= 0) return 0;
  if (tc < 1)  return 1;
  if (tc < 2)  return 2;
  if (tc < 3)  return 3;
  return 4;
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
// resetMode: 'hard' | 'hard_clamp' | 'hard_step'
function runSim(resetMode) {
  let bankroll=STARTING_BK,totalNet=0,totalWag=0;
  let hands=0,wins=0,losses=0,pushes=0;
  let maxBk=STARTING_BK,maxDd=0,busts=0,posShoes=0;
  let curBet=BASE_BET,curDepth=0,prevTier=0;

  // How often TC dropped a tier while mid-streak (curBet > base)
  let tierDropEvents=0;
  // At which depth did tier drops occur
  const depthAtTierDrop=new Array(9).fill(0);

  const depthCounts=new Array(9).fill(0);
  const shoePLbuckets=new Array(21).fill(0);

  for(let shoeN=0;shoeN<NUM_SHOES;shoeN++){
    if(bankroll<=0){bankroll=STARTING_BK;busts++;}
    const shoe=buildShoe(); let idx=0,rc=0;
    const shoeStart=bankroll;
    prevTier=0;

    while(idx<shoe.length-RESHUFFLE_AT){
      const decksLeft=(shoe.length-idx)/52;
      const tc=decksLeft>0.1?rc/decksLeft:0;
      const cap=getCeiling(tc);
      const tier=tcTier(tc);

      // Detect TC tier drop while in an active streak
      const tierDropped = tier < prevTier && curDepth > 0;
      if (tierDropped) {
        tierDropEvents++;
        depthAtTierDrop[Math.min(curDepth, 8)]++;
      }

      // Apply reset logic
      if (tc <= 0) {
        // All modes: hard reset when TC ≤ 0
        curBet = BASE_BET; curDepth = 0;
      } else if (resetMode === 'hard_clamp') {
        // Clamp curBet to new ceiling if it dropped
        if (curBet > cap) curBet = cap;
      } else if (resetMode === 'hard_step') {
        // Full reset if curBet exceeds new ceiling (tier dropped mid-streak)
        if (curBet > cap) { curBet = BASE_BET; curDepth = 0; }
      }
      // 'hard': no action on tier drop

      prevTier = tier;

      let bet = tc <= 0 ? BASE_BET : Math.min(curBet, cap, TABLE_MAX, bankroll);
      bet = Math.max(Math.round(bet/5)*5, BASE_BET);
      if (bet > bankroll) bet = bankroll;
      if (bet <= 0) break;

      depthCounts[Math.min(curDepth,8)]++;

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
    resetMode, hands,
    totalNet:     Math.round(totalNet),
    roi:          (totalNet/totalWag*100).toFixed(4),
    evPerHand:    (totalNet/hands).toFixed(4),
    avgBet:       (totalWag/hands).toFixed(2),
    winPct:       (wins/hands*100).toFixed(2),
    maxDd:        Math.round(maxDd),
    busts,
    bustRate:     Math.round(NUM_SHOES/Math.max(busts,1)),
    posShoePct:   (posShoes/NUM_SHOES*100).toFixed(1),
    sessionEV:    (totalNet/NUM_SHOES).toFixed(2),
    tierDropEvents, depthAtTierDrop,
    depthCounts, shoePLbuckets,
    finalBk:      Math.round(bankroll),
  };
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  TC Step-Down  —  8-deck · $10 min · Four-Tier · Hard Reset');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Shoes: ${NUM_SHOES.toLocaleString()}   |   Bankroll: $${STARTING_BK}   |   Table max: $${TABLE_MAX}`);
console.log('');
console.log('  MODES:');
console.log('  hard       — baseline (script 22 winner). No downward clamp on TC drop.');
console.log('  hard+clamp — when tier drops, curBet = min(curBet, newCeiling). Depth kept.');
console.log('  hard+step  — when tier drops and curBet > newCeiling, full reset to $10.');
console.log('');

const modes = ['hard','hard_clamp','hard_step'];
const modeLabels = { hard:'hard', hard_clamp:'hard+clamp', hard_step:'hard+step' };
const results = {};
for(const m of modes){
  process.stdout.write(`  Running ${modeLabels[m].padEnd(12)}...`);
  results[m] = runSim(m);
  const r = results[m];
  process.stdout.write(` EV: $${r.evPerHand}/hand  ROI: ${r.roi}%  Busts: ${r.busts}  +Shoe: ${r.posShoePct}%\n`);
}

// ── Comparison table ──────────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(96));
console.log('  SIDE-BY-SIDE COMPARISON');
console.log('═'.repeat(96));
const metrics = [
  ['EV per hand',         r => '$'+r.evPerHand],
  ['ROI',                 r => r.roi+'%'],
  ['Avg bet',             r => '$'+r.avgBet],
  ['Win%',                r => r.winPct+'%'],
  ['Max drawdown',        r => '$'+r.maxDd.toLocaleString()],
  ['Busts',               r => r.busts+' (1 in '+r.bustRate+' shoes)'],
  ['Win shoe %',          r => r.posShoePct+'%'],
  ['Session EV (1 shoe)', r => '$'+r.sessionEV],
  ['Session EV (6 shoe)', r => '$'+(parseFloat(r.sessionEV)*6).toFixed(2)],
  ['Tier-drop events',    r => r.tierDropEvents.toLocaleString()+
    ' ('+( r.tierDropEvents/r.hands*100).toFixed(2)+'% of hands)'],
];
console.log('  Metric'.padEnd(28) + 'HARD'.padEnd(34) + 'HARD+CLAMP'.padEnd(34) + 'HARD+STEP');
console.log('  ' + '─'.repeat(94));
for(const [label, fn] of metrics){
  console.log(
    '  ' + label.padEnd(26) +
    fn(results.hard).padEnd(34) +
    fn(results.hard_clamp).padEnd(34) +
    fn(results.hard_step)
  );
}

// ── Tier-drop depth analysis ──────────────────────────────────────────────
console.log('');
console.log('  TIER-DROP EVENTS — HARD baseline: depth at which TC fell a tier');
console.log('  (same distribution applies to all modes; clamp/step act on these events)');
console.log('  ─────────────────────────────────────────────────────────────────');
const hd = results.hard;
const totalDrops = hd.tierDropEvents;
let bv = BASE_BET;
for(let d=1;d<=8;d++){
  const cnt = hd.depthAtTierDrop[d]||0;
  if(!cnt) continue;
  const pct = (cnt/totalDrops*100).toFixed(1);
  const bar = '█'.repeat(Math.round(cnt/totalDrops*40));
  const lostInChain = BASE_BET*(Math.pow(2,d)-1);
  console.log(
    `  Depth ${d} (bet was $${String(Math.min(bv,TABLE_MAX)).padEnd(5)})  `+
    `${cnt.toLocaleString().padStart(9)}  ${pct.padStart(5)}%   $${lostInChain} in chain  ${bar}`
  );
  bv = Math.min(bv*2, TABLE_MAX);
}

// ── Martingale depth distribution ─────────────────────────────────────────
console.log('');
console.log('  MARTINGALE DEPTH DISTRIBUTION COMPARISON');
console.log('  ─────────────────────────────────────────────────────────────────────────────');
console.log('  Depth  Bet    HARD%       HARD+CLAMP%  HARD+STEP%');
console.log('  ──────────────────────────────────────────────────────');
bv = BASE_BET;
for(let d=0;d<=8;d++){
  const ts = results.hard.depthCounts.reduce((a,b)=>a+b,0);
  const tc = results.hard_clamp.depthCounts.reduce((a,b)=>a+b,0);
  const tst= results.hard_step.depthCounts.reduce((a,b)=>a+b,0);
  const ps  = (results.hard.depthCounts[d]/ts*100).toFixed(2);
  const pc  = (results.hard_clamp.depthCounts[d]/tc*100).toFixed(2);
  const pst = (results.hard_step.depthCounts[d]/tst*100).toFixed(2);
  console.log(
    `  Depth ${d}  $${String(Math.min(bv,TABLE_MAX)).padEnd(5)}  `+
    `${ps.padStart(7)}%    ${pc.padStart(7)}%     ${pst.padStart(7)}%`
  );
  bv = Math.min(bv*2, TABLE_MAX*2);
}

// ── Per-shoe P/L comparison ───────────────────────────────────────────────
console.log('');
console.log('  PER-SHOE P/L COMPARISON  (one ~72-hand session)');
console.log('  ──────────────────────────────────────────────────────────────────────────');
console.log('  Result          HARD%       HARD+CLAMP%  HARD+STEP%');
console.log('  ──────────────────────────────────────────────────────────────────────────');
const labels=['< -$900','-$800','-$700','-$600','-$500','-$400','-$300','-$200','-$100',
  'break-even','+$0-100','+$100','+$200','+$300','+$400','+$500','+$600','+$700','+$800','+$900','> +$900'];
for(let i=0;i<21;i++){
  const ph  = (results.hard.shoePLbuckets[i]/NUM_SHOES*100).toFixed(1);
  const pc  = (results.hard_clamp.shoePLbuckets[i]/NUM_SHOES*100).toFixed(1);
  const pst = (results.hard_step.shoePLbuckets[i]/NUM_SHOES*100).toFixed(1);
  if(parseFloat(ph)>0.2||parseFloat(pc)>0.2||parseFloat(pst)>0.2){
    console.log(
      `  ${labels[i].padEnd(16)} ${ph.padStart(6)}%      ${pc.padStart(6)}%       ${pst.padStart(6)}%`
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  INTERPRETATION');
console.log('════════════════════════════════════════════════════════════════');
console.log('');
console.log('  HARD (baseline): ceiling only caps escalation upward.');
console.log('  When TC drops from TC+2 to TC+1.5, curBet stays at $500 internally.');
console.log('  The bet placed is min($500, $250) = $250. After loss: curBet → $1000,');
console.log('  capped to $250 again. Win from $250 → curBet halves to $250.');
console.log('');
console.log('  HARD+CLAMP: when cap drops, curBet updated to cap.');
console.log('  Same $250 bet placed, but after a win curBet → $125 (not $250).');
console.log('  More conservative recovery; leaves more room to rebuild.');
console.log('');
console.log('  HARD+STEP: when cap drops below curBet, abandon streak entirely.');
console.log('  Takes the loss in the chain and starts fresh. Bets $10 next hand.');
console.log('  Useful if you believe TC drops signal further deterioration.');
console.log('');
