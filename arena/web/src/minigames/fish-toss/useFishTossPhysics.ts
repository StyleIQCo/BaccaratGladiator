// ═══════════════════════════════════════════════════════════════════
//  PIKE PLACE FISH TOSS — physics core.
//
//  Weekly-arcade mini-game: a monger at the market stall hurls fish
//  across the dock; the player slides the catcher up and down the
//  right edge to snag them. This hook owns the ENTIRE simulation —
//  ballistic throw arcs, the king salmon's mid-air flop, AABB catch
//  tests, scoring, and the 30-second clock.
//
//  Same performance contract as useHotdogPhysics (the template for
//  every arcade cabinet here):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: canvas mount, and game over via onGameOver.
//    • step() allocates nothing except caught/missed score popups.
//      Dead fish are compacted in place — no .filter() garbage.
//    • All motion is dt-based (px/sec) — 120 Hz ProMotion and a
//      throttled 30 fps Android play the identical game.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type FishKind =
  | 'sockeye'
  | 'herring'
  | 'rainbow_trout'
  | 'dungeness_crab'
  | 'king_salmon'
  | 'old_boot';
export type GameStatus = 'idle' | 'running' | 'over';
export type GameOverReason = 'time' | 'hazard';
export type HazardMode = 'end_run' | 'penalty';

export interface TossedFish {
  kind: FishKind;
  x: number;            // centre, logical px
  y: number;            // centre (post-flop — this is what you draw & collide)
  yBase: number;        // ballistic y; the king's flop oscillates around it
  vx: number;           // px/s rightward
  vy: number;           // px/s, gravity applies
  spin: number;         // cosmetic tumble, radians
  spinVel: number;      // rad/s
  flopPhase: number;    // king_salmon: mid-air panic-flop sine phase
  flopAmp: number;      //   px
  flopHz: number;       //   Hz
  seed: number;         // stable per-fish jitter for the renderer
  dead: boolean;        // caught, splatted, or sailed past; compacted after step()
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;   // seconds alive
  ttl: number;   // seconds until removed
}

export interface FishTossPhysicsOptions {
  runSeconds?: number;                // default 30
  hazardMode?: HazardMode;            // 'end_run' (default): the old boot kills the run
  onGameOver?: (finalScore: number, reason: GameOverReason) => void;
  /** Fired the frame something lands in the catcher's arms (boot included) —
   *  the renderer hangs celebration particles and phrases off this
   *  without any React state involved. */
  onCatch?: (kind: FishKind) => void;
  /** Fired when a catchable fish splats on the dock or sails past —
   *  drives the splash FX. */
  onMiss?: (kind: FishKind, x: number, y: number) => void;
}

// ── Tuning table ───────────────────────────────────────────────────
// Weights are spawn probabilities (sum ≈ 1). flightT is the base
// seconds a throw takes to cross the dock — shorter = faster = harder.
// w/h are per-kind AABBs: a herring is a sliver, a king is a log.

export const FISH_STATS: Record<
  FishKind,
  { weight: number; chips: number; flightT: number; flop: boolean; popupColor: string; w: number; h: number }
> = {
  sockeye:        { weight: 0.36, chips: 50,  flightT: 1.35, flop: false, popupColor: '#ffe066', w: 56, h: 22 },
  herring:        { weight: 0.18, chips: 100, flightT: 1.05, flop: false, popupColor: '#bfe8ff', w: 38, h: 14 },
  rainbow_trout:  { weight: 0.16, chips: 150, flightT: 1.20, flop: false, popupColor: '#ff9ecf', w: 54, h: 20 },
  dungeness_crab: { weight: 0.11, chips: 300, flightT: 1.30, flop: false, popupColor: '#ff9c6b', w: 44, h: 28 },
  king_salmon:    { weight: 0.11, chips: 500, flightT: 1.00, flop: true,  popupColor: '#ffb347', w: 74, h: 30 },
  old_boot:       { weight: 0.08, chips: 0,   flightT: 0.85, flop: false, popupColor: '#ff4d4d', w: 40, h: 36 },
};
const SPAWN_ORDER: FishKind[] = [
  'sockeye', 'herring', 'rainbow_trout', 'dungeness_crab', 'king_salmon', 'old_boot',
];

