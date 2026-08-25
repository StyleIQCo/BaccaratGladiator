// ═══════════════════════════════════════════════════════════════════
//  useSpectateSession — MOCKED bet-behind stream session.
//  A Tier-9/10 high-roller plays real hands (same verified engine as
//  the boss battle); spectators watch, chat, spam hype, and can
//  "ride" the high-roller's bet with a micro-stake before lock.
//
//  Round loop, director-timed like useBaccaratBattle:
//    betting (8s countdown, HR announces their bet, rides open)
//    → locked → revealing (per-card beats) → settled (4s) → next round
//
//  Wire-swap path: phases/chat/hype arrive as socket events from the
//  arena gateway (the HR *is* a live arena player); ride() becomes a
//  PLACE_BET with a backer flag riding the HR's market.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bankerDraws, buildShoe, total, type BattleCard,
} from '../battle/useBaccaratBattle';

export type SpectatePhase = 'betting' | 'locked' | 'revealing' | 'settled';
export type Side = 'player' | 'banker' | 'tie';

export interface ChatMsg { id: number; name: string; hue: number; text: string; mine?: boolean }
export interface HypeEvent { id: number; emoji: string; x: number }

export interface SpectateResult {
  outcome: Side; playerTotal: number; bankerTotal: number; natural: boolean; ts: number;
}

export interface SpectateState {
  phase: SpectatePhase;
  round: number;
  countdown: number;              // whole seconds left in betting
  viewers: number;
  highRoller: { name: string; hue: number; tier: number; stage: string; streak: number };
  hrBet: { side: Side; amount: number } | null;
  playerHand: BattleCard[]; bankerHand: BattleCard[];
  revealed: { player: number; banker: number };
  result: SpectateResult | null;
  myRide: number | null;          // my micro-stake riding hrBet.side
  myBalance: number;
  lastPayout: { delta: number; ts: number } | null;
  chat: ChatMsg[];
  hype: HypeEvent[];
}

const HIGH_ROLLER = { name: 'Marina Bay Max', hue: 205, tier: 9, stage: 'Monte Carlo', streak: 4 };
const SPECTATORS: Array<[string, number]> = [
  ['Lucky Lin', 140], ['Tie Guy Ty', 90], ['Neon Nick', 280], ['Baccarat Bea', 320],
  ['Cut Card Carl', 30], ['Streaky Stella', 0], ['Panda Paul', 110], ['Vegas Vee', 250],
];
const CHAT_BETTING = [
  'banker again, calling it now', 'this shoe is CHOPPY', 'ride or regret 😤',
  'he never bets tie, watch', 'my last 100 chips lets gooo', 'road says follow 📈',
];
const CHAT_WIN = ['LFG 🔥🔥', 'CALLED IT', 'max is HIM', 'easiest ride of my life', 'streak alive!!'];
const CHAT_LOSE = ['pain.', 'the shoe giveth…', 'still riding next hand', 'F', 'unlucky, run it back'];
const HYPE_EMOJIS = ['🔥', '💎', '👏', '🐉'];

const BET_SECONDS = 8;
const PAYOUT: Record<Side, number> = { player: 1, banker: 0.95, tie: 8 };

let idSeq = 1;

