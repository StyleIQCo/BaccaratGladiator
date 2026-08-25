// ═══════════════════════════════════════════════════════════════════
//  useBaccaratBattle — dealer-accurate baccarat engine + RPG battle
//  layer. The baccarat rules are exact (8-deck shoe, naturals, full
//  tableau third-card rules) because accuracy is this game's brand;
//  the RPG layer maps hand outcomes to HP damage:
//
//    damage    = BASE 12 + 2 × winning margin
//    CRIT (×2) = winner had a two-card natural 8/9
//    tie       = no damage, tension holds
//
//  The hook choreographs the whole round through timed phases so the
//  component only renders state:
//    idle → dealing → revealing (per-card squeeze) → third
//         → striking → settled → (victory | defeat)
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';

export interface BattleCard {
  rank: string;          // 'A' '2'..'10' 'J' 'Q' 'K'
  suit: '♠' | '♥' | '♦' | '♣';
  value: number;         // baccarat value 0-9
}

export type BattlePhase =
  | 'idle' | 'dealing' | 'revealing' | 'third' | 'striking' | 'settled'
  | 'victory' | 'defeat';

export interface HandResult {
  winner: 'user' | 'boss' | 'tie';
  userTotal: number;
  bossTotal: number;
  natural: boolean;      // winner's first two cards totalled 8/9
  crit: boolean;         // natural win → critical hit
  damage: number;        // hp removed from the loser
  ts: number;            // keys one-shot animations
}

export interface BattleState {
  phase: BattlePhase;
  round: number;
  userHp: number;
  bossHp: number;
  maxHp: number;
  userHand: BattleCard[];
  bossHand: BattleCard[];
  /** how many cards of each hand are face-up (drives staged squeezes) */
  userRevealed: number;
  bossRevealed: number;
  lastResult: HandResult | null;
  log: string[];
}

const MAX_HP = 100;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SUITS = ['♠', '♥', '♦', '♣'] as const;

export const cardValue = (rank: string) =>
  rank === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(rank) ? 0 : Number(rank);

export const total = (cards: BattleCard[]) =>
  cards.reduce((s, c) => s + c.value, 0) % 10;

