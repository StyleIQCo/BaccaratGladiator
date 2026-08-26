// ═══════════════════════════════════════════════════════════════════
//  THE PUGET SOUND FORAGER — physics core.
//
//  Emerald City Arcade mini-game: 60 seconds, three foraging zones,
//  one quota. Fill the Ultimate Seafood Boil (10 clams, 5 oysters,
//  1 geoduck, 3 Dungeness crabs, 3 squid, 1 king salmon) before the
//  tide clock runs out and the pot pays the 25,000-chip BOIL BONANZA.
//
//  This hook owns the ENTIRE simulation for all three zones — the
//  mudflat whack-a-mole spawner, the crab-pot timed drop, the salmon
//  tension fight, the shared clock, and the inventory/quota ledger.
//  Only the zone the player is standing in steps; the other two
//  freeze mid-frame (switch away from a dropping pot and it hangs on
//  its rope until you come back — that's the strategic cost of
//  zone-hopping, not a bug).
//
//  Same performance contract as useHotdogPhysics / useFishTossPhysics
//  (the template pair for every cabinet in the arcade):
//    • Every per-frame value lives in a ref. React renders only via
//      the DOM-facing callbacks (onCatch / onSecond / onGameOver).
//    • step() allocates nothing except queued FX events, and those
//      queues are hard-capped. Dead bubbles/shadows are compacted in
//      place — no .filter() garbage.
//    • All motion is dt-based (px/sec) — 120 Hz ProMotion and a
//      throttled 30 fps Android play the identical game.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';

// ── Types ──────────────────────────────────────────────────────────

export type SeafoodKind = 'clam' | 'oyster' | 'geoduck' | 'crab' | 'squid' | 'salmon';
export type ZoneId = 1 | 2 | 3;
export type GameStatus = 'idle' | 'running' | 'over';
export type GameOverReason = 'time' | 'boil';
export type Inventory = Record<SeafoodKind, number>;

export interface ForagerResult {
  boil: boolean;        // quota filled before the horn → BOIL BONANZA
  chips: number;        // haul value — earned whether or not the boil fires
  bonus: number;        // BOIL_BONUS on a boil, else 0
  inventory: Inventory;
}

/** Mechanic cues the wrapper turns into synthesized SFX (never React state). */
export type ForagerCue =
  | 'squish'         // tapped bare mud
  | 'dig'            // a fresh bubble breached
  | 'geoduck_tap'    // one tug on the neck landed
  | 'geoduck_slip'   // grip lost (taps too slow) or the geoduck got away
  | 'pot_drop'       // pot committed to the drop
  | 'pot_thunk'      // something heavy just walked into the cage
  | 'splash'         // pot broke the surface
  | 'creak'          // winching the rope back up
  | 'squid_jink'     // the purple shadow just changed its mind
  | 'bite'           // salmon on! tension bar live
  | 'reel_tick'      // one clack of the reel (cadence scales with tension)
  | 'thrash'         // the salmon surged — get off the line
  | 'line_break'     // held through the red; fish gone
  | 'zone_switch';   // hopped zones via the nav bar

/** Cosmetic events the canvas drains into particles/popups each frame. */
export interface FxEvent {
  kind: 'sand' | 'splash' | 'ink' | 'snap' | 'ring' | 'popup';
  x: number;
  y: number;
  text?: string;    // popup only
  color?: string;   // popup only
}

/** A catch the canvas turns into an icon flying up to the HUD slot. */
export interface CatchEvent {
  kind: SeafoodKind;
  x: number;
  y: number;
}

// Zone 1 — a mudflat bubble. Clams/oysters pop on one tap; the
// geoduck's neck needs GEODUCK_TAPS rapid tugs before the ttl lapses.
export interface MudBubble {
  kind: 'clam' | 'oyster' | 'geoduck';
  x: number;
  y: number;
  r: number;         // tap/draw radius
  age: number;       // seconds since breach (frozen while a geoduck is gripped)
  ttl: number;       // seconds before it sinks back into the mud
  taps: number;      // geoduck tug progress (0 for shellfish)
  sinceTap: number;  // seconds since the last tug — grip decays past GRIP_WINDOW
  seed: number;      // stable per-bubble jitter for the renderer
  dead: boolean;     // caught or sunk; compacted after step()
}

