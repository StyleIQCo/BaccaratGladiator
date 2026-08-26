'use client';

// ═══════════════════════════════════════════════════════════════════
//  EMERALD CITY CLAW — Framer Motion modal wrapper.
//
//  React OWNS this layer: the cabinet chrome, the intro screen, the
//  LED HUD strip, the LEFT/RIGHT/DROP control deck, the 3D prize
//  card, and the end-of-run haul. The canvas between them runs
//  entirely on refs (barista-wrapper conventions).
//
//  Beat sheet:
//    1. intro   — neon title, the six souvenirs with rarity + chips,
//                 "INSERT TOKEN" (primes audio inside the gesture).
//    2. playing — ClawMachineCanvas mounts. Steering: hold [◀]/[▶],
//                 drag the glass, or arrow keys; SPACE or the pulsing
//                 red [DROP CLAW] spends a token. Every won prize
//                 interrupts with a 3D celebration card.
//    3. over    — the haul: every prize, the total, pulsing Claim.
//
//  AUDIO — all synthesized (CSP: zero audio assets). The local
//  ClawAudio owns the LOOPING voices the shared arcade synth can't
//  do: trolley/cable servo whirs keyed off the sim's onMotor events.
//  One-shots: clunk on pile impact, pneumatic hiss-clack on prong
//  close, a descending womp on slips, fanfare + coin spill on wins.
//  UI taps reuse the shared playArcadeSfx.
//
//  STYLING — Tailwind utilities (like the barista/hotdog wrappers).
//  A host that mounts this must include emerald-arcade/src/**/*.tsx
//  in its Tailwind content glob (same contract as the odyssey
//  module) or the control deck renders unstyled.
//
//  Closing mid-run forfeits the remaining tokens; chips are only
//  granted through onClaim on the haul screen.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playArcadeSfx } from '../../hooks/useArcadeEngine';
import { ClawMachineCanvas, type ClawCanvasApi } from './ClawMachineCanvas';
import {
  RARITY_META,
  RUN_TOKENS_DEFAULT,
  CLAW_ITEMS,
  type ClawPhase,
  type ClawPrize,
  type MotorKind,
} from './useClawPhysics';

// ───────────────────────────────────────────────────────────────────
//  ClawAudio — WebAudio synth for the cabinet's mechanical voice.
// ───────────────────────────────────────────────────────────────────

interface MotorVoice {
  gain: GainNode;
  stop: () => void;
}

class ClawAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private motors: Partial<Record<MotorKind, MotorVoice>> = {};

  /** MUST be called from a user gesture once (iOS autoplay unlock). */
  prime() {
    this.ensure();
  }

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(dur: number, o: { type?: BiquadFilterType; from?: number; to?: number; vol?: number; at?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type ?? 'lowpass';
    filt.frequency.setValueAtTime(Math.max(1, o.from ?? 1000), t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.to ?? 200), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.vol ?? 0.3), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private tone(f0: number, f1: number, dur: number, o: { type?: OscillatorType; at?: number; vol?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(1, f0), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.vol ?? 0.3), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Looping servo whir — trolley is brighter, the cable winch lower. */
  motor(kind: MotorKind, on: boolean) {
    const running = this.motors[kind];
    if (!on) {
      if (running) {
        const ctx = this.ctx;
        if (ctx) {
          running.gain.gain.cancelScheduledValues(ctx.currentTime);
          running.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
        }
        const stop = running.stop;
        window.setTimeout(stop, 220);
        delete this.motors[kind];
      }
      return;
    }
    if (running) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = kind === 'trolley' ? 112 : 74;
    // Servo wobble.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = kind === 'trolley' ? 13 : 8;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = kind === 'trolley' ? 9 : 6;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = kind === 'trolley' ? 850 : 560;
    filt.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.setTargetAtTime(kind === 'trolley' ? 0.055 : 0.07, t0, 0.06);
    osc.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    osc.start(t0);
    lfo.start(t0);
    this.motors[kind] = {
      gain: g,
      stop: () => {
        try {
          osc.stop();
          lfo.stop();
        } catch {
          /* already stopped */
        }
      },
    };
  }

  /** Metal CLUNK — the claw head meets the pile. */
  clunk(strength: number) {
    const v = 0.5 + 0.5 * Math.min(1, strength);
    this.noise(0.13, { type: 'lowpass', from: 750, to: 140, vol: 0.34 * v });
    this.tone(96, 52, 0.16, { type: 'square', vol: 0.3 * v });
    this.tone(2300, 1600, 0.04, { type: 'square', vol: 0.08 * v });
  }

  /** Pneumatic HISS…CLACK — the prongs snap shut. */
  hissClack() {
    this.noise(0.13, { type: 'highpass', from: 1800, to: 4200, vol: 0.2 });
    this.tone(1500, 1200, 0.03, { type: 'square', at: 0.11, vol: 0.16 });
    this.tone(900, 700, 0.045, { type: 'square', at: 0.15, vol: 0.2 });
  }

  /** The grip fails — a sagging womp as the prize tumbles. */
  slip() {
    this.tone(320, 108, 0.38, { type: 'triangle', vol: 0.3 });
    this.noise(0.2, { type: 'lowpass', from: 900, to: 200, at: 0.05, vol: 0.16 });
  }

  /** Fanfare chime + a fistful of coins hitting the tray. */
  fanfareCoins() {
    const notes = [659, 784, 988, 1319];
    notes.forEach((f, i) => this.tone(f, f, 0.12, { type: 'triangle', at: i * 0.07, vol: 0.22 }));
    for (let i = 0; i < 11; i++) {
      const at = 0.18 + i * 0.05 + (i % 3) * 0.012;
      const f = 2100 + ((i * 379) % 1400);
      this.tone(f, f * 0.92, 0.045, { type: 'square', at, vol: 0.09 });
      if (i % 2 === 0) this.noise(0.03, { type: 'bandpass', from: 5200, to: 3600, at, vol: 0.07 });
    }
  }

  stopAll() {
    (Object.keys(this.motors) as MotorKind[]).forEach((k) => this.motor(k, false));
  }
}

let clawAudioSingleton: ClawAudio | null = null;
function clawAudio(): ClawAudio {
  if (!clawAudioSingleton) clawAudioSingleton = new ClawAudio();
  return clawAudioSingleton;
}

// ───────────────────────────────────────────────────────────────────
//  Wrapper component
// ───────────────────────────────────────────────────────────────────

export interface EmeraldClawGameProps {
  open: boolean;
  onClose: () => void;
  /** Award the chips (server call lives up here — the game never touches the wallet). */
  onClaim: (chips: number) => void | Promise<void>;
  tokens?: number; // default 4
  /** Deterministic machine (pile + slip rolls) — used by the smoke test. */
  seed?: number;
}

type Phase = 'intro' | 'playing' | 'over';

interface RunResult {
  chips: number;
  prizes: ClawPrize[];
}

/** The attendant's verdict on the haul. */
function haulTitle(r: RunResult): string {
  if (r.prizes.some((p) => p.rarity === 'legendary')) return 'GLASSBREAKER';
  if (r.prizes.some((p) => p.rarity === 'epic')) return 'TROLL TAMER';
  if (r.prizes.length >= 3) return 'ARM OF STEEL';
  if (r.prizes.length >= 1) return 'SOUVENIR HUNTER';
  return 'RAINED OUT';
}

export function EmeraldClawGame({
  open,
  onClose,
  onClaim,
  tokens = RUN_TOKENS_DEFAULT,
  seed,
}: EmeraldClawGameProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [clawPhase, setClawPhase] = useState<ClawPhase>('idle');
  const [hud, setHud] = useState({ tokens, chips: 0 });
  const [prizeQueue, setPrizeQueue] = useState<ClawPrize[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const claimedRef = useRef(false);
  const apiRef = useRef<ClawCanvasApi | null>(null);

  // Fresh machine every open; silence on the way out.
  useEffect(() => {
    if (open) {
      setPhase('intro');
      setClawPhase('idle');
      setHud({ tokens, chips: 0 });
      setPrizeQueue([]);
      setResult(null);
      setClaiming(false);
      claimedRef.current = false;
    } else {
      clawAudio().stopAll();
    }
  }, [open, tokens]);
  useEffect(() => () => clawAudio().stopAll(), []);

  // Desktop courtesy: arrows steer, space drops.
  useEffect(() => {
    if (!open || phase !== 'playing') return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'ArrowLeft') apiRef.current?.setDir(-1);
      else if (e.key === 'ArrowRight') apiRef.current?.setDir(1);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        apiRef.current?.drop();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') apiRef.current?.setDir(0);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [open, phase]);

  const holdDir = useCallback((dir: -1 | 0 | 1) => {
    apiRef.current?.setDir(dir);
  }, []);

  const handleDrop = useCallback(() => {
    apiRef.current?.drop();
  }, []);

  const handleGameOver = useCallback((chips: number, prizes: ClawPrize[]) => {
    playArcadeSfx('game_over', { volume: 0.8 });
    setResult({ chips, prizes });
    setPhase('over');
  }, []);

  const handleClaim = async () => {
    if (claimedRef.current || !result) return;
    claimedRef.current = true;
    setClaiming(true);
    playArcadeSfx('fanfare');
    clawAudio().stopAll();
    try {
      await onClaim(result.chips);
    } finally {
      onClose();
    }
  };

  const dropDisabled = clawPhase !== 'idle' || hud.tokens <= 0 || phase !== 'playing';
  const currentPrize = prizeQueue.length > 0 ? prizeQueue[0] : null;
  const springIn = reduceMotion
    ? { duration: 0.01 }
    : { type: 'spring' as const, bounce: 0.45, duration: 0.7 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="relative flex w-[min(430px,96vw)] flex-col overflow-hidden rounded-3xl border-2 border-fuchsia-400/40 bg-gradient-to-b from-slate-900 via-[#0b1220] to-black shadow-[0_0_70px_-12px_rgba(255,92,225,0.5)]"
            initial={{ scale: 0.6, y: 60, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.8, y: 40, opacity: 0 }}
            transition={springIn}
          >
            {/* ✕ — mid-run this forfeits the remaining tokens */}
            <button
              onClick={onClose}
              aria-label="Close"
              data-testid="claw-close"
              className="absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-sm font-bold text-white/80 hover:bg-black/70"
            >
              ✕
            </button>

            {/* ── LED HUD strip ── */}
            {phase !== 'intro' && (
              <div className="relative z-10 flex items-center justify-between border-b border-cyan-300/15 bg-black/60 px-4 py-2 font-mono text-[12px] font-bold tracking-widest">
                <span className="flex items-center gap-1.5 text-fuchsia-300" data-testid="claw-hud-tokens">
                  TOKENS
                  <span className="ml-1 flex gap-1">
                    {Array.from({ length: tokens }, (_, i) => (
                      <span
                        key={i}
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          i < hud.tokens
                            ? 'bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.9)]'
                            : 'bg-slate-700'
                        }`}
                      />
                    ))}
                  </span>
                </span>
                <span className="text-cyan-300" data-testid="claw-hud-chips">
                  🪙 {hud.chips.toLocaleString()}
                </span>
              </div>
            )}

            <div className="relative h-[min(520px,62vh)] w-full">
              {/* ── Intro ── */}
              {phase === 'intro' && (
                <div
                  className="relative z-10 flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
                  data-testid="claw-intro"
                >
                  <motion.div
                    className="text-6xl"
                    animate={reduceMotion ? undefined : { y: [0, -10, 0] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  >
                    🕹️
                  </motion.div>
                  <h2 className="text-2xl font-black uppercase italic tracking-wide text-fuchsia-300 drop-shadow-[0_0_14px_rgba(255,92,225,0.6)]">
                    Emerald City Claw
                  </h2>
                  <p className="text-sm text-cyan-50/90">
                    {tokens} tokens. One motorized claw. A cabinet of Seattle.
                    <br />
                    <span className="text-xs text-cyan-100/60">
                      Grip physics are real — heavy prizes slip off a sloppy grab. 🔊 Sound on: the
                      servos tell you everything.
                    </span>
                  </p>
                  <div className="w-full space-y-1 rounded-2xl bg-black/40 p-3 text-left text-[12px]">
                    {CLAW_ITEMS.map((it) => (
                      <div key={it.type} className="flex items-center gap-2">
                        <span className="text-base leading-5">{it.glyph}</span>
                        <span className="flex-1 truncate font-bold text-slate-100">{it.name}</span>
                        <span
                          className="text-[9px] font-black tracking-widest"
                          style={{ color: RARITY_META[it.rarity].color }}
                        >
                          {RARITY_META[it.rarity].label}
                        </span>
                        <span className="w-14 text-right font-mono font-bold text-amber-300">
                          {it.chips.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <motion.button
                    data-testid="claw-start"
                    onClick={() => {
                      // MUST run inside this tap — iOS unlocks audio on a gesture.
                      clawAudio().prime();
                      playArcadeSfx('coin_insert');
                      setPhase('playing');
                    }}
                    whileTap={{ scale: 0.92 }}
                    className="mt-1 rounded-full bg-gradient-to-b from-fuchsia-400 to-fuchsia-600 px-10 py-3 text-lg font-black uppercase tracking-wider text-white shadow-lg shadow-fuchsia-500/40"
                  >
                    🪙 Insert Token
                  </motion.button>
                </div>
              )}

              {/* ── The machine ── */}
              {(phase === 'playing' || phase === 'over') && (
                <ClawMachineCanvas
                  tokens={tokens}
                  seed={seed}
                  apiRef={apiRef}
                  onPhaseChange={setClawPhase}
                  onMotor={(kind, on) => clawAudio().motor(kind, on)}
                  onImpact={(s) => clawAudio().clunk(s)}
                  onGrab={(hit) => {
                    if (hit) clawAudio().hissClack();
                    else playArcadeSfx('clank', { volume: 0.6 });
                  }}
                  onSlip={() => clawAudio().slip()}
                  onPrize={(prize) => {
                    clawAudio().fanfareCoins();
                    setPrizeQueue((q) => [...q, prize]);
                  }}
                  onDeny={() => playArcadeSfx('clank', { volume: 0.7 })}
                  onHudTick={(tokensLeft, chips) => setHud({ tokens: tokensLeft, chips })}
                  onGameOver={handleGameOver}
                  className="h-full w-full"
                />
              )}

              {/* ── Prize celebration: the 3D card ── */}
              <AnimatePresence>
                {currentPrize && (
                  <motion.div
                    className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 p-6"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ perspective: 900 }}
                    data-testid="claw-prize-card"
                  >
                    <motion.div
                      className="w-full max-w-[280px] rounded-2xl border-2 p-5 text-center"
                      style={{
                        borderColor: RARITY_META[currentPrize.rarity].color,
                        background:
                          'linear-gradient(160deg, rgba(26,36,60,0.98), rgba(8,12,24,0.99))',
                        boxShadow: `0 0 44px -6px ${RARITY_META[currentPrize.rarity].color}`,
                        transformStyle: 'preserve-3d',
                      }}
                      initial={reduceMotion ? { opacity: 0 } : { rotateY: 100, scale: 0.7, opacity: 0 }}
                      animate={reduceMotion ? { opacity: 1 } : { rotateY: 0, scale: 1, opacity: 1 }}
                      exit={reduceMotion ? { opacity: 0 } : { rotateY: -70, scale: 0.8, opacity: 0 }}
                      transition={reduceMotion ? { duration: 0.01 } : { duration: 0.55, ease: [0.2, 0.9, 0.3, 1] }}
                    >
                      <div
                        className="text-[10px] font-black tracking-[0.3em]"
                        style={{ color: RARITY_META[currentPrize.rarity].color }}
                      >
                        {currentPrize.knockIn ? '⚡ LUCKY KNOCK-IN ⚡' : `${RARITY_META[currentPrize.rarity].label} PRIZE`}
                      </div>
                      <motion.div
                        className="my-3 text-6xl"
                        animate={reduceMotion ? undefined : { rotate: [-6, 6, -6] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                      >
                        {currentPrize.glyph}
                      </motion.div>
                      <div className="text-lg font-black uppercase leading-tight text-white">
                        {currentPrize.name}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
                        {currentPrize.blurb}
                      </p>
                      <div className="mt-3 font-mono text-xl font-black text-amber-300">
                        +{currentPrize.chips.toLocaleString()} CHIPS
                      </div>
                      <motion.button
                        data-testid="claw-prize-collect"
                        onClick={() => {
                          playArcadeSfx('catch_gold', { volume: 0.8 });
                          setPrizeQueue((q) => q.slice(1));
                        }}
                        whileTap={{ scale: 0.92 }}
                        className="mt-4 w-full rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-6 py-2.5 text-sm font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/40"
                      >
                        Stash It
                      </motion.button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── The haul (results) ── */}
              <AnimatePresence>
                {phase === 'over' && !currentPrize && (
                  <motion.div
                    className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    data-testid="claw-results"
                  >
                    <motion.div
                      className="w-full max-w-[300px] rounded-2xl border border-cyan-300/30 bg-gradient-to-b from-slate-900 to-black p-5 text-center shadow-[0_0_40px_-8px_rgba(55,229,255,0.4)]"
                      initial={reduceMotion ? {} : { scale: 0.7, y: 30 }}
                      animate={reduceMotion ? {} : { scale: 1, y: 0 }}
                      transition={springIn}
                    >
                      <div className="text-[10px] font-black tracking-[0.3em] text-cyan-300">
                        OUT OF TOKENS
                      </div>
                      <div className="mt-1 text-xl font-black uppercase italic text-white">
                        «{result ? haulTitle(result) : ''}»
                      </div>
                      <div className="mt-3 space-y-1 rounded-xl bg-black/40 p-3 text-left text-[12px]">
                        {(result?.prizes ?? []).map((p, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span>{p.glyph}</span>
                            <span className="flex-1 truncate text-slate-200">{p.name}</span>
                            <span className="font-mono font-bold text-amber-300">
                              {p.chips.toLocaleString()}
                            </span>
                          </div>
                        ))}
                        {(result?.prizes.length ?? 0) === 0 && (
                          <div className="text-center text-slate-400">
                            — the claw giveth not —
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-end justify-between px-1">
                        <span className="text-sm font-black text-slate-200">TOTAL</span>
                        <span className="font-mono text-2xl font-black text-amber-300" data-testid="claw-final-chips">
                          {(result?.chips ?? 0).toLocaleString()}
                        </span>
                      </div>
                      <motion.button
                        data-testid="claw-claim"
                        onClick={handleClaim}
                        disabled={claiming}
                        whileTap={{ scale: 0.92 }}
                        animate={reduceMotion || claiming ? undefined : { scale: [1, 1.05, 1] }}
                        transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
                        className="mt-4 w-full rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-6 py-2.5 text-sm font-black uppercase tracking-wider text-amber-950 shadow-lg shadow-amber-500/40 disabled:opacity-60"
                      >
                        {claiming
                          ? 'Claiming…'
                          : (result?.chips ?? 0) > 0
                            ? `Claim ${(result?.chips ?? 0).toLocaleString()} Chips`
                            : 'Back to the Arcade'}
                      </motion.button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Control deck ── */}
            {phase !== 'intro' && (
              <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-fuchsia-300/15 bg-black/60 px-4 py-3">
                <div className="flex justify-start">
                  <button
                    data-testid="claw-left"
                    aria-label="Move claw left"
                    disabled={phase !== 'playing'}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      holdDir(-1);
                    }}
                    onPointerUp={() => holdDir(0)}
                    onPointerLeave={() => holdDir(0)}
                    onPointerCancel={() => holdDir(0)}
                    onContextMenu={(e) => e.preventDefault()}
                    className="flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border border-cyan-300/40 bg-slate-800/90 text-2xl text-cyan-200 shadow-[0_0_14px_-4px_rgba(55,229,255,0.7)] active:bg-cyan-400/20 disabled:opacity-30"
                  >
                    ◀
                  </button>
                </div>
                <motion.button
                  data-testid="claw-drop"
                  onClick={handleDrop}
                  disabled={dropDisabled}
                  whileTap={dropDisabled ? undefined : { scale: 0.9 }}
                  animate={
                    reduceMotion || dropDisabled
                      ? { scale: 1, boxShadow: '0 0 0px rgba(255,60,60,0)' }
                      : {
                          scale: [1, 1.06, 1],
                          boxShadow: [
                            '0 0 18px rgba(255,60,60,0.5)',
                            '0 0 34px rgba(255,60,60,0.85)',
                            '0 0 18px rgba(255,60,60,0.5)',
                          ],
                        }
                  }
                  transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
                  className="touch-none select-none rounded-2xl border-2 border-red-300/50 bg-gradient-to-b from-red-500 to-red-800 px-8 py-4 text-base font-black uppercase tracking-[0.18em] text-white disabled:border-slate-600/40 disabled:from-slate-700 disabled:to-slate-800 disabled:text-slate-400"
                >
                  Drop Claw
                </motion.button>
                <div className="flex justify-end">
                  <button
                    data-testid="claw-right"
                    aria-label="Move claw right"
                    disabled={phase !== 'playing'}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      holdDir(1);
                    }}
                    onPointerUp={() => holdDir(0)}
                    onPointerLeave={() => holdDir(0)}
                    onPointerCancel={() => holdDir(0)}
                    onContextMenu={(e) => e.preventDefault()}
                    className="flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border border-cyan-300/40 bg-slate-800/90 text-2xl text-cyan-200 shadow-[0_0_14px_-4px_rgba(55,229,255,0.7)] active:bg-cyan-400/20 disabled:opacity-30"
                  >
                    ▶
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
