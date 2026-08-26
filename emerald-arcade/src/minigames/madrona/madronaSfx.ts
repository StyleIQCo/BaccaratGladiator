// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — synthesized sound effects + ambience.
//
//  100% Web Audio oscillators + noise buffers: no audio assets, no
//  network fetches (CloudFront's script-src 'self' CSP stays happy).
//  Same contract as baristaSfx / foragerSfx.
//
//  The material story IS the sound design:
//    GLASS — bright, high-pitched clinks on every wall kiss; a light,
//            airy high-passed rolling hiss.
//    IRON  — deep metallic thuds with a sub knock; a low-passed
//            freight-rumble rolling bed you feel more than hear.
//    STEEL — clean mid clacks between the two.
//    BARRIER CRASH — layered wood crack transients + splinter debris
//            noise + a low boom. The payoff for hauling the iron ball.
//
//  The rolling loop is a LOOPED voice with a start/set/stop handle —
//  the canvas feeds it the marble's live speed each frame (cheap
//  AudioParam writes, no node churn).
//
//  iOS autoplay policy: primeAudio() MUST be called from a user
//  gesture — the wrapper's "ROLL OUT" tap does. Every voice no-ops
//  silently if audio was never primed.
// ═══════════════════════════════════════════════════════════════════
import type { MarbleId } from './marbleData';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sharedNoiseBuf: AudioBuffer | null = null;