export function buildShoe(): BattleCard[] {
  const shoe: BattleCard[] = [];
  for (let d = 0; d < 8; d++)
    for (const suit of SUITS)
      for (const rank of RANKS)
        shoe.push({ rank, suit, value: cardValue(rank) });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

/** Exact tableau: does banker draw a third card? */
export function bankerDraws(bankerTotal: number, playerThird: BattleCard | null): boolean {
  if (playerThird === null) return bankerTotal <= 5;   // player stood pat
  const t = playerThird.value;
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return t !== 8;
  if (bankerTotal === 4) return t >= 2 && t <= 7;
  if (bankerTotal === 5) return t >= 4 && t <= 7;
  if (bankerTotal === 6) return t === 6 || t === 7;
  return false;
}

const initial: BattleState = {
  phase: 'idle', round: 0, userHp: MAX_HP, bossHp: MAX_HP, maxHp: MAX_HP,
  userHand: [], bossHand: [], userRevealed: 0, bossRevealed: 0,
  lastResult: null, log: ['⚔️ The boss awaits. Deal to strike.'],
};

export function useBaccaratBattle(opts?: { bossName?: string; taunts?: string[] }) {
  const bossName = opts?.bossName ?? 'The Boss';
  const [state, setState] = useState<BattleState>(initial);
  const shoe = useRef<BattleCard[]>(buildShoe());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = useRef(false);

  const at = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }, []);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const draw = (): BattleCard => {
    if (shoe.current.length < 6) shoe.current = buildShoe();
    return shoe.current.pop()!;
  };

  const deal = useCallback(() => {
    if (busy.current) return;
    setState(prev => {
      if (prev.phase === 'victory' || prev.phase === 'defeat') return prev;
      busy.current = true;

      // ── Resolve the full hand up front; choreograph the reveal after.
      const user: BattleCard[] = [draw(), draw()];
      const boss: BattleCard[] = [draw(), draw()];
      let uT = total(user), bT = total(boss);
      const naturalStop = uT >= 8 || bT >= 8;

      let userThird: BattleCard | null = null;
      if (!naturalStop && uT <= 5) { userThird = draw(); user.push(userThird); uT = total(user); }
      if (!naturalStop && bankerDraws(bT, userThird)) { boss.push(draw()); bT = total(boss); }

      const winner: HandResult['winner'] = uT === bT ? 'tie' : uT > bT ? 'user' : 'boss';
      const winCards = winner === 'user' ? user : boss;
      const natural = winner !== 'tie' && winCards.length === 2 && total(winCards.slice(0, 2)) >= 8;
      const margin = Math.abs(uT - bT);
      const damage = winner === 'tie' ? 0 : (12 + margin * 2) * (natural ? 2 : 1);
      const result: HandResult = {
        winner, userTotal: uT, bossTotal: bT, natural, crit: natural, damage, ts: Date.now(),
      };

      // ── Choreography ────────────────────────────────────────────
      const SQUEEZE = 650;             // per-card squeeze beat
      let t = 500;                     // cards slide in first
      // Initial four squeezes: user 1 → boss 1 → user 2 → boss 2
      const revealSteps: Array<Partial<BattleState>> = [
        { userRevealed: 1 }, { bossRevealed: 1 }, { userRevealed: 2 }, { bossRevealed: 2 },
      ];
      revealSteps.forEach(patch => {
        at(t, () => setState(s => ({ ...s, phase: 'revealing', ...patch })));
        t += SQUEEZE;
      });

      // third cards, if any
      if (user.length === 3) {
        at(t, () => setState(s => ({ ...s, phase: 'third', userRevealed: 3 })));
        t += SQUEEZE + 150;
      }
      if (boss.length === 3) {
        at(t, () => setState(s => ({ ...s, phase: 'third', bossRevealed: 3 })));
        t += SQUEEZE + 150;
      }

      // strike + settle
      at(t, () => setState(s => ({ ...s, phase: 'striking', lastResult: result })));
      t += result.crit ? 1100 : 850;
      at(t, () => setState(s => {
        const userHp = winner === 'boss' ? Math.max(0, s.userHp - damage) : s.userHp;
        const bossHp = winner === 'user' ? Math.max(0, s.bossHp - damage) : s.bossHp;
        const line =
          winner === 'tie' ? `🤝 Égalité ${uT}-${bT} — no blood drawn.`
          : winner === 'user'
            ? `⚔️ You strike for ${damage}${natural ? ' — NATURAL CRIT!' : ''} (${uT} vs ${bT})`
            : `💢 ${bossName} hits back for ${damage}${natural ? ' — NATURAL CRIT!' : ''} (${bT} vs ${uT})`;
        const taunt =
          winner === 'boss' && opts?.taunts?.length
            ? [`🗯 "${opts.taunts[s.round % opts.taunts.length]}"`]
            : [];
        const phase: BattlePhase = bossHp === 0 ? 'victory' : userHp === 0 ? 'defeat' : 'settled';
        busy.current = phase !== 'settled'; // victory/defeat stay locked until reset()
        return {
          ...s, phase, userHp, bossHp,
          log: [
            ...(phase === 'victory' ? [`🏆 ${bossName} FALLS! The stage is yours.`] : []),
            ...(phase === 'defeat' ? ['💀 You are out of chips… and blood.'] : []),
            ...taunt, line, ...s.log,
          ].slice(0, 6),
        };
      }));

      return {
        ...prev, phase: 'dealing', round: prev.round + 1,
        userHand: user, bossHand: boss, userRevealed: 0, bossRevealed: 0,
        lastResult: null,
      };
    });
  }, [at, bossName, opts?.taunts]);

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    busy.current = false;
    shoe.current = buildShoe();
    setState({ ...initial, log: ['⚔️ Rematch! The boss cracks their knuckles.'] });
  }, []);

  return { state, deal, reset, canDeal: state.phase === 'idle' || state.phase === 'settled' };
}
