// ═══════════════════════════════════════════════════════════════════
//  CLUTCH MOMENT — detection + canvas share-card rendering.
//
//  detectClutch(): a hand qualifies when the player WON on a third-card
//  draw that flipped the hand — behind (comeback) or deadlocked
//  (snatch) on the two-card totals — with a payout above threshold.
//  Naturals never qualify (no third card, no drama).
//
//  renderShareFrame(): draws the branded 9:16 share card straight to a
//  canvas as a function of t∈[0,1], so ONE draw function yields both
//  the poster PNG (t=1) and every frame of the recorded WebM.
// ═══════════════════════════════════════════════════════════════════
import { total, type BattleCard } from '../battle/useBaccaratBattle';

export type BetSide = 'player' | 'banker' | 'tie';

export interface ClutchHand {
  playerHand: BattleCard[];
  bankerHand: BattleCard[];
  betSide: BetSide;
  payout: number;           // net chips won
  stage?: string;           // e.g. 'STAGE 47 · NEO TOKYO'
}

export interface ClutchMoment extends ClutchHand {
  kind: 'comeback' | 'snatch' | 'monster';
  headline: string;
  sub: string;
  /** which hand drew the decisive third card */
  pivotHand: 'player' | 'banker';
  before: { p: number; b: number };  // two-card totals
  after: { p: number; b: number };   // final totals
  ts: number;
}

export function detectClutch(hand: ClutchHand, minPayout = 1_000): ClutchMoment | null {
  const { playerHand, bankerHand, betSide, payout } = hand;
  if (payout < minPayout) return null;
  if (playerHand.length < 2 || bankerHand.length < 2) return null;
  const hadThird = playerHand.length === 3 || bankerHand.length === 3;
  if (!hadThird) return null;                       // naturals/stand-pat: no drama

  const before = { p: total(playerHand.slice(0, 2)), b: total(bankerHand.slice(0, 2)) };
  const after = { p: total(playerHand), b: total(bankerHand) };
  const outcome: BetSide = after.p === after.b ? 'tie' : after.p > after.b ? 'player' : 'banker';
  if (outcome !== betSide) return null;             // must have WON the bet

  // Was the bet side winning before the draw(s)?
  const beforeLead: BetSide = before.p === before.b ? 'tie' : before.p > before.b ? 'player' : 'banker';
  const pivotHand: 'player' | 'banker' = playerHand.length === 3 ? 'player' : 'banker';

  let kind: ClutchMoment['kind'];
  if (beforeLead !== 'tie' && beforeLead !== betSide) kind = 'comeback';   // was losing
  else if (beforeLead === 'tie') kind = 'snatch';                          // deadlock broken
  else if (payout >= 10_000) kind = 'monster';                            // led, but huge
  else return null;                                  // led + modest win = not clutch

  const flavor = {
    comeback: { headline: 'EPIC COMEBACK!', sub: `DOWN ${before.p}–${before.b} · THIRD CARD DELIVERS` },
    snatch:   { headline: 'DEADLOCK BROKEN!', sub: `TIED ${before.p}–${before.b} · ONE CARD DECIDES` },
    monster:  { headline: 'MONSTER HAND!', sub: 'THE SHOE BOWS TO NO ONE' },
  }[kind];

  return { ...hand, kind, ...flavor, pivotHand, before, after, ts: Date.now() };
}

/* ── canvas share card ───────────────────────────────────────────── */

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
/** local timeline segment: 0 before a, 1 after b */
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a));

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCard(
  ctx: CanvasRenderingContext2D, card: BattleCard,
  cx: number, cy: number, w: number, appear: number, glow = false,
) {
  if (appear <= 0) return;
  const h = w * 1.45;
  const scale = 0.6 + 0.4 * appear;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha = appear;
  if (glow) { ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 40; }
  else { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 16; }
  ctx.fillStyle = '#fffef8';
  roundedRect(ctx, -w / 2, -h / 2, w, h, w * 0.12);
  ctx.fill();
  ctx.shadowBlur = 0;
  const red = card.suit === '♥' || card.suit === '♦';
  ctx.fillStyle = red ? '#dc2626' : '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = `900 ${w * 0.42}px Georgia, serif`;
  ctx.fillText(card.rank, 0, -h * 0.05);
  ctx.font = `${w * 0.4}px serif`;
  ctx.fillText(card.suit, 0, h * 0.3);
  ctx.restore();
}

/**
 * Draw one frame of the share card. t=1 → finished poster.
 * Timeline: 0-0.1 brand · 0.08-0.4 initial cards · 0.4-0.55 standoff
 *           0.55-0.7 pivot card slam · 0.7-1 headline + payout + CTA
 */
