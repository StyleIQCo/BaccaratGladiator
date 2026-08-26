// ═══════════════════════════════════════════════════════════════════
//  PIKE ST. BARISTA RUSH — physics core.
//
//  Emerald City Arcade cabinet #9: a 60-second morning-rush time-
//  management loop. Every drink is a three-station assembly line —
//  TAMP (precision tap on a swinging pressure needle), PULL (tension
//  hold: release the valve the instant the espresso kisses the etched
//  line — overfill and the drink is RUINED), ART (trace the glowing
//  latte-art stencil before the foam settles). Perfect drinks stack a
//  Caffeine Rush multiplier; a ruined drink dumps it to ×1.
//
//  This hook owns the ENTIRE simulation — the stage state machine,
//  needle oscillation, valve/fill dynamics, stencil-trace scoring,
//  grading, the combo, and the shift clock.
//
//  Same performance contract as useRainierPhysics / useHotdogPhysics
//  (the template for every arcade cabinet here):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: canvas mount, and game over via onGameOver.
//      (The wrapper may opt into a 4 Hz onHudTick for its DOM receipt
//      — that renders the wrapper, never the canvas.)
//    • step() allocates nothing except stroke points and the drink
//      log. Stencil matching is incremental — O(64) per stroke point,
//      O(1) at judge time.
//    • All motion is dt-based — the shared useArcadeEngine feeds this
//      a fixed 1/60 s step, but the hook stays correct at any dt.
//
//  Coordinates: latte-art stroke points arrive in CUP-UNIT space —
//  (0,0) = cup centre, radius 1 = cup rim, +y down. The canvas layer
//  owns the pixel↔unit conversion; this hook never sees a pixel.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type GameStatus = 'idle' | 'running' | 'over';
export type BaristaStage = 'tamp' | 'pull' | 'art' | 'serve';
/** Per-station result: perfect = green, good = close, weak = whiffed. */
export type StageQuality = 'perfect' | 'good' | 'weak';
export type DrinkGrade = 'perfect' | 'good' | 'slop' | 'ruined';
export type LatteArtKind = 'heart' | 'rosetta';

export interface Pt {
  x: number;
  y: number;
}

export interface DrinkLogEntry {
  name: string;    // "OAT LATTE" — printed on the end-of-shift receipt
  grade: DrinkGrade;
  chips: number;   // already multiplied by the combo at serve time
}

export interface StampState {
  text: string;    // "PERFECT POUR!"
  sub: string;     // "+500 CHIPS"
  color: string;
  age: number;     // seconds since slammed down
  ttl: number;
}

export interface BaristaPhysicsOptions {
  runSeconds?: number;                 // default 60 — the shift clock
  onGameOver?: (
    finalScore: number,
    drinksServed: number,
    perfectCount: number,
    log: DrinkLogEntry[],
  ) => void;
  /** A new drink hits a station (also fires on the first drink). */
  onStageChange?: (stage: BaristaStage, orderNo: number) => void;
  onTamp?: (quality: StageQuality) => void;
  /** The valve opens — start the steam hiss. */
  onPullStart?: () => void;
  /** The valve closes cleanly — kill the hiss, play the grade note. */
  onPullEnd?: (quality: StageQuality) => void;
  /** The cup overflowed mid-hold. The drink is already ruined. */
  onOverflow?: () => void;
  /** Finger down on the foam — start the pour loop. */
  onArtStrokeStart?: () => void;
  /** Finger up / foam settled — stop the pour loop. */
  onArtStrokeEnd?: () => void;
  onServe?: (grade: DrinkGrade, chips: number, comboAfter: number) => void;
  /** Fired once at 5,4,3,2,1 seconds on the shift clock. */
  onCountdownTick?: (secondsLeft: number) => void;
  /** Low-rate (4 Hz) HUD feed for the wrapper's DOM receipt printer. */
  onHudTick?: (timeLeft: number, score: number, combo: number) => void;
}

// ── Tuning table ───────────────────────────────────────────────────

export const RUN_SECONDS_DEFAULT = 60;