export const RUN_SECONDS_DEFAULT = 30;
export const THROWER_X_FRAC = 0.13;   // stall monger's hand, fraction of canvas width
export const CATCHER_X_FRAC = 0.86;   // catcher's chest line
export const CATCHER_W = 66;          // catch zone AABB — arms + belly
export const CATCHER_H = 100;
export const DOCK_H = 64;             // plank band at the bottom; fish splat above it
const GRAVITY = 560;                  // px/s²
const SPAWN_START = 1.15;             // seconds between throws at t=0…
const SPAWN_END = 0.45;               // …ramping to this by the final second
const MAX_FISH = 24;                  // hard cap — spawner skips a beat rather than flood
const PLAYER_EASE = 14;               // 1/s — how snappily the catcher chases the finger
const HAZARD_PENALTY = 250;           // chips lost in 'penalty' mode
const POPUP_TTL = 0.8;
const POPUP_RISE = 70;                // px/s

/** Single source of truth for the catcher's AABB — renderer and collision share it. */
export function getCatcherBox(canvasW: number, centerY: number) {
  return { cx: canvasW * CATCHER_X_FRAC, cy: centerY, w: CATCHER_W, h: CATCHER_H };
}

/** Where throws leave the stall — the renderer draws the thrower's hand here. */
export function getThrowerHand(canvasW: number, canvasH: number) {
  return { x: canvasW * THROWER_X_FRAC, y: canvasH - DOCK_H - booth(canvasH) };
}
const booth = (canvasH: number) => Math.min(120, canvasH * 0.24); // hand height above the dock

/** Centre-based AABB overlap. */
function aabb(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
}

function rollKind(): FishKind {
  let r = Math.random();
  for (const kind of SPAWN_ORDER) {
    r -= FISH_STATS[kind].weight;
    if (r <= 0) return kind;
  }
  return 'sockeye';
}

// ── The hook ───────────────────────────────────────────────────────

export interface FishTossPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  playerYRef: MutableRefObject<number>;      // smoothed catcher centre — draw this
  fishRef: MutableRefObject<TossedFish[]>;
  popupsRef: MutableRefObject<ScorePopup[]>;
  scoreRef: MutableRefObject<number>;
  caughtRef: MutableRefObject<number>;       // catchables landed — the "X fish" stat
  statusRef: MutableRefObject<GameStatus>;
  timeLeftRef: MutableRefObject<number>;     // seconds, clamped ≥ 0
  catchPulseRef: MutableRefObject<number>;   // 1 → 0 after each catch; drives score bounce
  throwPulseRef: MutableRefObject<number>;   // 1 → 0 after each throw; drives the wind-up arm
  hazardFlashRef: MutableRefObject<number>;  // 1 → 0 after catching the boot; red flash
  shakeRef: MutableRefObject<number>;        // seconds of screen shake remaining
  // Imperative API for the canvas component:
  start: (canvasW: number, canvasH: number) => void;
  step: (dt: number, canvasW: number, canvasH: number) => void;
  setPointerY: (y: number) => void;
  endRun: (reason: GameOverReason) => void;
}

