// ═══════════════════════════════════════════════════════════════════
//  SALISH SEA WHALE WATCH — physics core.
//
//  Precision-timing cabinet: shadows glide in from the deep, surge
//  toward the surface, and breach on a parabola. The player paddles
//  the canoe along the bottom, HOLDS to raise a spotting ring, and
//  RELEASES at the exact apex of the jump — graded on how close the
//  breacher's vertical velocity was to zero at the moment of release.
//
//  Same performance contract as useFishTossPhysics / useHotdogPhysics
//  (the template for every arcade cabinet here):
//    • Every per-frame value lives in a ref. React renders exactly
//      twice per run: canvas mount, and game over via onGameOver.
//    • step() allocates nothing except score popups. Finished
//      sightings are compacted in place — no .filter() garbage.
//    • All motion is dt-based (px/sec) — 120 Hz ProMotion and a
//      throttled 30 fps Android play the identical game.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type MarineKind = 'porpoise' | 'orca' | 'humpback';
export type SightingPhase = 'approach' | 'airborne';
export type GameStatus = 'idle' | 'running' | 'over';
export type Grade = 'perfect' | 'good' | 'miss';

export interface Sighting {
  kind: MarineKind;
  phase: SightingPhase;
  x: number;            // centre, logical px (drifts slowly on approach)
  y: number;            // approach: shadow depth · airborne: body centre
  vy: number;           // px/s while airborne; negative = rising
  scale: number;        // 0.2 (deep background) → 1.0 (at the surface)
  approachAge: number;  // seconds since the shadow appeared
  approachDur: number;  // seconds of warning before the breach
  driftVx: number;      // px/s sideways wander during the approach
  launchSpeed: number;  // |vy| at launch — grade windows are fractions of it
  attempted: boolean;   // one graded release per breach, spent or not
  seed: number;         // stable per-sighting jitter for the renderer
  dead: boolean;        // splashed down; compacted after step()
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;   // seconds alive
  ttl: number;   // seconds until removed
}

export interface RunStats {
  perfects: number;
  goods: number;
  misses: number;          // held-and-released attempts that flubbed the timing
  missedSightings: number; // breaches that came and went with no attempt
}

export interface WhaleWatchPhysicsOptions {
  runSeconds?: number;                 // default 45 — then the sun is down
  onGameOver?: (finalScore: number, stats: RunStats) => void;
  /** A shadow just slid into view — the canvas cues the call/clicks here. */
  onShadow?: (kind: MarineKind, x: number) => void;
  /** The breach launched — splash-out FX + whoosh. */
  onBreach?: (kind: MarineKind, x: number) => void;
  /** Re-entry splash. Fires whether or not the player attempted it. */
  onSplashdown?: (kind: MarineKind, x: number) => void;
  /** A graded release. Perfect drives the cyan ripple + chime. */
  onResult?: (grade: Grade, kind: MarineKind, chips: number, x: number, y: number) => void;
}

// ── Tuning table ───────────────────────────────────────────────────
// Weights are spawn probabilities (sum ≈ 1). launchSpeed/gravity shape
// the arc; `hang` < 1 softens gravity near the apex so the jump
// visibly floats there (the humpback's whole gimmick). w/h are the
// silhouette box at scale 1 — the renderer and the ring test share it.

export const MARINE_STATS: Record<
  MarineKind,
  {
    weight: number; chips: number; launchSpeed: number; gravity: number;
    hang: number; approachDur: number; w: number; h: number; popupColor: string;
  }
> = {
  porpoise: { weight: 0.50, chips: 100,  launchSpeed: 360, gravity: 980, hang: 1.0,  approachDur: 2.1, w: 74,  h: 26, popupColor: '#bfe8ff' },
  orca:     { weight: 0.35, chips: 500,  launchSpeed: 540, gravity: 720, hang: 0.8,  approachDur: 3.0, w: 150, h: 54, popupColor: '#7ff3ff' },
  humpback: { weight: 0.15, chips: 1000, launchSpeed: 430, gravity: 430, hang: 0.35, approachDur: 3.8, w: 130, h: 88, popupColor: '#ffd98a' },
};
const SPAWN_ORDER: MarineKind[] = ['porpoise', 'orca', 'humpback'];