// Stage intros: input is gated this long after a station change so the
// tap that finished the previous station can't bleed into the next.
const INTRO_TAMP = 0.55;   // the grinder buzzes through this beat
const INTRO_PULL = 0.35;
const INTRO_ART = 0.35;
const STAGE_INTRO: Record<BaristaStage, number> = {
  tamp: INTRO_TAMP, pull: INTRO_PULL, art: INTRO_ART, serve: 0,
};

const TAMP_LINGER = 0.55;  // frozen needle + verdict before the shot pull
const PULL_LINGER = 0.6;   // crema settles before the art station
export const SERVE_SECONDS = 1.15; // stamp on screen, then next order

// Stage 1 — the needle. value = sin(phase) ∈ [-1, 1] across the dial.
const NEEDLE_HZ_START = 0.85;  // full sweeps/sec on drink #1…
const NEEDLE_HZ_RAMP = 0.08;   // …+ this per drink served…
const NEEDLE_HZ_MAX = 1.5;     // …capped here
export const TAMP_GREEN_HALF = 0.1;   // |err| ≤ this = perfect
export const TAMP_YELLOW_HALF = 0.28; // |err| ≤ this = good, beyond = weak
const ZONE_RANGE = 0.55;       // green-zone centre drawn from ±this

// Stage 2 — the shot. fill ∈ [0, 1] where 1 = the brim (= overflow).
const FILL_RATE_BASE = 0.42;   // fill fraction/sec at full valve
const FILL_RATE_RAMP = 0.045;  // per drink served, ×1.35 cap
const FILL_RATE_MAX_MULT = 1.35;
const VALVE_EASE = 9;          // 1/s — valve spin-up (the first drips lag)
const TARGET_MIN = 0.55;       // etched line drawn per-drink from…
const TARGET_MAX = 0.74;       // …this range
export const PULL_PERFECT = 0.025; // |fill-target| ≤ this = perfect (~60 ms)
export const PULL_GOOD = 0.075;

// Stage 3 — the art. Stencils live in cup-unit space, rim = radius 1.
export const STENCIL_SAMPLES = 64;
export const ART_MATCH_R = 0.17;  // a stroke point "lights" stencil samples within this
const ART_PRECISION_DEV = 0.22;   // mean off-path distance for precision → 0
const ART_MIN_POINTS = 8;         // lifting earlier than this doesn't commit the pour
const STROKE_MIN_STEP = 0.035;    // unit-space throttle between stored points
const STROKE_MAX_POINTS = 220;
const FOAM_SECONDS_START = 5.5;   // settle timer on drink #1…
const FOAM_SECONDS_RAMP = 0.2;    // …− this per drink served…
const FOAM_SECONDS_MIN = 3.8;     // …floored here
const ART_COVERAGE_AUTOJUDGE = 0.98; // finish the pour instantly when traced

// Grading & pay. Chips = base × combo, rounded to 5.
export const CHIPS_BY_GRADE: Record<DrinkGrade, number> = {
  perfect: 500, good: 250, slop: 50, ruined: 0,
};
const COMBO_STEP = 0.5;    // perfect drink → +0.5×…
const COMBO_MAX = 3;       // …capped at ×3 CAFFEINE RUSH
const COMBO_SLOP_DROP = 0.5; // slop bleeds the rush; ruined dumps it to ×1

const ORDER_NAMES = [
  'OAT LATTE', 'CAPPUCCINO', 'FLAT WHITE', 'DOUBLE MOCHA', 'MACCHIATO',
  'DIRTY CHAI', 'HONEY LATTE', 'CORTADO', 'PUMPKIN SPICE', 'TRIPLE RISTRETTO',
];

// ── Stencils (module-load precomputed, shared with the renderer) ───

function buildHeart(): Pt[] {
  // The classic parametric heart, flipped for canvas +y-down (point at
  // the bottom) and scaled to sit inside the crema with rim margin.
  const pts: Pt[] = [];
  for (let i = 0; i < STENCIL_SAMPLES; i++) {
    const t = (i / (STENCIL_SAMPLES - 1)) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push({ x: x * 0.045, y: (y - 5) * 0.045 });
  }
  return pts;
}