export function useFishTossPhysics(opts: FishTossPhysicsOptions = {}): FishTossPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const playerYRef = useRef(0);
  const playerTargetYRef = useRef(0);
  const fishRef = useRef<TossedFish[]>([]);
  const popupsRef = useRef<ScorePopup[]>([]);
  const scoreRef = useRef(0);
  const caughtRef = useRef(0);
  const statusRef = useRef<GameStatus>('idle');
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const elapsedRef = useRef(0);
  const spawnClockRef = useRef(0);
  const catchPulseRef = useRef(0);
  const throwPulseRef = useRef(0);
  const hazardFlashRef = useRef(0);
  const shakeRef = useRef(0);

  const endRun = useCallback((reason: GameOverReason) => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    optsRef.current.onGameOver?.(scoreRef.current, reason);
  }, []);

  const start = useCallback((_canvasW: number, canvasH: number) => {
    fishRef.current.length = 0;
    popupsRef.current.length = 0;
    scoreRef.current = 0;
    caughtRef.current = 0;
    elapsedRef.current = 0;
    spawnClockRef.current = 0.6;        // one beat of empty air before the first throw
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    catchPulseRef.current = 0;
    throwPulseRef.current = 0;
    hazardFlashRef.current = 0;
    shakeRef.current = 0;
    playerYRef.current = canvasH * 0.5;
    playerTargetYRef.current = canvasH * 0.5;
    statusRef.current = 'running';
  }, []);

  const setPointerY = useCallback((y: number) => {
    playerTargetYRef.current = y;
  }, []);

  /**
   * One throw. Ballistics are solved backwards from where we want the
   * fish to ARRIVE: pick a target height on the catcher's line, then
   * vx = dx/T and vy₀ = (targetY - y₀)/T - G·T/2 make the arc land
   * there after T seconds. Difficulty ramps by shrinking T (faster
   * throws), never by making arcs unreadable.
   */
  const spawn = useCallback((canvasW: number, canvasH: number, progress: number) => {
    const fish = fishRef.current;
    if (fish.length >= MAX_FISH) return;

    const kind = rollKind();
    const st = FISH_STATS[kind];
    const hand = getThrowerHand(canvasW, canvasH);
    const dx = canvasW * CATCHER_X_FRAC - hand.x;
    const speedUp = 1 - 0.3 * progress;                       // ramps to 70% flight time
    const T = st.flightT * speedUp * (0.85 + Math.random() * 0.3);
    const targetY = 90 + Math.random() * (canvasH - DOCK_H - 130);
    const vx = dx / T;
    const vy = (targetY - hand.y) / T - (GRAVITY * T) / 2;

    throwPulseRef.current = 1;
    fish.push({
      kind,
      x: hand.x,
      y: hand.y,
      yBase: hand.y,
      vx,
      vy,
      spin: (Math.random() - 0.5) * 0.5,
      spinVel: kind === 'dungeness_crab'
        ? (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3)  // crabs cartwheel
        : (Math.random() - 0.5) * 1.8,
      flopPhase: Math.random() * Math.PI * 2,
      flopAmp: st.flop ? 18 + Math.random() * 18 : 0,
      flopHz: st.flop ? 1.6 + Math.random() * 1.0 : 0,
      seed: Math.random() * 1000,
      dead: false,
    });
  }, []);

  const step = useCallback((dt: number, canvasW: number, canvasH: number) => {
    if (statusRef.current !== 'running') return;
    // Tab-switch / hitch protection: a 3-second background pause must not
    // teleport every fish through the catcher in one frame.
    dt = Math.min(dt, 0.05);

    // ── Clock ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);

    // ── Player: exponential ease toward the finger (frame-rate independent) ──
    const halfH = CATCHER_H / 2 + 6;
    const target = Math.min(Math.max(playerTargetYRef.current, halfH), canvasH - DOCK_H - halfH * 0.4);
    playerYRef.current += (target - playerYRef.current) * (1 - Math.exp(-PLAYER_EASE * dt));

    // ── Spawner: interval ramps down over the run (difficulty curve) ──
    spawnClockRef.current -= dt;
    const progress = Math.min(elapsedRef.current / runSeconds, 1);
    while (spawnClockRef.current <= 0) {
      spawn(canvasW, canvasH, progress);
      const base = SPAWN_START + (SPAWN_END - SPAWN_START) * progress;
      spawnClockRef.current += base * (0.8 + Math.random() * 0.4); // ±20% jitter
    }

    // ── Fish: ballistics, flop, catch test ──
    const box = getCatcherBox(canvasW, playerYRef.current);
    const fish = fishRef.current;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const st = FISH_STATS[f.kind];
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.yBase += f.vy * dt;
      f.spin += f.spinVel * dt;

      if (f.flopAmp > 0) {
        // Primary sine + a faster quarter-amplitude sine = a king salmon
        // fighting for its life in mid-air.
        f.flopPhase += Math.PI * 2 * f.flopHz * dt;
        f.y = f.yBase
          + Math.sin(f.flopPhase) * f.flopAmp
          + Math.sin(f.flopPhase * 2.7) * f.flopAmp * 0.35;
      } else {
        f.y = f.yBase;
      }

      // Missed: splatted on the dock, or sailed past the catcher.
      if (f.y > canvasH - DOCK_H + 8 || f.x > canvasW + st.w) {
        f.dead = true;
        if (f.kind !== 'old_boot') {
          optsRef.current.onMiss?.(f.kind, Math.min(f.x, canvasW - 20), Math.min(f.y, canvasH - DOCK_H + 8));
        }
        continue;
      }

      if (aabb(f.x, f.y, st.w, st.h, box.cx, box.cy, box.w, box.h)) {
        f.dead = true;
        if (f.kind === 'old_boot') {
          optsRef.current.onCatch?.('old_boot');
          hazardFlashRef.current = 1;
          shakeRef.current = 0.4;
          if ((optsRef.current.hazardMode ?? 'end_run') === 'end_run') {
            popupsRef.current.push({ x: f.x, y: f.y, text: 'THE BOOT!', color: st.popupColor, age: 0, ttl: POPUP_TTL });
            endRun('hazard');
            return; // run is over — freeze the world this exact frame
          }
          scoreRef.current = Math.max(0, scoreRef.current - HAZARD_PENALTY);
          popupsRef.current.push({ x: f.x, y: f.y, text: `-${HAZARD_PENALTY}`, color: st.popupColor, age: 0, ttl: POPUP_TTL });
        } else {
          scoreRef.current += st.chips;
          caughtRef.current += 1;
          catchPulseRef.current = 1;
          popupsRef.current.push({ x: f.x, y: f.y, text: `+${st.chips}`, color: st.popupColor, age: 0, ttl: POPUP_TTL });
          optsRef.current.onCatch?.(f.kind);
        }
      }
    }

    // In-place compaction — zero garbage, order preserved.
    let write = 0;
    for (let i = 0; i < fish.length; i++) {
      if (!fish[i].dead) fish[write++] = fish[i];
    }
    fish.length = write;

    // ── Popups drift up and fade; same compaction trick ──
    const popups = popupsRef.current;
    for (let i = 0; i < popups.length; i++) {
      popups[i].age += dt;
      popups[i].y -= POPUP_RISE * dt;
    }
    write = 0;
    for (let i = 0; i < popups.length; i++) {
      if (popups[i].age < popups[i].ttl) popups[write++] = popups[i];
    }
    popups.length = write;

    // ── Juice decay ──
    catchPulseRef.current = Math.max(0, catchPulseRef.current - dt * 3.5);
    throwPulseRef.current = Math.max(0, throwPulseRef.current - dt * 2.8);
    hazardFlashRef.current = Math.max(0, hazardFlashRef.current - dt * 2.5);
    shakeRef.current = Math.max(0, shakeRef.current - dt);

    if (timeLeftRef.current <= 0) endRun('time');
  }, [spawn, endRun]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<FishTossPhysics>(() => ({
    playerYRef, fishRef, popupsRef, scoreRef, caughtRef, statusRef, timeLeftRef,
    catchPulseRef, throwPulseRef, hazardFlashRef, shakeRef,
    start, step, setPointerY, endRun,
  }), [start, step, setPointerY, endRun]);
}