// Zone 2 — the crab pot and what swims under it.
export type PotState = 'aim' | 'drop' | 'raise';
export interface DockShadow {
  kind: 'crab' | 'squid';
  x: number;
  y: number;
  vx: number;        // px/s; squid re-rolls this on every jink
  jink: number;      // seconds until the squid's next direction change
  seed: number;
  dead: boolean;
}

// Zone 3 — the salmon fight.
export type ReelState = 'waiting' | 'hooked';

export interface ForagerPhysicsOptions {
  runSeconds?: number;                            // default 60
  onGameOver?: (result: ForagerResult) => void;
  /** Fired the frame something lands in the basket — the wrapper plays
   *  the per-kind chime and schedules the HUD count bump to land when
   *  the canvas flyer arrives (FLY_SECONDS later). */
  onCatch?: (kind: SeafoodKind) => void;
  /** Mechanic SFX cues — see ForagerCue. */
  onCue?: (cue: ForagerCue) => void;
  /** Fired only when the whole-second readout changes (≤1 render/sec). */
  onSecond?: (secondsLeft: number) => void;
}

// ── Tuning tables ──────────────────────────────────────────────────

export const RUN_SECONDS_DEFAULT = 60;
export const BOIL_BONUS = 25_000;
/** Canvas flyer flight time — the wrapper delays its HUD count bump by
 *  this much so the number ticks up the instant the icon lands. */
export const FLY_SECONDS = 0.62;

/** HUD slot order — the canvas aims flyers at slot i of 6, so the DOM
 *  inventory bar MUST render in this order. */
export const SEAFOOD_ORDER: SeafoodKind[] = ['clam', 'oyster', 'geoduck', 'crab', 'squid', 'salmon'];

export const SEAFOOD_META: Record<
  SeafoodKind,
  { label: string; emoji: string; chips: number; quota: number; zone: ZoneId; popupColor: string }
> = {
  clam:    { label: 'Clams',      emoji: '🐚', chips: 150,  quota: 10, zone: 1, popupColor: '#ffe066' },
  oyster:  { label: 'Oysters',    emoji: '🦪', chips: 350,  quota: 5,  zone: 1, popupColor: '#bfe8ff' },
  // "Geoduck" is pronounced "gooey-duck" — hence the duck. Locals get it.
  geoduck: { label: 'Geoduck',    emoji: '🦆', chips: 2000, quota: 1,  zone: 1, popupColor: '#ffb347' },
  crab:    { label: 'Dungeness',  emoji: '🦀', chips: 900,  quota: 3,  zone: 2, popupColor: '#ff9c6b' },
  squid:   { label: 'Squid',      emoji: '🦑', chips: 1100, quota: 3,  zone: 2, popupColor: '#d8b4fe' },
  salmon:  { label: 'King Salmon', emoji: '🐟', chips: 4000, quota: 1,  zone: 3, popupColor: '#ffd1dc' },
};

// Shared layout fractions — renderer and physics must agree on where
// the world is, same trick as fish-toss's getCatcherBox.
export const MUD_TOP_FRAC = 0.30;       // zone 1: tideline; bubbles spawn below
export const DOCK_SURFACE_FRAC = 0.20;  // zone 2: water surface under the pier
export const LANE_TOP_FRAC = 0.55;      // zone 2: shadows cruise in this depth band…
export const LANE_BOT_FRAC = 0.84;      // …
export const POT_W = 76;
export const POT_H = 54;
export const TENSION_RED = 0.78;        // above this the bar reads red — let go!

// Zone 1 spawner.
const BUBBLE_GAP_START = 0.62;          // seconds between breaches at t=0…
const BUBBLE_GAP_END = 0.40;            // …ramping to this by the final second
const MAX_BUBBLES = 6;
const BUBBLE_R = 22;
const GEODUCK_R = 34;
const TTL_CLAM = 1.7;
const TTL_OYSTER = 1.3;                 // uncommon AND quicker — earn it
const TTL_GEODUCK = 2.8;
export const GEODUCK_TAPS = 3;
const GRIP_WINDOW = 0.5;                // tugs further apart than this slip off
const W_CLAM = 0.62;                    // spawn weights (geoduck gets the rest)
const W_OYSTER = 0.30;