export function primeAudio(): void {
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (!sharedNoiseBuf) {
    const len = Math.floor(ctx.sampleRate * 1.0);
    sharedNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = sharedNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return sharedNoiseBuf;
}

const now = () => (ctx ? ctx.currentTime : 0);

// ── Core voices ────────────────────────────────────────────────────

function toneAt(
  t0: number,
  freq: number,
  opts: { to?: number; dur?: number; type?: OscillatorType; gain?: number; attack?: number } = {},
): void {
  if (!ctx || !master) return;
  const { to = freq, dur = 0.12, type = 'triangle', gain = 0.25, attack = 0.012 } = opts;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(freq, 1), t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseAt(
  t0: number,
  opts: { dur?: number; freq?: number; to?: number; q?: number; gain?: number; type?: BiquadFilterType } = {},
): void {
  if (!ctx || !master) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const { dur = 0.15, freq = 2000, to = freq, q = 1, gain = 0.2, type = 'bandpass' } = opts;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = Math.random() * 0.5; // decorrelate reuses of the shared buffer
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ── The rolling loop (start / feed speed / stop) ───────────────────

interface RollVoice {
  src: AudioBufferSourceNode;
  filt: BiquadFilterNode;
  gain: GainNode;
  baseFreq: number;
  freqSwing: number;
  maxGain: number;
}

let rollVoice: RollVoice | null = null;

/** Per-material rolling texture: filter shape + how speed drives it. */
const ROLL_SPEC: Record<MarbleId, { type: BiquadFilterType; base: number; swing: number; gain: number; q: number }> = {
  glass: { type: 'highpass', base: 2400, swing: 1800, gain: 0.1, q: 0.8 },
  steel: { type: 'bandpass', base: 700, swing: 900, gain: 0.14, q: 1.0 },
  iron: { type: 'lowpass', base: 110, swing: 140, gain: 0.34, q: 1.4 },
};

export function startRoll(id: MarbleId): void {
  stopRoll();
  if (!ctx || !master) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const spec = ROLL_SPEC[id];
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = spec.type;
  filt.frequency.value = spec.base;
  filt.Q.value = spec.q;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  src.connect(filt).connect(gain).connect(master);
  src.start();
  rollVoice = { src, filt, gain, baseFreq: spec.base, freqSwing: spec.swing, maxGain: spec.gain };
}

/** speed01 = live marble speed / its own maxSpeed. Cheap param writes. */
export function setRollSpeed(speed01: number): void {
  if (!rollVoice || !ctx) return;
  const s = Math.max(0, Math.min(1, speed01));
  const t = now();
  // setTargetAtTime keeps this zipper-free at 60 calls/sec.
  rollVoice.gain.gain.setTargetAtTime(Math.max(0.0001, rollVoice.maxGain * s * s), t, 0.06);
  rollVoice.filt.frequency.setTargetAtTime(rollVoice.baseFreq + rollVoice.freqSwing * s, t, 0.08);
}

export function stopRoll(): void {
  if (!rollVoice || !ctx) {
    rollVoice = null;
    return;
  }
  const t = now();
  rollVoice.gain.gain.cancelScheduledValues(t);
  rollVoice.gain.gain.setTargetAtTime(0.0001, t, 0.05);
  try {
    rollVoice.src.stop(t + 0.3);
  } catch {
    /* already stopped */
  }
  rollVoice = null;
}

// ── Ambience: dusk in a madrona grove ──────────────────────────────
//  A soft low-passed wind bed + sparse pentatonic kalimba plucks.
//  Scheduled a lookahead window at a time against ctx.currentTime.

let ambienceBed: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
let pluckTimer: ReturnType<typeof setInterval> | null = null;
let nextPluckAt = 0;

const PLUCK_SCALE = [392, 440, 523.25, 587.33, 698.46, 784]; // G-major pentatonic

export function startAmbience(): void {
  stopAmbience();
  if (!ctx || !master) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 260;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now());
  gain.gain.exponentialRampToValueAtTime(0.05, now() + 1.2);
  // A slow LFO breathes the wind so the bed never reads as a flat hiss.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(filt).connect(gain).connect(master);
  src.start();
  lfo.start();
  ambienceBed = { src, gain, lfo };

  nextPluckAt = now() + 1.5;
  pluckTimer = setInterval(() => {
    if (!ctx) return;
    // Keep ~2s of plucks scheduled ahead; sparse and unhurried.
    while (nextPluckAt < now() + 2) {
      const f = PLUCK_SCALE[Math.floor(Math.random() * PLUCK_SCALE.length)];
      toneAt(nextPluckAt, f, { to: f, dur: 0.9, type: 'sine', gain: 0.055, attack: 0.004 });
      toneAt(nextPluckAt, f * 2, { dur: 0.25, type: 'sine', gain: 0.02, attack: 0.004 });
      nextPluckAt += 1.4 + Math.random() * 2.2;
    }
  }, 500);
}

export function stopAmbience(): void {
  if (pluckTimer) {
    clearInterval(pluckTimer);
    pluckTimer = null;
  }
  if (ambienceBed && ctx) {
    const t = now();
    ambienceBed.gain.gain.cancelScheduledValues(t);
    ambienceBed.gain.gain.setTargetAtTime(0.0001, t, 0.2);
    try {
      ambienceBed.src.stop(t + 0.8);
      ambienceBed.lfo.stop(t + 0.8);
    } catch {
      /* already stopped */
    }
  }
  ambienceBed = null;
}

// ── One-shots ──────────────────────────────────────────────────────

/** Wall contact, voiced by material. impact01 scales the level. */
export function sfxWallHit(id: MarbleId, impact01: number): void {
  const v = 0.35 + 0.65 * Math.max(0, Math.min(1, impact01));
  const t = now();
  if (id === 'glass') {
    // Light, high-pitched clink — two detuned partials, no body.
    toneAt(t, 2350, { to: 2100, dur: 0.06, type: 'triangle', gain: 0.22 * v, attack: 0.002 });
    toneAt(t, 3520, { to: 3300, dur: 0.045, type: 'sine', gain: 0.12 * v, attack: 0.002 });
  } else if (id === 'iron') {
    // Deep, heavy metallic thud: sub knock + choked clang.
    toneAt(t, 130, { to: 55, dur: 0.16, type: 'sine', gain: 0.5 * v, attack: 0.003 });
    toneAt(t, 340, { to: 240, dur: 0.07, type: 'square', gain: 0.1 * v, attack: 0.003 });
    noiseAt(t, { dur: 0.08, freq: 500, to: 160, type: 'lowpass', gain: 0.18 * v });
  } else {
    // Steel: clean mid clack.
    toneAt(t, 900, { to: 620, dur: 0.06, type: 'square', gain: 0.14 * v, attack: 0.002 });
    noiseAt(t, { dur: 0.05, freq: 2400, to: 1200, gain: 0.1 * v });
  }
}

/** Bounced off a barrier without breaking it — a dull wooden knock. */
export function sfxBarrierThud(impact01: number): void {
  const v = 0.4 + 0.6 * Math.max(0, Math.min(1, impact01));
  const t = now();
  toneAt(t, 190, { to: 95, dur: 0.11, type: 'triangle', gain: 0.32 * v, attack: 0.003 });
  noiseAt(t, { dur: 0.07, freq: 700, to: 250, type: 'lowpass', gain: 0.16 * v, q: 0.8 });
}

/** The iron ball shatters a plank: crack transients + debris + boom. */
export function sfxBarrierCrash(): void {
  const t = now();
  // Sharp fibrous cracks, staggered like the plank letting go in stages.
  noiseAt(t, { dur: 0.05, freq: 3400, to: 1500, gain: 0.4, q: 2.5 });
  noiseAt(t + 0.03, { dur: 0.06, freq: 2500, to: 900, gain: 0.35, q: 2 });
  noiseAt(t + 0.07, { dur: 0.09, freq: 1600, to: 500, gain: 0.3, q: 1.5 });
  // Splinter debris scattering across the board.
  noiseAt(t + 0.1, { dur: 0.35, freq: 4200, to: 2000, type: 'highpass', gain: 0.12 });
  // The low boom that earns the camera shake.
  toneAt(t, 95, { to: 38, dur: 0.34, type: 'sine', gain: 0.55, attack: 0.004 });
  toneAt(t + 0.02, 150, { to: 70, dur: 0.14, type: 'triangle', gain: 0.2, attack: 0.004 });
}

export function sfxGem(nth: number): void {
  const t = now();
  const base = 880 * Math.pow(1.06, Math.min(nth, 8)); // each gem rings a hair brighter
  toneAt(t, base, { dur: 0.09, type: 'triangle', gain: 0.22 });
  toneAt(t + 0.06, base * 1.5, { dur: 0.14, type: 'triangle', gain: 0.2 });
}

export function sfxHoleFall(): void {
  const t = now();
  // A falling whistle chased by the knock of wood swallowing the ball.
  toneAt(t, 900, { to: 160, dur: 0.4, type: 'sine', gain: 0.22 });
  toneAt(t + 0.36, 140, { to: 70, dur: 0.12, type: 'triangle', gain: 0.3, attack: 0.003 });
}

export function sfxRespawn(): void {
  toneAt(now(), 520, { to: 780, dur: 0.1, type: 'triangle', gain: 0.16 });
}

export function sfxGoal(): void {
  const t = now();
  // The emerald takes the marble: soft wood sink, then a bright rise.
  toneAt(t, 220, { to: 110, dur: 0.12, type: 'triangle', gain: 0.25 });
  toneAt(t + 0.1, 523, { dur: 0.12, type: 'triangle', gain: 0.22 });
  toneAt(t + 0.2, 659, { dur: 0.12, type: 'triangle', gain: 0.22 });
  toneAt(t + 0.3, 784, { dur: 0.12, type: 'triangle', gain: 0.22 });
  toneAt(t + 0.4, 1047, { dur: 0.36, type: 'triangle', gain: 0.26 });
}

export function sfxGameOver(): void {
  const t = now();
  toneAt(t, 523, { dur: 0.13, type: 'triangle', gain: 0.3 });
  toneAt(t + 0.15, 392, { dur: 0.13, type: 'triangle', gain: 0.3 });
  toneAt(t + 0.3, 330, { to: 262, dur: 0.34, type: 'triangle', gain: 0.32 });
}

export function sfxTick(): void {
  toneAt(now(), 1150, { dur: 0.045, type: 'square', gain: 0.14 });
}

/** Equipping a marble sounds like the marble. */
export function sfxSwap(id: MarbleId): void {
  const t = now();
  if (id === 'glass') toneAt(t, 1800, { to: 2600, dur: 0.09, type: 'sine', gain: 0.2 });
  else if (id === 'iron') toneAt(t, 160, { to: 75, dur: 0.18, type: 'sine', gain: 0.4, attack: 0.004 });
  else toneAt(t, 760, { to: 980, dur: 0.08, type: 'square', gain: 0.12 });
}

export function sfxUiTap(): void {
  toneAt(now(), 1900, { to: 1500, dur: 0.03, type: 'square', gain: 0.1 });
}

export function sfxClaim(): void {
  const t = now();
  toneAt(t, 659, { dur: 0.1, type: 'square', gain: 0.16 });
  toneAt(t + 0.08, 880, { dur: 0.1, type: 'square', gain: 0.16 });
  toneAt(t + 0.16, 1319, { dur: 0.22, type: 'square', gain: 0.18 });
}

/** Kill everything — the wrapper calls this on close/unmount. */
export function stopAllAudio(): void {
  stopRoll();
  stopAmbience();
}