export function renderShareFrame(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number, m: ClutchMoment,
) {
  // backdrop: abyss gradient + neon streaks + vignette
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0618'); bg.addColorStop(0.5, '#1a1145'); bg.addColorStop(1, '#0a0618');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.translate(W * (0.15 + i * 0.2), H * 0.5);
    ctx.rotate(-0.5);
    ctx.fillStyle = i % 2 ? '#2ee6ff' : '#ff2e88';
    ctx.fillRect(-W * 0.02, -H, W * 0.04, H * 2);
    ctx.restore();
  }

  const brandIn = seg(t, 0, 0.1);
  ctx.textAlign = 'center';
  ctx.globalAlpha = brandIn;
  ctx.fillStyle = '#ffd24a';
  ctx.font = `900 ${W * 0.055}px Georgia, serif`;
  ctx.fillText('⚔ BACCARAT GLADIATOR ⚔', W / 2, H * 0.08);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${W * 0.03}px Georgia, serif`;
  ctx.fillText(m.stage ?? 'THE GRAND ARENA', W / 2, H * 0.115);
  ctx.globalAlpha = 1;

  // hands: player row upper, banker row lower
  const cardW = W * 0.16;
  const rows: Array<{ label: string; hand: BattleCard[]; y: number; totalAfter: number; color: string }> = [
    { label: 'PLAYER', hand: m.playerHand, y: H * 0.30, totalAfter: m.after.p, color: '#5588ff' },
    { label: 'BANKER', hand: m.bankerHand, y: H * 0.52, totalAfter: m.after.b, color: '#ff5555' },
  ];
  rows.forEach((row, ri) => {
    ctx.globalAlpha = seg(t, 0.08, 0.15);
    ctx.fillStyle = row.color;
    ctx.font = `700 ${W * 0.032}px Georgia, serif`;
    ctx.fillText(row.label, W / 2, row.y - cardW * 0.95);
    ctx.globalAlpha = 1;
    row.hand.forEach((card, i) => {
      const isPivot = i === 2 && ((m.pivotHand === 'player' && ri === 0) || (m.pivotHand === 'banker' && ri === 1));
      const appear = isPivot
        ? seg(t, 0.55, 0.68)                       // the decisive card slams late
        : seg(t, 0.1 + (ri * 2 + i) * 0.06, 0.17 + (ri * 2 + i) * 0.06);
      const x = W / 2 + (i - (row.hand.length - 1) / 2) * cardW * 1.15;
      drawCard(ctx, card, x, row.y, cardW * (isPivot ? 1.15 : 1), appear, isPivot);
    });
    // final total badge
    const totIn = seg(t, 0.68, 0.74);
    if (totIn > 0) {
      ctx.globalAlpha = totIn;
      ctx.fillStyle = row.color;
      ctx.font = `900 ${W * 0.05}px Georgia, serif`;
      ctx.fillText(String(row.totalAfter), W / 2 + (row.hand.length / 2) * cardW * 1.15 + cardW * 0.7, row.y + W * 0.02);
      ctx.globalAlpha = 1;
    }
  });

  // standoff caption ("DOWN 3–7")
  const standoff = seg(t, 0.42, 0.5) * (1 - seg(t, 0.66, 0.72));
  if (standoff > 0) {
    ctx.globalAlpha = standoff;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `700 ${W * 0.045}px Georgia, serif`;
    ctx.fillText(m.sub, W / 2, H * 0.66);
    ctx.globalAlpha = 1;
  }

  // headline + payout
  const slam = seg(t, 0.72, 0.82);
  if (slam > 0) {
    ctx.save();
    ctx.translate(W / 2, H * 0.72);
    ctx.scale(2.2 - 1.2 * slam, 2.2 - 1.2 * slam);
    ctx.globalAlpha = slam;
    ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 60;
    ctx.fillStyle = '#ffd24a';
    ctx.font = `900 ${W * 0.085}px Georgia, serif`;
    ctx.fillText(m.headline, 0, 0);
    ctx.restore();

    const payIn = seg(t, 0.8, 0.9);
    ctx.globalAlpha = payIn;
    ctx.shadowColor = '#3dff8f'; ctx.shadowBlur = 40;
    ctx.fillStyle = '#3dff8f';
    ctx.font = `900 ${W * 0.075}px Georgia, serif`;
    ctx.fillText(`+${m.payout.toLocaleString()} CHIPS`, W / 2, H * 0.79);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // footer CTA
  const cta = seg(t, 0.88, 1);
  ctx.globalAlpha = cta;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `700 ${W * 0.034}px Georgia, serif`;
  ctx.fillText('▶ baccaratgladiator.com', W / 2, H * 0.93);
  ctx.globalAlpha = 1;
}

export function shareCaption(m: ClutchMoment): string {
  return `⚔️ ${m.headline} +${m.payout.toLocaleString()} chips on the third card! `
    + `${m.sub.toLowerCase()} — can you survive ${m.stage ?? 'the arena'}? `
    + `▶ https://baccaratgladiator.com #baccarat #bigwin #clutch`;
}

/** Scripted demo hand — textbook comeback, tableau-accurate:
 *  player A+2=3 vs banker 4+3=7 (banker always stands on 7),
 *  player draws on 3 → 6♥ lands → 9 over 7. */
export const DEMO_CLUTCH: ClutchMoment = detectClutch({
  playerHand: [
    { rank: 'A', suit: '♣', value: 1 }, { rank: '2', suit: '♦', value: 2 }, { rank: '6', suit: '♥', value: 6 },
  ],
  bankerHand: [{ rank: '4', suit: '♠', value: 4 }, { rank: '3', suit: '♥', value: 3 }],
  betSide: 'player',
  payout: 50_000,
  stage: 'STAGE 47 · NEO TOKYO',
})!;