// Zone 2 pot + shadows.
const POT_EASE = 14;                    // 1/s — pot chases the finger while aiming
const DROP_SPEED = 560;                 // px/s
const RAISE_SPEED = 420;
const SHADOW_GAP = 1.0;                 // seconds between arrivals
const MAX_SHADOWS = 4;
const W_CRAB = 0.58;                    // vs squid
const CRAB_SPEED_MIN = 70;
const CRAB_SPEED_MAX = 115;
const SQUID_SPEED_MIN = 185;
const SQUID_SPEED_MAX = 260;
const CATCH_DX = 42;                    // pot-mouth catch box, px from pot centre
const CATCH_DY = 30;

// Zone 3 fight.
const BITE_FIRST = 0.45;                // the spec says the fish bites instantly
const BITE_MIN = 1.2;                   // …rebites after a land/break take longer
const BITE_MAX = 1.8;
const PROG_UP = 0.30;                   // reel progress /s while holding
const PROG_DOWN_CALM = 0.04;            // line paid back out while released…
const PROG_DOWN_SURGE = 0.12;          // …faster when the fish is surging
const TEN_UP = 1.05;                    // tension /s while holding (× surge mult)
const TEN_DOWN = 1.7;                   // tension /s while released
const SURGE_MULT = 2.3;
const CALM_MULT = 0.5;
const CALM_MIN = 1.1; const CALM_MAX = 1.9;
const SURGE_MIN = 0.55; const SURGE_MAX = 0.95;

const FX_CAP = 40;                      // queued FX events; overflow is dropped
const POPUP_OFFSET_Y = -26;

export function makeEmptyInventory(): Inventory {
  return { clam: 0, oyster: 0, geoduck: 0, crab: 0, squid: 0, salmon: 0 };
}

/** Pot rest height — dangling just under the surface, ready to drop. */
export function potRestY(canvasH: number): number {
  return canvasH * DOCK_SURFACE_FRAC + 26;
}

// ── The hook ───────────────────────────────────────────────────────

export interface ForagerPhysics {
  // Shared refs the renderer reads every frame (never trigger renders):
  activeZoneRef: MutableRefObject<ZoneId>;
  statusRef: MutableRefObject<GameStatus>;
  timeLeftRef: MutableRefObject<number>;
  inventoryRef: MutableRefObject<Inventory>;
  chipsRef: MutableRefObject<number>;
  catchPulseRef: MutableRefObject<number>;   // 1 → 0 after each catch
  zoneFadeRef: MutableRefObject<number>;     // 1 → 0 after a zone switch; drives the wipe
  fxQueueRef: MutableRefObject<FxEvent[]>;   // canvas drains → particles/popups
  catchQueueRef: MutableRefObject<CatchEvent[]>; // canvas drains → HUD flyers
  // Zone 1:
  bubblesRef: MutableRefObject<MudBubble[]>;
  // Zone 2:
  potXRef: MutableRefObject<number>;
  potYRef: MutableRefObject<number>;
  potStateRef: MutableRefObject<PotState>;
  carriedRef: MutableRefObject<'crab' | 'squid' | null>; // drawn inside the cage on the way up
  shadowsRef: MutableRefObject<DockShadow[]>;
  // Zone 3:
  reelStateRef: MutableRefObject<ReelState>;
  reelHeldRef: MutableRefObject<boolean>;
  tensionRef: MutableRefObject<number>;      // 0..1; red above TENSION_RED
  progressRef: MutableRefObject<number>;     // 0..1; 1 = salmon landed
  surgingRef: MutableRefObject<boolean>;
  fishXRef: MutableRefObject<number>;
  fishYRef: MutableRefObject<number>;
  biteFlashRef: MutableRefObject<number>;    // 1 → 0 on bite
  snapFlashRef: MutableRefObject<number>;    // 1 → 0 on line break
  // Imperative API:
  start: (canvasW: number, canvasH: number) => void;
  step: (dt: number, canvasW: number, canvasH: number) => void;
  setActiveZone: (zone: ZoneId) => void;
  tapMudflat: (x: number, y: number) => void;
  setPotX: (x: number) => void;
  dropPot: () => void;
  setReeling: (held: boolean) => void;
  endRun: (reason: GameOverReason) => void;
}