export function useSpectateSession() {
  const [state, setState] = useState<SpectateState>({
    phase: 'betting', round: 1, countdown: BET_SECONDS, viewers: 47 + Math.floor(Math.random() * 30),
    highRoller: HIGH_ROLLER, hrBet: null,
    playerHand: [], bankerHand: [], revealed: { player: 0, banker: 0 },
    result: null, myRide: null, myBalance: 2_000, lastPayout: null,
    chat: [{ id: idSeq++, name: 'system', hue: 45, text: `👁 You are spectating ${HIGH_ROLLER.name} · Tier ${HIGH_ROLLER.tier} · ${HIGH_ROLLER.stage}` }],
    hype: [],
  });
  const shoe = useRef<BattleCard[]>(buildShoe());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);

  const at = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => { if (alive.current) fn(); }, ms);
    timers.current.push(t);
  }, []);

  const pushChat = useCallback((name: string, hue: number, text: string, mine = false) => {
    setState(s => ({ ...s, chat: [...s.chat, { id: idSeq++, name, hue, text, mine }].slice(-40) }));
  }, []);

  const draw = () => {
    if (shoe.current.length < 6) shoe.current = buildShoe();
    return shoe.current.pop()!;
  };

  /** One full spectated round; reschedules itself forever. */
  const runRound = useCallback(() => {
    // ── HR announces the bet a beat into the betting window
    const side: Side = Math.random() < 0.55 ? 'banker' : Math.random() < 0.9 ? 'player' : 'tie';
    const amount = [25_000, 50_000, 75_000, 100_000, 250_000][Math.floor(Math.random() * 5)];
    setState(s => ({
      ...s, phase: 'betting', countdown: BET_SECONDS, hrBet: null, myRide: null,
      playerHand: [], bankerHand: [], revealed: { player: 0, banker: 0 }, result: null,
    }));
    at(900, () => {
      setState(s => ({ ...s, hrBet: { side, amount } }));
      pushChat('system', 45, `💰 ${HIGH_ROLLER.name} puts $${amount.toLocaleString()} on ${side.toUpperCase()}`);
    });

    // countdown ticks + ambient chat
    for (let sLeft = BET_SECONDS - 1; sLeft >= 0; sLeft--) {
      at((BET_SECONDS - sLeft) * 1000, () => setState(st => ({ ...st, countdown: sLeft })));
    }
    at(1600, () => {
      const [name, hue] = SPECTATORS[Math.floor(Math.random() * SPECTATORS.length)];
      pushChat(name, hue, CHAT_BETTING[Math.floor(Math.random() * CHAT_BETTING.length)]);
    });
    at(4200, () => {
      const [name, hue] = SPECTATORS[Math.floor(Math.random() * SPECTATORS.length)];
      pushChat(name, hue, CHAT_BETTING[Math.floor(Math.random() * CHAT_BETTING.length)]);
    });

    // ── lock + resolve the hand up front, then choreograph reveals
    at(BET_SECONDS * 1000, () => {
      setState(s => ({ ...s, phase: 'locked' }));
      pushChat('system', 45, '🛑 No more bets.');
    });

    const pH: BattleCard[] = [draw(), draw()];
    const bH: BattleCard[] = [draw(), draw()];
    let pT = total(pH), bT = total(bH);
    const naturalStop = pT >= 8 || bT >= 8;
    let pThird: BattleCard | null = null;
    if (!naturalStop && pT <= 5) { pThird = draw(); pH.push(pThird); pT = total(pH); }
    if (!naturalStop && bankerDraws(bT, pThird)) { bH.push(draw()); bT = total(bH); }
    const outcome: Side = pT === bT ? 'tie' : pT > bT ? 'player' : 'banker';
    const winCards = outcome === 'player' ? pH : outcome === 'banker' ? bH : null;
    const natural = !!winCards && winCards.length === 2 && total(winCards) >= 8;

    let t = BET_SECONDS * 1000 + 700;
    setStateAt(t, s => ({ ...s, phase: 'revealing', playerHand: pH, bankerHand: bH }));
    const beats: Array<Partial<SpectateState['revealed']>> = [
      { player: 1 }, { banker: 1 }, { player: 2 }, { banker: 2 },
    ];
    beats.forEach(patch => {
      t += 600;
      setStateAt(t, s => ({ ...s, revealed: { ...s.revealed, ...patch } }));
    });
    if (pH.length === 3) { t += 750; setStateAt(t, s => ({ ...s, revealed: { ...s.revealed, player: 3 } })); }
    if (bH.length === 3) { t += 750; setStateAt(t, s => ({ ...s, revealed: { ...s.revealed, banker: 3 } })); }

    // ── settle: HR streak, my ride, chat eruption
    t += 700;
    at(t, () => {
      const result: SpectateResult = { outcome, playerTotal: pT, bankerTotal: bT, natural, ts: Date.now() };
      setState(s => {
        const hrWon = s.hrBet?.side === outcome;
        const push = outcome === 'tie' && s.hrBet !== null && s.hrBet.side !== 'tie';
        let delta = 0;          // net result of my ride
        let credit = 0;         // chips returning to my balance
        if (s.myRide !== null && s.hrBet) {
          if (hrWon) {
            delta = Math.floor(s.myRide * PAYOUT[s.hrBet.side]);
            credit = s.myRide + delta;      // stake back + winnings
          } else if (push) {
            delta = 0;
            credit = s.myRide;              // tie pushes banker/player rides
          } else {
            delta = -s.myRide;              // stake already debited at ride()
          }
        }
        return {
          ...s, phase: 'settled', result,
          myBalance: s.myBalance + credit,
          lastPayout: s.myRide !== null ? { delta, ts: result.ts } : null,
          highRoller: { ...s.highRoller, streak: hrWon ? s.highRoller.streak + 1 : 0 },
          viewers: Math.max(20, s.viewers + Math.floor(Math.random() * 9) - (hrWon ? 1 : 4)),
        };
      });
      const pool = outcome !== 'tie' ? (side === outcome ? CHAT_WIN : CHAT_LOSE) : ['ÉGALITÉ?!', 'a wild tie appears'];
      for (let i = 0; i < 3; i++) {
        const [name, hue] = SPECTATORS[(Math.floor(Math.random() * SPECTATORS.length) + i) % SPECTATORS.length];
        at(300 + i * 550, () => pushChat(name, hue, pool[Math.floor(Math.random() * pool.length)]));
      }
      if (natural) at(200, () => pushChat('system', 45, `⚔️ NATURAL ${Math.max(pT, bT)} — the pit goes quiet.`));
    });

    // next round
    at(t + 4_200, runRound);

    function setStateAt(ms: number, fn: (s: SpectateState) => SpectateState) { at(ms, () => setState(fn)); }
  }, [at, pushChat]);

  useEffect(() => {
    alive.current = true;
    runRound();
    return () => { alive.current = false; timers.current.forEach(clearTimeout); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Place a micro-bet riding the HR's side. Debited immediately; only during betting. */
  const ride = useCallback((amount: number) => {
    setState(s => {
      if (s.phase !== 'betting' || !s.hrBet || s.myRide !== null || s.myBalance < amount) return s;
      return { ...s, myRide: amount, myBalance: s.myBalance - amount };
    });
  }, []);

  const sendHype = useCallback((emoji: string) => {
    const id = idSeq++;
    setState(s => ({ ...s, hype: [...s.hype, { id, emoji, x: 8 + Math.random() * 84 }] }));
    const t = setTimeout(() => {
      setState(s => ({ ...s, hype: s.hype.filter(h => h.id !== id) }));
    }, 2_200);
    timers.current.push(t);
  }, []);

  // ambient crowd hype so the room feels alive even when the user idles
  useEffect(() => {
    const iv = setInterval(() => {
      if (Math.random() < 0.5) sendHype(HYPE_EMOJIS[Math.floor(Math.random() * HYPE_EMOJIS.length)]);
    }, 2_600);
    return () => clearInterval(iv);
  }, [sendHype]);

  return { state, ride, sendHype, HYPE_EMOJIS };
}