function buildRosetta(): Pt[] {
  // A fern: serpentine wiggles that tighten toward the tail, then the
  // pull-through stroke straight back up the spine.
  const pts: Pt[] = [];
  const wiggle = 54;
  for (let i = 0; i < wiggle; i++) {
    const s = i / (wiggle - 1);
    pts.push({ x: 0.44 * Math.sin(s * Math.PI * 5) * (1 - 0.6 * s), y: -0.66 + 1.32 * s });
  }
  const tail = STENCIL_SAMPLES - wiggle;
  for (let i = 0; i < tail; i++) {
    const s = i / (tail - 1);
    pts.push({ x: 0, y: 0.66 - 1.42 * s });
  }
  return pts;
}

export const STENCILS: Record<LatteArtKind, Pt[]> = {
  heart: buildHeart(),
  rosetta: buildRosetta(),
};

// ── The hook ───────────────────────────────────────────────────────

export interface BaristaPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  statusRef: MutableRefObject<GameStatus>;
  stageRef: MutableRefObject<BaristaStage>;
  stageClockRef: MutableRefObject<number>;      // seconds since this station started
  resultLingerRef: MutableRefObject<number>;    // >0 = verdict frozen on screen
  timeLeftRef: MutableRefObject<number>;        // shift clock, clamped ≥ 0
  scoreRef: MutableRefObject<number>;           // chips
  comboRef: MutableRefObject<number>;           // ×1 … ×3 CAFFEINE RUSH
  orderNoRef: MutableRefObject<number>;         // 1-based, the ticket number
  orderNameRef: MutableRefObject<string>;       // "OAT LATTE" — drawn on the ticket
  drinksServedRef: MutableRefObject<number>;
  perfectCountRef: MutableRefObject<number>;
  // Tamp:
  needleValueRef: MutableRefObject<number>;     // -1 … 1 (frozen once judged)
  zoneCenterRef: MutableRefObject<number>;
  tampJudgedRef: MutableRefObject<boolean>;
  tampQualityRef: MutableRefObject<StageQuality>;
  // Pull:
  fillRef: MutableRefObject<number>;            // 0 … 1 (1 = brim)
  targetFillRef: MutableRefObject<number>;      // the etched line
  valveRef: MutableRefObject<number>;           // 0 … 1 openness — drives drip FX
  pullJudgedRef: MutableRefObject<boolean>;
  pullQualityRef: MutableRefObject<StageQuality>;
  // Art:
  artKindRef: MutableRefObject<LatteArtKind>;
  strokeRef: MutableRefObject<Pt[]>;            // player pour path, cup-unit space
  matchedRef: MutableRefObject<Uint8Array>;     // per stencil sample: lit by the trace?
  coverageRef: MutableRefObject<number>;        // 0 … 1, live
  foamLeftRef: MutableRefObject<number>;        // seconds until the foam settles
  strokeActiveRef: MutableRefObject<boolean>;
  // Juice:
  stampRef: MutableRefObject<StampState | null>;
  tampPulseRef: MutableRefObject<number>;       // 1 → 0 after the ka-chunk
  servePulseRef: MutableRefObject<number>;      // 1 → 0 after a serve; score bounce
  ruinFlashRef: MutableRefObject<number>;       // 1 → 0 red wash after an overflow
  shakeRef: MutableRefObject<number>;           // seconds of screen shake remaining
  // Imperative API for the canvas component:
  start: () => void;
  step: (dt: number) => void;
  /** Pointer down. (x, y) in cup-unit space — only the art station reads them. */
  press: (x: number, y: number) => void;
  /** Pointer move — feeds the art trace while a stroke is active. */
  moveTo: (x: number, y: number) => void;
  /** Pointer up — judges the shot pull, commits the pour. */
  release: () => void;
}