export function useForagerPhysics(opts: ForagerPhysicsOptions = {}): ForagerPhysics {
  // Latest-ref pattern: callers can pass inline closures without
  // destabilising the loop — we read the freshest values at runtime.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  // Shared
  const activeZoneRef = useRef<ZoneId>(1);
  const statusRef = useRef<GameStatus>('idle');
  const timeLeftRef = useRef(RUN_SECONDS_DEFAULT);
  const elapsedRef = useRef(0);
  const lastSecondRef = useRef(RUN_SECONDS_DEFAULT);
  const inventoryRef = useRef<Inventory>(makeEmptyInventory());
  const chipsRef = useRef(0);
  const catchPulseRef = useRef(0);
  const zoneFadeRef = useRef(0);
  const fxQueueRef = useRef<FxEvent[]>([]);
  const catchQueueRef = useRef<CatchEvent[]>([]);
  // Zone 1
  const bubblesRef = useRef<MudBubble[]>([]);
  const bubbleClockRef = useRef(0);
  // Zone 2
  const potXRef = useRef(0);
  const potXTargetRef = useRef(0);
  const potYRef = useRef(0);
  const potStateRef = useRef<PotState>('aim');
  const carriedRef = useRef<'crab' | 'squid' | null>(null);
  const shadowsRef = useRef<DockShadow[]>([]);
  const shadowClockRef = useRef(0);
  // Zone 3
  const reelStateRef = useRef<ReelState>('waiting');
  const reelHeldRef = useRef(false);
  const tensionRef = useRef(0);
  const progressRef = useRef(0);
  const surgingRef = useRef(false);
  const surgeClockRef = useRef(0);
  const biteClockRef = useRef(BITE_FIRST);
  const tickClockRef = useRef(0);
  const fishXRef = useRef(0);
  const fishYRef = useRef(0);
  const fishSeedRef = useRef(0);
  const biteFlashRef = useRef(0);
  const snapFlashRef = useRef(0);

  const cue = useCallback((c: ForagerCue) => optsRef.current.onCue?.(c), []);

  const pushFx = useCallback((fx: FxEvent) => {
    if (fxQueueRef.current.length < FX_CAP) fxQueueRef.current.push(fx);
  }, []);

  const endRun = useCallback((reason: GameOverReason) => {
    if (statusRef.current !== 'running') return;
    statusRef.current = 'over';
    reelHeldRef.current = false;
    const boil = reason === 'boil';
    optsRef.current.onGameOver?.({
      boil,
      chips: chipsRef.current,
      bonus: boil ? BOIL_BONUS : 0,
      inventory: { ...inventoryRef.current },
    });
  }, []);

  /** Every catch funnels through here: ledger, chips, flyer, quota check. */
  const addCatch = useCallback((kind: SeafoodKind, x: number, y: number) => {
    const inv = inventoryRef.current;
    inv[kind] += 1;
    const meta = SEAFOOD_META[kind];
    chipsRef.current += meta.chips;
    catchPulseRef.current = 1;
    if (catchQueueRef.current.length < FX_CAP) catchQueueRef.current.push({ kind, x, y });
    pushFx({ kind: 'popup', x, y: y + POPUP_OFFSET_Y, text: `+${meta.chips}`, color: meta.popupColor });
    optsRef.current.onCatch?.(kind);
    // Quota sweep — six comparisons, no allocation.
    for (const k of SEAFOOD_ORDER) {
      if (inv[k] < SEAFOOD_META[k].quota) return;
    }
    endRun('boil');
  }, [endRun, pushFx]);

  const start = useCallback((canvasW: number, canvasH: number) => {
    activeZoneRef.current = 1;
    statusRef.current = 'running';
    elapsedRef.current = 0;
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    timeLeftRef.current = runSeconds;
    lastSecondRef.current = Math.ceil(runSeconds);
    inventoryRef.current = makeEmptyInventory();
    chipsRef.current = 0;
    catchPulseRef.current = 0;
    zoneFadeRef.current = 0;
    fxQueueRef.current.length = 0;
    catchQueueRef.current.length = 0;
    bubblesRef.current.length = 0;
    bubbleClockRef.current = 0.35;         // one beat of stillness, then the flat wakes up
    potXRef.current = canvasW * 0.5;
    potXTargetRef.current = canvasW * 0.5;
    potYRef.current = potRestY(canvasH);
    potStateRef.current = 'aim';
    carriedRef.current = null;
    shadowsRef.current.length = 0;
    shadowClockRef.current = 0.15;         // the dock is stocked almost immediately
    reelStateRef.current = 'waiting';
    reelHeldRef.current = false;
    tensionRef.current = 0;
    progressRef.current = 0;
    surgingRef.current = false;
    surgeClockRef.current = 0;
    biteClockRef.current = BITE_FIRST;
    tickClockRef.current = 0;
    fishXRef.current = canvasW * 0.68;
    fishYRef.current = canvasH * 0.55;
    fishSeedRef.current = Math.random() * 10;
    biteFlashRef.current = 0;
    snapFlashRef.current = 0;
  }, []);

  const setActiveZone = useCallback((zone: ZoneId) => {
    if (zone === activeZoneRef.current || statusRef.current !== 'running') return;
    activeZoneRef.current = zone;
    zoneFadeRef.current = 1;
    reelHeldRef.current = false;          // fingers don't teleport between zones
    cue('zone_switch');
  }, [cue]);

  // ── Zone 1 input: whack the bubbles ──────────────────────────────
  const tapMudflat = useCallback((x: number, y: number) => {
    if (statusRef.current !== 'running' || activeZoneRef.current !== 1) return;
    const bubbles = bubblesRef.current;
    // Newest bubble wins overlapping taps — it's the one on top visually.
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.dead) continue;
      const dx = x - b.x, dy = y - b.y;
      if (dx * dx + dy * dy > (b.r + 16) * (b.r + 16)) continue; // +16: fat-finger grace
      if (b.kind === 'geoduck') {
        b.taps += 1;
        b.sinceTap = 0;
        cue('geoduck_tap');
        pushFx({ kind: 'sand', x: b.x, y: b.y });
        if (b.taps >= GEODUCK_TAPS) {
          b.dead = true;
          addCatch('geoduck', b.x, b.y); // the wrapper's catch chime plays the big slurp
        }
      } else {
        b.dead = true;
        pushFx({ kind: 'sand', x: b.x, y: b.y });
        addCatch(b.kind, b.x, b.y);
      }
      return;
    }
    cue('squish');                        // bare mud: squelch, no prize
    pushFx({ kind: 'sand', x, y });
  }, [addCatch, cue, pushFx]);

  // ── Zone 2 input: aim + drop ─────────────────────────────────────
  const setPotX = useCallback((x: number) => {
    potXTargetRef.current = x;
  }, []);

  const dropPot = useCallback(() => {
    if (statusRef.current !== 'running' || activeZoneRef.current !== 2) return;
    if (potStateRef.current !== 'aim') return;
    potStateRef.current = 'drop';
    cue('pot_drop');
    cue('splash');
    pushFx({ kind: 'splash', x: potXRef.current, y: potYRef.current });
  }, [cue, pushFx]);

  // ── Zone 3 input: press-and-hold reel ────────────────────────────
  const setReeling = useCallback((held: boolean) => {
    reelHeldRef.current = held;
  }, []);

  // ── Spawners ─────────────────────────────────────────────────────

  const spawnBubble = useCallback((canvasW: number, canvasH: number) => {
    const bubbles = bubblesRef.current;
    if (bubbles.length >= MAX_BUBBLES) return;
    let kind: MudBubble['kind'];
    const r = Math.random();
    if (r < W_CLAM) kind = 'clam';
    else if (r < W_CLAM + W_OYSTER) kind = 'oyster';
    else kind = 'geoduck';
    // One geoduck neck at a time — it's a landmark, not a crowd.
    if (kind === 'geoduck' && bubbles.some(b => b.kind === 'geoduck' && !b.dead)) kind = 'clam';
    const radius = kind === 'geoduck' ? GEODUCK_R : BUBBLE_R;
    const top = canvasH * MUD_TOP_FRAC + 40;
    bubbles.push({
      kind,
      x: radius + 14 + Math.random() * (canvasW - radius * 2 - 28),
      y: top + Math.random() * (canvasH - top - 52),
      r: radius,
      age: 0,
      ttl: kind === 'clam' ? TTL_CLAM : kind === 'oyster' ? TTL_OYSTER : TTL_GEODUCK,
      taps: 0,
      sinceTap: 0,
      seed: Math.random() * 1000,
      dead: false,
    });
    cue('dig');
  }, [cue]);

  const spawnShadow = useCallback((canvasW: number, canvasH: number) => {
    const shadows = shadowsRef.current;
    if (shadows.length >= MAX_SHADOWS) return;
    const kind: DockShadow['kind'] = Math.random() < W_CRAB ? 'crab' : 'squid';
    const fromLeft = Math.random() < 0.5;
    const speed = kind === 'crab'
      ? CRAB_SPEED_MIN + Math.random() * (CRAB_SPEED_MAX - CRAB_SPEED_MIN)
      : SQUID_SPEED_MIN + Math.random() * (SQUID_SPEED_MAX - SQUID_SPEED_MIN);
    const laneTop = canvasH * LANE_TOP_FRAC;
    const laneBot = canvasH * LANE_BOT_FRAC;
    shadows.push({
      kind,
      x: fromLeft ? -50 : canvasW + 50,
      y: laneTop + Math.random() * (laneBot - laneTop),
      vx: fromLeft ? speed : -speed,
      jink: 0.25 + Math.random() * 0.5,
      seed: Math.random() * 1000,
      dead: false,
    });
  }, []);

  // ── The update loop ──────────────────────────────────────────────

  const step = useCallback((dt: number, canvasW: number, canvasH: number) => {
    if (statusRef.current !== 'running') return;
    // Tab-switch / hitch protection: a background pause must not fast-
    // forward the whole flat in one frame.
    dt = Math.min(dt, 0.05);

    // ── Shared clock ──
    const runSeconds = optsRef.current.runSeconds ?? RUN_SECONDS_DEFAULT;
    elapsedRef.current += dt;
    timeLeftRef.current = Math.max(0, runSeconds - elapsedRef.current);
    const whole = Math.ceil(timeLeftRef.current);
    if (whole !== lastSecondRef.current) {
      lastSecondRef.current = whole;
      optsRef.current.onSecond?.(whole);
    }
    const progressT = Math.min(elapsedRef.current / runSeconds, 1);

    // ── Juice decay (global — flashes fade even after a zone hop) ──
    catchPulseRef.current = Math.max(0, catchPulseRef.current - dt * 3.5);
    zoneFadeRef.current = Math.max(0, zoneFadeRef.current - dt * 3.2);
    biteFlashRef.current = Math.max(0, biteFlashRef.current - dt * 2.5);
    snapFlashRef.current = Math.max(0, snapFlashRef.current - dt * 1.8);

    // ── Only the active zone simulates ──
    switch (activeZoneRef.current) {

      // ═══ ZONE 1: THE MUDFLATS — whack-a-mole ═══
      case 1: {
        bubbleClockRef.current -= dt;
        const gap = BUBBLE_GAP_START + (BUBBLE_GAP_END - BUBBLE_GAP_START) * progressT;
        while (bubbleClockRef.current <= 0) {
          spawnBubble(canvasW, canvasH);
          bubbleClockRef.current += gap * (0.8 + Math.random() * 0.4);
        }
        const bubbles = bubblesRef.current;
        for (let i = 0; i < bubbles.length; i++) {
          const b = bubbles[i];
          if (b.kind === 'geoduck' && b.taps > 0) {
            // Engaged neck: the ttl clock pauses, but grip decays if the
            // tugs aren't rapid — that's the "3 RAPID taps" rule.
            b.sinceTap += dt;
            if (b.sinceTap > GRIP_WINDOW) {
              b.taps -= 1;
              b.sinceTap = 0;
              cue('geoduck_slip');
            }
          } else {
            b.age += dt;
          }
          if (b.age >= b.ttl) {
            b.dead = true;
            if (b.kind === 'geoduck') cue('geoduck_slip');
          }
        }
        // In-place compaction — zero garbage, order preserved.
        let write = 0;
        for (let i = 0; i < bubbles.length; i++) {
          if (!bubbles[i].dead) bubbles[write++] = bubbles[i];
        }
        bubbles.length = write;
        break;
      }

      // ═══ ZONE 2: THE DOCK — timed pot drop ═══
      case 2: {
        // Shadows keep cruising whether or not the pot is falling.
        shadowClockRef.current -= dt;
        while (shadowClockRef.current <= 0) {
          spawnShadow(canvasW, canvasH);
          shadowClockRef.current += SHADOW_GAP * (0.75 + Math.random() * 0.5);
        }
        const laneTop = canvasH * LANE_TOP_FRAC;
        const laneBot = canvasH * LANE_BOT_FRAC;
        const shadows = shadowsRef.current;
        for (let i = 0; i < shadows.length; i++) {
          const s = shadows[i];
          if (s.kind === 'squid') {
            s.jink -= dt;
            if (s.jink <= 0) {
              // Fast AND erratic: re-roll speed, maybe flip, drift lanes.
              const speed = SQUID_SPEED_MIN + Math.random() * (SQUID_SPEED_MAX - SQUID_SPEED_MIN);
              s.vx = (Math.random() < 0.35 ? -Math.sign(s.vx) : Math.sign(s.vx)) * speed;
              s.y = Math.min(laneBot, Math.max(laneTop, s.y + (Math.random() - 0.5) * 70));
              s.jink = 0.25 + Math.random() * 0.5;
              cue('squid_jink');
            }
          }
          s.x += s.vx * dt;
          if (s.x < -70 || s.x > canvasW + 70) s.dead = true;
        }

        const halfPot = POT_W / 2;
        const restY = potRestY(canvasH);
        switch (potStateRef.current) {
          case 'aim': {
            // Exponential ease toward the finger (frame-rate independent),
            // plus an idle bob so the rope never looks dead.
            const target = Math.min(Math.max(potXTargetRef.current, halfPot + 8), canvasW - halfPot - 8);
            potXRef.current += (target - potXRef.current) * (1 - Math.exp(-POT_EASE * dt));
            potYRef.current = restY + Math.sin(elapsedRef.current * 2.2) * 3;
            if (carriedRef.current) carriedRef.current = null; // previous prize is aboard
            break;
          }
          case 'drop': {
            potYRef.current += DROP_SPEED * dt;
            const mouthY = potYRef.current + POT_H / 2;
            for (let i = 0; i < shadows.length; i++) {
              const s = shadows[i];
              if (s.dead) continue;
              if (Math.abs(s.x - potXRef.current) < CATCH_DX && Math.abs(s.y - mouthY) < CATCH_DY) {
                s.dead = true;
                carriedRef.current = s.kind;
                potStateRef.current = 'raise';
                cue('pot_thunk');
                cue('creak');
                if (s.kind === 'squid') pushFx({ kind: 'ink', x: s.x, y: s.y });
                addCatch(s.kind, s.x, s.y);
                break;
              }
            }
            if (potStateRef.current === 'drop' && potYRef.current > laneBot + 34) {
              potStateRef.current = 'raise';   // hit the seabed empty
              cue('creak');
            }
            break;
          }
          case 'raise': {
            potYRef.current -= RAISE_SPEED * dt;
            if (potYRef.current <= restY) {
              potYRef.current = restY;
              potStateRef.current = 'aim';
              cue('splash');
              pushFx({ kind: 'splash', x: potXRef.current, y: canvasH * DOCK_SURFACE_FRAC });
            }
            break;
          }
        }

        let write = 0;
        for (let i = 0; i < shadows.length; i++) {
          if (!shadows[i].dead) shadows[write++] = shadows[i];
        }
        shadows.length = write;
        break;
      }

      // ═══ ZONE 3: DEEP WATER — the reel-in ═══
      case 3: {
        if (reelStateRef.current === 'waiting') {
          biteClockRef.current -= dt;
          fishXRef.current = canvasW * 0.68 + Math.sin(elapsedRef.current * 0.7 + fishSeedRef.current) * canvasW * 0.06;
          fishYRef.current = canvasH * 0.58 + Math.sin(elapsedRef.current * 1.1) * canvasH * 0.03;
          if (biteClockRef.current <= 0) {
            reelStateRef.current = 'hooked';
            tensionRef.current = 0.2;
            progressRef.current = 0;
            surgingRef.current = false;
            surgeClockRef.current = CALM_MIN + Math.random() * (CALM_MAX - CALM_MIN);
            biteFlashRef.current = 1;
            cue('bite');
            pushFx({ kind: 'ring', x: fishXRef.current, y: fishYRef.current });
          }
          break;
        }

        // Hooked: the fish alternates calm water and violent surges.
        surgeClockRef.current -= dt;
        if (surgeClockRef.current <= 0) {
          surgingRef.current = !surgingRef.current;
          surgeClockRef.current = surgingRef.current
            ? SURGE_MIN + Math.random() * (SURGE_MAX - SURGE_MIN)
            : CALM_MIN + Math.random() * (CALM_MAX - CALM_MIN);
          if (surgingRef.current) cue('thrash');
        }

        const held = reelHeldRef.current;
        if (held) {
          progressRef.current = Math.min(1, progressRef.current + PROG_UP * dt);
          tensionRef.current += TEN_UP * (surgingRef.current ? SURGE_MULT : CALM_MULT) * dt;
          // Reel clack cadence tightens as the line loads up.
          tickClockRef.current -= dt;
          if (tickClockRef.current <= 0) {
            tickClockRef.current = 0.12 - 0.06 * Math.min(tensionRef.current, 1);
            cue('reel_tick');
          }
        } else {
          tensionRef.current = Math.max(0, tensionRef.current - TEN_DOWN * dt);
          progressRef.current = Math.max(
            0,
            progressRef.current - (surgingRef.current ? PROG_DOWN_SURGE : PROG_DOWN_CALM) * dt,
          );
          tickClockRef.current = 0;
        }

        // The fish is dragged boat-ward as progress climbs; it wanders
        // and thrashes around that base line (the renderer adds flourish).
        const pullX = canvasW * (0.70 - 0.38 * progressRef.current);
        fishXRef.current += (pullX - fishXRef.current) * (1 - Math.exp(-3 * dt))
          + Math.sin(elapsedRef.current * (surgingRef.current ? 9 : 2.2) + fishSeedRef.current) * (surgingRef.current ? 90 : 24) * dt;
        fishYRef.current = canvasH * 0.55
          + Math.sin(elapsedRef.current * 1.3 + fishSeedRef.current) * canvasH * 0.045
          + (surgingRef.current ? Math.sin(elapsedRef.current * 11) * 10 : 0);

        if (tensionRef.current >= 1) {
          // Held through the red — SNAP.
          reelStateRef.current = 'waiting';
          reelHeldRef.current = false;
          tensionRef.current = 0;
          progressRef.current = 0;
          biteClockRef.current = BITE_MIN + Math.random() * (BITE_MAX - BITE_MIN);
          snapFlashRef.current = 1;
          cue('line_break');
          pushFx({ kind: 'snap', x: fishXRef.current, y: fishYRef.current });
        } else if (progressRef.current >= 1) {
          // Landed! Kings keep biting for bonus chips after the quota one.
          reelStateRef.current = 'waiting';
          tensionRef.current = 0;
          progressRef.current = 0;
          biteClockRef.current = BITE_MIN + Math.random() * (BITE_MAX - BITE_MIN);
          pushFx({ kind: 'splash', x: fishXRef.current, y: fishYRef.current });
          addCatch('salmon', fishXRef.current, fishYRef.current);
        }
        break;
      }
    }

    if (timeLeftRef.current <= 0) endRun('time');
  }, [addCatch, cue, endRun, pushFx, spawnBubble, spawnShadow]);

  // Stable identity: the canvas mounts once and keeps this object for
  // the life of the run — no effect re-subscriptions mid-game.
  return useMemo<ForagerPhysics>(() => ({
    activeZoneRef, statusRef, timeLeftRef, inventoryRef, chipsRef,
    catchPulseRef, zoneFadeRef, fxQueueRef, catchQueueRef,
    bubblesRef,
    potXRef, potYRef, potStateRef, carriedRef, shadowsRef,
    reelStateRef, reelHeldRef, tensionRef, progressRef, surgingRef,
    fishXRef, fishYRef, biteFlashRef, snapFlashRef,
    start, step, setActiveZone, tapMudflat, setPotX, dropPot, setReeling, endRun,
  }), [start, step, setActiveZone, tapMudflat, setPotX, dropPot, setReeling, endRun]);
}