export const RUN_SECONDS_DEFAULT = 45;
export const SURFACE_FRAC = 0.66;     // the breach waterline
export const CANOE_Y_FRAC = 0.84;     // the canoe's float line, nearer water
export const CANOE_W = 128;           // hull length — clamps the paddle range
export const RING_MIN = 36;           // spotting ring radius the instant you press
export const RING_MAX = 132;          // fully drawn ring (~0.6 s of holding)
const RING_GROW = 170;                // px/s while holding
const RING_DECAY = 560;               // px/s collapse after release
const PLAYER_EASE = 9;                // 1/s — how snappily the canoe chases the finger
const SPAWN_START = 3.4;              // seconds between shadows at t=0…
const SPAWN_END = 2.0;                // …ramping to this by the final second
const MAX_SIGHTINGS = 3;              // hard cap — spawner skips a beat rather than flood
const FIRST_SHADOW_DELAY = 1.3;       // one calm beat of open water before the show
const APPROACH_Y_FAR = 0.47;          // fraction of h where a shadow first appears
const POPUP_TTL = 0.9;
const POPUP_RISE = 60;                // px/s

// The precision windows, as fractions of launch speed. |vy| = 0 is the
// apex; releasing inside 10% of launch speed is frame-tight on a
// porpoise and generous on a hanging humpback — exactly the intended
// difficulty split.
export const PERFECT_WINDOW = 0.10;
export const GOOD_WINDOW = 0.35;
export const GRADE_MULT: Record<Grade, number> = { perfect: 2, good: 1, miss: 0 };

/** The breach waterline — renderer and physics share it. */
export const surfaceY = (canvasH: number): number => canvasH * SURFACE_FRAC;
/** Where the canoe floats. */
export const canoeY = (canvasH: number): number => canvasH * CANOE_Y_FRAC;

function rollKind(): MarineKind {
  let r = Math.random();
  for (const kind of SPAWN_ORDER) {
    r -= MARINE_STATS[kind].weight;
    if (r <= 0) return kind;
  }
  return 'porpoise';
}

// ── The hook ───────────────────────────────────────────────────────

export interface WhaleWatchPhysics {
  // Refs the renderer reads every frame (never trigger React renders):
  canoeXRef: MutableRefObject<number>;        // smoothed hull centre — draw this
  ringRef: MutableRefObject<number>;          // spotting ring radius, 0 when idle
  holdingRef: MutableRefObject<boolean>;
  sightingsRef: MutableRefObject<Sighting[]>;
  popupsRef: MutableRefObject<ScorePopup[]>;
  scoreRef: MutableRefObject<number>;
  statusRef: MutableRefObject<GameStatus>;
  timeLeftRef: MutableRefObject<number>;      // seconds, clamped ≥ 0
  progressRef: MutableRefObject<number>;      // 0 → 1 over the run; drives the sunset
  catchPulseRef: MutableRefObject<number>;    // 1 → 0 after a scoring release; HUD bounce
  perfectsRef: MutableRefObject<number>;
  goodsRef: MutableRefObject<number>;
  missesRef: MutableRefObject<number>;
  missedSightingsRef: MutableRefObject<number>;
  // Imperative API for the canvas component:
  start: (canvasW: number, canvasH: number) => void;
  step: (dt: number, canvasW: number, canvasH: number) => void;
  setPointerX: (x: number) => void;
  holdStart: () => void;    // finger down: arm + start growing the ring
  release: () => void;      // finger up: the graded moment
  endRun: () => void;
}