export function useBaristaPhysics(opts: BaristaPhysicsOptions = {}): BaristaPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const statusRef = useRef<GameStatus>('idle');
  const stageRef = useRef<BaristaStage>('tamp');
  const stageClockRef = useRef(0);
  const resultLingerRef = useRef(0);
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const scoreRef = useRef(0);
  const comboRef = useRef(1);
  const orderNoRef = useRef(1);
  const orderNameRef = useRef(ORDER_NAMES[0]);
  const drinksServedRef = useRef(0);
  const perfectCountRef = useRef(0);

  const needleValueRef = useRef(0);
  const zoneCenterRef = useRef(0);
  const tampJudgedRef = useRef(false);
  const tampQualityRef = useRef<StageQuality>('weak');

  const fillRef = useRef(0);
  const targetFillRef = useRef(0.62);
  const valveRef = useRef(0);
  const pullJudgedRef = useRef(false);
  const pullQualityRef = useRef<StageQuality>('weak');

  const artKindRef = useRef<LatteArtKind>('heart');
  const strokeRef = useRef<Pt[]>([]);
  const matchedRef = useRef(new Uint8Array(STENCIL_SAMPLES));
  const coverageRef = useRef(0);
  const foamLeftRef = useRef(FOAM_SECONDS_START);
  const strokeActiveRef = useRef(false);

  const stampRef = useRef<StampState | null>(null);
  const tampPulseRef = useRef(0);
  const servePulseRef = useRef(0);
  const ruinFlashRef = useRef(0);
  const shakeRef = useRef(0);

  // Internal (not exposed — the renderer has no business here):
  const elapsedRef = useRef(0);
  const needlePhaseRef = useRef(0);
  const holdingRef = useRef(false);       // finger down on the valve
  const valveOpenedRef = useRef(false);   // the one-shot pull has begun
  const matchedCountRef = useRef(0);
  const precSumRef = useRef(0);           // Σ min-dist(stroke pt → stencil) for precision
  const artJudgedRef = useRef(false);
  const ruinedRef = useRef(false);
  const lastTickSecRef = useRef(-1);
  const hudAccRef = useRef(0);
  const logRef = useRef<DrinkLogEntry[]>([]);

  const setStage = useCallback((stage: BaristaStage) => {
    stageRef.current = stage;
    stageClockRef.current = 0;
    resultLingerRef.current = 0;
    optsRef.current.onStageChange?.(stage, orderNoRef.current);
  }, []);

  /** Reset per-drink state and put the next ticket on the rail. */
  const nextDrink = useCallback(() => {
    const served = drinksServedRef.current;
    orderNoRef.current = served + 1;
    orderNameRef.current = ORDER_NAMES[served % ORDER_NAMES.length];

    tampJudgedRef.current = false;
    needlePhaseRef.current = Math.random() * Math.PI * 2;
    needleValueRef.current = Math.sin(needlePhaseRef.current);
    zoneCenterRef.current = (Math.random() * 2 - 1) * ZONE_RANGE;

    fillRef.current = 0;
    valveRef.current = 0;
    holdingRef.current = false;
    valveOpenedRef.current = false;
    pullJudgedRef.current = false;
    targetFillRef.current = TARGET_MIN + Math.random() * (TARGET_MAX - TARGET_MIN);

    artKindRef.current = served % 2 === 0 ? 'heart' : 'rosetta';
    strokeRef.current.length = 0;
    matchedRef.current.fill(0);
    matchedCountRef.current = 0;
    precSumRef.current = 0;
    coverageRef.current = 0;
    strokeActiveRef.current = false;
    artJudgedRef.current = false;
    foamLeftRef.current = Math.max(FOAM_SECONDS_MIN, FOAM_SECONDS_START - served * FOAM_SECONDS_RAMP);

    ruinedRef.current = false;
    stampRef.current = null;
    setStage('tamp');
  }, [setStage]);

  const endRun = useCallback(() => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    strokeActiveRef.current = false;
    optsRef.current.onGameOver?.(
      scoreRef.current,
      drinksServedRef.current,
      perfectCountRef.current,
      logRef.current.slice(),
    );
  }, []);

  /** Grade the finished drink, pay out, slam the stamp, queue the next order. */
  const serveDrink = useCallback((grade: DrinkGrade) => {
    const chips = Math.round((CHIPS_BY_GRADE[grade] * comboRef.current) / 5) * 5;
    scoreRef.current += chips;
    drinksServedRef.current += 1;
    if (grade === 'perfect') perfectCountRef.current += 1;
    logRef.current.push({ name: orderNameRef.current, grade, chips });

    // Pay at the CURRENT rush, then adjust it — a perfect builds the
    // multiplier for the drinks that follow, per the Caffeine Rush rules.
    if (grade === 'perfect') comboRef.current = Math.min(COMBO_MAX, comboRef.current + COMBO_STEP);
    else if (grade === 'slop') comboRef.current = Math.max(1, comboRef.current - COMBO_SLOP_DROP);
    else if (grade === 'ruined') comboRef.current = 1;

    const STAMP: Record<DrinkGrade, [string, string]> = {
      perfect: ['PERFECT POUR!', '#3ddc84'],
      good: ['GOOD CUP', '#ffd23f'],
      slop: ['SLOPPY…', '#ff8c5a'],
      ruined: ['RUINED!', '#ff4d4d'],
    };
    stampRef.current = {
      text: STAMP[grade][0],
      sub: chips > 0 ? `+${chips.toLocaleString()} CHIPS` : 'NO TIP',
      color: STAMP[grade][1],
      age: 0,
      ttl: SERVE_SECONDS,
    };
    servePulseRef.current = 1;
    optsRef.current.onServe?.(grade, chips, comboRef.current);
    setStage('serve');
  }, [setStage]);

  const judgeTamp = useCallback(() => {
    tampJudgedRef.current = true; // needle freezes at the hit value
    const err = Math.abs(needleValueRef.current - zoneCenterRef.current);
    tampQualityRef.current = err <= TAMP_GREEN_HALF ? 'perfect' : err <= TAMP_YELLOW_HALF ? 'good' : 'weak';
    if (tampQualityRef.current === 'weak') shakeRef.current = 0.25;
    tampPulseRef.current = 1;
    resultLingerRef.current = TAMP_LINGER;
    optsRef.current.onTamp?.(tampQualityRef.current);
  }, []);

  const judgePull = useCallback(() => {
    pullJudgedRef.current = true;
    const err = Math.abs(fillRef.current - targetFillRef.current);
    pullQualityRef.current = err <= PULL_PERFECT ? 'perfect' : err <= PULL_GOOD ? 'good' : 'weak';
    resultLingerRef.current = PULL_LINGER;
    optsRef.current.onPullEnd?.(pullQualityRef.current);
  }, []);

  const ruinDrink = useCallback(() => {
    // Overflow mid-hold: the shot floods the tray, the art never happens.
    pullJudgedRef.current = true;
    ruinedRef.current = true;
    holdingRef.current = false;
    ruinFlashRef.current = 1;
    shakeRef.current = 0.5;
    optsRef.current.onOverflow?.();
    serveDrink('ruined');
  }, [serveDrink]);

  const judgeArt = useCallback(() => {
    if (artJudgedRef.current) return;
    artJudgedRef.current = true;
    if (strokeActiveRef.current) {
      strokeActiveRef.current = false;
      optsRef.current.onArtStrokeEnd?.();
    }
    const n = strokeRef.current.length;
    let quality: StageQuality = 'weak';
    if (n > 0) {
      const coverage = matchedCountRef.current / STENCIL_SAMPLES;
      const precision = 1 - Math.min(1, precSumRef.current / n / ART_PRECISION_DEV);
      const acc = coverage * 0.65 + precision * 0.35;
      quality = acc >= 0.8 ? 'perfect' : acc >= 0.5 ? 'good' : 'weak';
    }

    // Drink grade: perfect at every station = PERFECT. One whiff is
    // forgivable if the rest held up; two is slop. (Overflow never
    // reaches here — ruinDrink() short-circuits the art station.)
    const pts = (q: StageQuality) => (q === 'perfect' ? 2 : q === 'good' ? 1 : 0);
    const total = pts(tampQualityRef.current) + pts(pullQualityRef.current) + pts(quality);
    serveDrink(total >= 6 ? 'perfect' : total >= 3 ? 'good' : 'slop');
  }, [serveDrink]);

  /** Store a pour point (throttled) and light up stencil samples near it. */
  const addStrokePoint = useCallback((x: number, y: number) => {
    const stroke = strokeRef.current;
    if (stroke.length >= STROKE_MAX_POINTS) return;
    const last = stroke[stroke.length - 1];
    if (last) {
      const dx = x - last.x, dy = y - last.y;
      if (dx * dx + dy * dy < STROKE_MIN_STEP * STROKE_MIN_STEP) return;
    }
    stroke.push({ x, y });

    const stencil = STENCILS[artKindRef.current];
    const matched = matchedRef.current;
    const r2 = ART_MATCH_R * ART_MATCH_R;
    let best = Infinity;
    for (let i = 0; i < STENCIL_SAMPLES; i++) {
      const dx = stencil[i].x - x, dy = stencil[i].y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
      if (matched[i] === 0 && d2 < r2) {
        matched[i] = 1;
        matchedCountRef.current++;
      }
    }
    precSumRef.current += Math.sqrt(best);
    coverageRef.current = matchedCountRef.current / STENCIL_SAMPLES;

    // Traced the whole stencil? Serve it hot — no waiting on the foam.
    if (coverageRef.current >= ART_COVERAGE_AUTOJUDGE) judgeArt();
  }, [judgeArt]);

  const start = useCallback(() => {
    statusRef.current = 'running';
    elapsedRef.current = 0;
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    scoreRef.current = 0;
    comboRef.current = 1;
    drinksServedRef.current = 0;
    perfectCountRef.current = 0;
    logRef.current.length = 0;
    lastTickSecRef.current = -1;
    hudAccRef.current = 0;
    tampPulseRef.current = 0;
    servePulseRef.current = 0;
    ruinFlashRef.current = 0;
    shakeRef.current = 0;
    nextDrink();
  }, [nextDrink]);

  const press = useCallback((x: number, y: number) => {
    if (statusRef.current !== 'running') return;
    if (resultLingerRef.current > 0) return;
    const stage = stageRef.current;
    if (stageClockRef.current < STAGE_INTRO[stage]) return;
    if (stage === 'tamp') {
      if (!tampJudgedRef.current) judgeTamp();
    } else if (stage === 'pull') {
      // One-shot: the valve opens on the first press and the release
      // judges it. A second press after bailing early does nothing —
      // there is no creeping up to the line in sips.
      if (!valveOpenedRef.current && !pullJudgedRef.current) {
        valveOpenedRef.current = true;
        holdingRef.current = true;
        optsRef.current.onPullStart?.();
      }
    } else if (stage === 'art') {
      if (!artJudgedRef.current) {
        if (!strokeActiveRef.current) {
          strokeActiveRef.current = true;
          optsRef.current.onArtStrokeStart?.();
        }
        addStrokePoint(x, y);
      }
    }
  }, [judgeTamp, addStrokePoint]);

  const moveTo = useCallback((x: number, y: number) => {
    if (statusRef.current !== 'running') return;
    if (stageRef.current === 'art' && strokeActiveRef.current && !artJudgedRef.current) {
      addStrokePoint(x, y);
    }
  }, [addStrokePoint]);

  const release = useCallback(() => {
    if (statusRef.current !== 'running') return;
    const stage = stageRef.current;
    if (stage === 'pull') {
      if (valveOpenedRef.current && !pullJudgedRef.current) {
        holdingRef.current = false;
        judgePull();
      }
    } else if (stage === 'art') {
      if (strokeActiveRef.current && !artJudgedRef.current) {
        strokeActiveRef.current = false;
        optsRef.current.onArtStrokeEnd?.();
        // Lifting with a real pour behind it commits the drink; a
        // stray micro-touch doesn't — draw again while the foam holds.
        if (strokeRef.current.length >= ART_MIN_POINTS) judgeArt();
      }
    }
  }, [judgePull, judgeArt]);

  const step = useCallback((dt: number) => {
    if (statusRef.current !== 'running') return;
    // The engine feeds fixed 1/60 steps, but stay hitch-safe anyway.
    dt = Math.min(dt, 0.05);

    // ── Shift clock ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);

    const wholeSec = Math.ceil(timeLeftRef.current);
    if (wholeSec <= 5 && wholeSec >= 1 && wholeSec !== lastTickSecRef.current) {
      lastTickSecRef.current = wholeSec;
      optsRef.current.onCountdownTick?.(wholeSec);
    }

    hudAccRef.current += dt;
    if (hudAccRef.current >= 0.25) {
      hudAccRef.current = 0;
      optsRef.current.onHudTick?.(timeLeftRef.current, scoreRef.current, comboRef.current);
    }

    // ── Juice decay ──
    stageClockRef.current += dt;
    if (stampRef.current) stampRef.current.age += dt;
    tampPulseRef.current = Math.max(0, tampPulseRef.current - dt * 4);
    servePulseRef.current = Math.max(0, servePulseRef.current - dt * 3);
    ruinFlashRef.current = Math.max(0, ruinFlashRef.current - dt * 2.2);
    shakeRef.current = Math.max(0, shakeRef.current - dt);

    // ── Station logic ──
    const stage = stageRef.current;
    if (stage === 'tamp') {
      if (!tampJudgedRef.current) {
        const hz = Math.min(NEEDLE_HZ_MAX, NEEDLE_HZ_START + drinksServedRef.current * NEEDLE_HZ_RAMP);
        needlePhaseRef.current += dt * Math.PI * 2 * hz;
        needleValueRef.current = Math.sin(needlePhaseRef.current);
      } else {
        resultLingerRef.current -= dt;
        if (resultLingerRef.current <= 0) setStage('pull');
      }
    } else if (stage === 'pull') {
      // Valve openness chases the hold state — the first drips lag the
      // press, and the stream chokes off just after release.
      const want = holdingRef.current && !pullJudgedRef.current ? 1 : 0;
      valveRef.current += (want - valveRef.current) * (1 - Math.exp(-VALVE_EASE * dt));
      if (valveOpenedRef.current && !pullJudgedRef.current) {
        const mult = Math.min(FILL_RATE_MAX_MULT, 1 + drinksServedRef.current * FILL_RATE_RAMP);
        fillRef.current += FILL_RATE_BASE * mult * valveRef.current * dt;
        if (fillRef.current >= 1) {
          fillRef.current = 1;
          ruinDrink();
          return;
        }
      }
      if (pullJudgedRef.current) {
        resultLingerRef.current -= dt;
        if (resultLingerRef.current <= 0) setStage('art');
      }
    } else if (stage === 'art') {
      if (!artJudgedRef.current && stageClockRef.current > INTRO_ART) {
        foamLeftRef.current -= dt;
        if (foamLeftRef.current <= 0) {
          foamLeftRef.current = 0;
          judgeArt(); // the foam settled — judge whatever made it in
        }
      }
    } else {
      // 'serve' — the stamp holds the frame, then the next ticket drops.
      if (stageClockRef.current >= SERVE_SECONDS) nextDrink();
    }

    // ── Closing time ── (after station logic so a final serve pays out)
    if (timeLeftRef.current <= 0) endRun();
  }, [setStage, nextDrink, ruinDrink, judgeArt, endRun]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<BaristaPhysics>(() => ({
    statusRef, stageRef, stageClockRef, resultLingerRef, timeLeftRef,
    scoreRef, comboRef, orderNoRef, orderNameRef, drinksServedRef, perfectCountRef,
    needleValueRef, zoneCenterRef, tampJudgedRef, tampQualityRef,
    fillRef, targetFillRef, valveRef, pullJudgedRef, pullQualityRef,
    artKindRef, strokeRef, matchedRef, coverageRef, foamLeftRef, strokeActiveRef,
    stampRef, tampPulseRef, servePulseRef, ruinFlashRef, shakeRef,
    start, step, press, moveTo, release,
  }), [start, step, press, moveTo, release]);
}