export function useWhaleWatchPhysics(opts: WhaleWatchPhysicsOptions = {}): WhaleWatchPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const canoeXRef = useRef(0);
  const canoeTargetXRef = useRef(0);
  const ringRef = useRef(0);
  const holdingRef = useRef(false);
  const sightingsRef = useRef<Sighting[]>([]);
  const popupsRef = useRef<ScorePopup[]>([]);
  const scoreRef = useRef(0);
  const statusRef = useRef<GameStatus>('idle');
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const progressRef = useRef(0);
  const elapsedRef = useRef(0);
  const spawnClockRef = useRef(FIRST_SHADOW_DELAY);
  const catchPulseRef = useRef(0);
  const perfectsRef = useRef(0);
  const goodsRef = useRef(0);
  const missesRef = useRef(0);
  const missedSightingsRef = useRef(0);

  const endRun = useCallback(() => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    holdingRef.current = false;
    optsRef.current.onGameOver?.(scoreRef.current, {
      perfects: perfectsRef.current,
      goods: goodsRef.current,
      misses: missesRef.current,
      missedSightings: missedSightingsRef.current,
    });
  }, []);

  const start = useCallback((canvasW: number, _canvasH: number) => {
    sightingsRef.current.length = 0;
    popupsRef.current.length = 0;
    scoreRef.current = 0;
    elapsedRef.current = 0;
    progressRef.current = 0;
    spawnClockRef.current = FIRST_SHADOW_DELAY;
    timeLeftRef.current = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    catchPulseRef.current = 0;
    ringRef.current = 0;
    holdingRef.current = false;
    perfectsRef.current = 0;
    goodsRef.current = 0;
    missesRef.current = 0;
    missedSightingsRef.current = 0;
    canoeXRef.current = canvasW * 0.5;
    canoeTargetXRef.current = canvasW * 0.5;
    statusRef.current = 'running';
  }, []);

  const setPointerX = useCallback((x: number) => {
    canoeTargetXRef.current = x;
  }, []);

  const holdStart = useCallback(() => {
    if (statusRef.current !== 'running') return;
    holdingRef.current = true;
    ringRef.current = Math.max(ringRef.current, RING_MIN);
  }, []);

  /**
   * The graded moment. Finds the nearest airborne, unattempted breacher
   * whose centre sits inside the spotting ring (plus half its body — a
   * grazing edge still counts), then grades on |vy| / launchSpeed:
   * still rising = TOO SOON, already falling = TOO LATE, apex = PERFECT.
   * Releasing over empty water just collapses the ring — the punishment
   * is having to grow it again, not a scoreboard hit.
   */
  const release = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    if (statusRef.current !== 'running') return;

    const ring = ringRef.current;
    const canoeX = canoeXRef.current;
    let best: Sighting | null = null;
    let bestDx = Infinity;
    for (const s of sightingsRef.current) {
      if (s.phase !== 'airborne' || s.attempted) continue;
      const dx = Math.abs(s.x - canoeX);
      if (dx <= ring + MARINE_STATS[s.kind].w * 0.5 && dx < bestDx) {
        best = s;
        bestDx = dx;
      }
    }
    if (!best) return;

    best.attempted = true;
    const st = MARINE_STATS[best.kind];
    const q = Math.abs(best.vy) / st.launchSpeed;
    const grade: Grade = q <= PERFECT_WINDOW ? 'perfect' : q <= GOOD_WINDOW ? 'good' : 'miss';
    const chips = st.chips * GRADE_MULT[grade];

    if (grade === 'perfect') perfectsRef.current += 1;
    else if (grade === 'good') goodsRef.current += 1;
    else missesRef.current += 1;

    if (chips > 0) {
      scoreRef.current += chips;
      catchPulseRef.current = 1;
      popupsRef.current.push({
        x: best.x,
        y: best.y - MARINE_STATS[best.kind].h * 0.7,
        text: grade === 'perfect' ? `PERFECT! +${chips.toLocaleString()}` : `+${chips.toLocaleString()}`,
        color: grade === 'perfect' ? '#7ff3ff' : st.popupColor,
        age: 0,
        ttl: POPUP_TTL,
      });
    } else {
      popupsRef.current.push({
        x: best.x,
        y: best.y - MARINE_STATS[best.kind].h * 0.7,
        text: best.vy < 0 ? 'TOO SOON' : 'TOO LATE',
        color: '#ff8a7a',
        age: 0,
        ttl: POPUP_TTL,
      });
    }
    optsRef.current.onResult?.(grade, best.kind, chips, best.x, best.y);
  }, []);

  const spawn = useCallback((canvasW: number, canvasH: number) => {
    const sightings = sightingsRef.current;
    if (sightings.length >= MAX_SIGHTINGS) return;
    const kind = rollKind();
    const st = MARINE_STATS[kind];
    const x = canvasW * (0.14 + Math.random() * 0.72);
    sightings.push({
      kind,
      phase: 'approach',
      x,
      y: canvasH * APPROACH_Y_FAR,
      vy: 0,
      scale: 0.2,
      approachAge: 0,
      approachDur: st.approachDur * (0.9 + Math.random() * 0.25),
      driftVx: (Math.random() - 0.5) * 26,
      launchSpeed: st.launchSpeed * (0.92 + Math.random() * 0.16),
      attempted: false,
      seed: Math.random() * 1000,
      dead: false,
    });
    optsRef.current.onShadow?.(kind, x);
  }, []);

  const step = useCallback((dt: number, canvasW: number, canvasH: number) => {
    if (statusRef.current !== 'running') return;
    // Tab-switch / hitch protection: a background pause must not fling
    // every breacher through its whole arc in one frame.
    dt = Math.min(dt, 0.05);

    // ── Clock + sunset ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);
    progressRef.current = Math.min(elapsedRef.current / runSeconds, 1);

    // ── Canoe: exponential ease toward the finger (frame-rate independent) ──
    const halfHull = CANOE_W / 2;
    const target = Math.min(Math.max(canoeTargetXRef.current, halfHull), canvasW - halfHull);
    canoeXRef.current += (target - canoeXRef.current) * (1 - Math.exp(-PLAYER_EASE * dt));

    // ── Spotting ring: grows while held, collapses fast when not ──
    ringRef.current = holdingRef.current
      ? Math.min(RING_MAX, ringRef.current + RING_GROW * dt)
      : Math.max(0, ringRef.current - RING_DECAY * dt);

    // ── Spawner: interval ramps down over the run ──
    spawnClockRef.current -= dt;
    const progress = progressRef.current;
    while (spawnClockRef.current <= 0) {
      spawn(canvasW, canvasH);
      const base = SPAWN_START + (SPAWN_END - SPAWN_START) * progress;
      spawnClockRef.current += base * (0.85 + Math.random() * 0.3); // ±15% jitter
    }

    // ── Sightings: approach surge, breach parabola, splashdown ──
    const surface = surfaceY(canvasH);
    const sightings = sightingsRef.current;
    for (let i = 0; i < sightings.length; i++) {
      const s = sightings[i];
      const st = MARINE_STATS[s.kind];

      if (s.phase === 'approach') {
        s.approachAge += dt;
        s.x += s.driftVx * dt;
        const k = Math.min(s.approachAge / s.approachDur, 1);
        s.scale = 0.2 + 0.8 * k;
        // k² depth curve: the shadow accelerates as it commits to the surface.
        s.y = canvasH * APPROACH_Y_FAR + (surface + 20 - canvasH * APPROACH_Y_FAR) * k * k;
        if (k >= 1) {
          s.phase = 'airborne';
          s.scale = 1;
          s.y = surface;
          s.vy = -s.launchSpeed;
          optsRef.current.onBreach?.(s.kind, s.x);
        }
        continue;
      }

      // Airborne. `hang` < 1 relaxes gravity near the apex (|vy| small)
      // so the top of the jump visibly floats — the graded moment gets
      // longer the bigger the prize animal.
      const gEff = st.gravity * (st.hang + (1 - st.hang) * Math.min(1, Math.abs(s.vy) / 200));
      s.vy += gEff * dt;
      s.y += s.vy * dt;

      if (s.vy > 0 && s.y >= surface + 6) {
        s.dead = true;
        if (!s.attempted) missedSightingsRef.current += 1;
        optsRef.current.onSplashdown?.(s.kind, s.x);
      }
    }

    // In-place compaction — zero garbage, order preserved.
    let write = 0;
    for (let i = 0; i < sightings.length; i++) {
      if (!sightings[i].dead) sightings[write++] = sightings[i];
    }
    sightings.length = write;

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

    if (timeLeftRef.current <= 0) endRun();
  }, [spawn, endRun]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<WhaleWatchPhysics>(() => ({
    canoeXRef, ringRef, holdingRef, sightingsRef, popupsRef, scoreRef,
    statusRef, timeLeftRef, progressRef, catchPulseRef,
    perfectsRef, goodsRef, missesRef, missedSightingsRef,
    start, step, setPointerX, holdStart, release, endRun,
  }), [start, step, setPointerX, holdStart, release, endRun]);
}
