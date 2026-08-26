// ═══════════════════════════════════════════════════════════════════
//  PIKE ST. BARISTA RUSH — synthesized sound effects + BGM.
//
//  100% Web Audio oscillators + noise buffers: no audio assets, no
//  network fetches (CloudFront's script-src 'self' CSP stays happy),
//  and nothing to preload on a cold start. Same contract as
//  rainierSfx / hotdogSfx.
//
//  The soundtrack: RAINY-WINDOW LO-FI — an 84 BPM boom-bap loop
//  (swung dusty hats, round sine kick, brushed snare) walking a
//  Fmaj7 → Am7 → B♭maj7 → C9 progression, over a vinyl-crackle tick
//  layer and a low-passed noise bed whose slow beating LFOs read as
//  cafe chatter. Scheduled a lookahead window at a time against
//  ctx.currentTime — no drift, survives rAF throttling.
//
//  Diegetic layer: the steam wand and the milk pour are LOOPED voices
//  with start/stop handles (the hold/trace mechanics have unknown
//  duration), everything else is fire-and-forget.
//
//  iOS autoplay policy: primeAudio() MUST be called from a user
//  gesture — the wrapper's "CLOCK IN" tap does. Every voice no-ops
//  silently if audio was never primed.
// ═══════════════════════════════════════════════════════════════════
import type { DrinkGrade, StageQuality } from './useBaristaPhysics';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sharedNoiseBuf: AudioBuffer | null = null;

export function primeAudio(): void {
  // Audio must NEVER block gameplay: any environment where the context
  // can't be built (ancient WebViews, some headless configs) just plays mute.
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
    master = null;
  }
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

// ── Core voices (absolute-time so the BGM scheduler can use them) ──

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
  osc.frequency.setValueAtTime(freq, t0);
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

const now = () => (ctx ? ctx.currentTime : 0);

// ── Looped voice handle (steam wand / milk pour / chatter bed) ─────

interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  extras: AudioScheduledSourceNode[]; // LFOs etc. to stop with the loop
}

function startLoopVoice(
  build: (src: AudioBufferSourceNode, out: GainNode) => AudioScheduledSourceNode[],
  gainTarget: number,
  rampSec: number,
): LoopVoice | null {
  if (!ctx || !master) return null;
  const buf = noiseBuffer();
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now());
  gain.gain.exponentialRampToValueAtTime(Math.max(gainTarget, 0.0001), now() + rampSec);
  const extras = build(src, gain);
  gain.connect(master);
  src.start();
  extras.forEach((e) => e.start());
  return { src, gain, extras };
}

function stopLoopVoice(v: LoopVoice | null, rampSec = 0.15): void {
  if (!v || !ctx) return;
  const t = now();
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
  v.gain.gain.exponentialRampToValueAtTime(0.0001, t + rampSec);
  const stopAt = t + rampSec + 0.05;
  try {
    v.src.stop(stopAt);
    v.extras.forEach((e) => e.stop(stopAt));
  } catch { /* already stopped */ }
}

// ── Diegetic loops ─────────────────────────────────────────────────

let steamVoice: LoopVoice | null = null;
let dripTimer: ReturnType<typeof setInterval> | null = null;

/** The valve opens: pressurized hiss + irregular espresso drips. */
export function steamOn(): void {
  if (steamVoice) return;
  steamVoice = startLoopVoice((src, out) => {
    const f = ctx!.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2600;
    f.Q.value = 0.8;
    src.connect(f).connect(out);
    return [];
  }, 0.13, 0.08);
  dripTimer = setInterval(() => {
    if (Math.random() < 0.55) {
      const f0 = 620 + Math.random() * 520;
      toneAt(now(), f0, { to: f0 * 0.45, dur: 0.055, type: 'sine', gain: 0.055 });
    }
  }, 130);
}

export function steamOff(): void {
  stopLoopVoice(steamVoice, 0.12);
  steamVoice = null;
  if (dripTimer !== null) { clearInterval(dripTimer); dripTimer = null; }
}

let pourVoice: LoopVoice | null = null;

/** Finger on the foam: the smooth steamed-milk pour. */
export function pourOn(): void {
  if (pourVoice) return;
  pourVoice = startLoopVoice((src, out) => {
    const f = ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 640;
    f.Q.value = 1.4;
    // A slow wobble on the filter = the glug of a moving pour.
    const lfo = ctx!.createOscillator();
    lfo.frequency.value = 1.7;
    const lfoGain = ctx!.createGain();
    lfoGain.gain.value = 170;
    lfo.connect(lfoGain).connect(f.frequency);
    src.connect(f).connect(out);
    return [lfo];
  }, 0.1, 0.06);
}

export function pourOff(): void {
  stopLoopVoice(pourVoice, 0.1);
  pourVoice = null;
}

// ── One-shots ──────────────────────────────────────────────────────

/** Burr grinder chewing through beans — plays under the tamp-station intro. */
export function sfxGrind(): void {
  const t = now();
  noiseAt(t, { dur: 0.5, type: 'lowpass', freq: 340, to: 260, q: 2, gain: 0.3 });
  toneAt(t, 52, { to: 46, dur: 0.5, type: 'sawtooth', gain: 0.12 });
  for (let i = 0; i < 5; i++) {
    noiseAt(t + 0.05 + Math.random() * 0.38, { dur: 0.02, freq: 1900, q: 3, gain: 0.07 });
  }
}

/** The heavy metal ka-chunk. Perfect adds a bright ring on top. */
export function sfxTamp(quality: StageQuality): void {
  const t = now();
  noiseAt(t, { dur: 0.09, freq: 2600, to: 620, q: 1.5, gain: 0.3 });
  toneAt(t + 0.01, 165, { to: 68, dur: 0.13, type: 'square', gain: 0.3 });
  if (quality === 'perfect') toneAt(t + 0.06, 1568, { dur: 0.22, type: 'sine', gain: 0.16 });
  else if (quality === 'weak') toneAt(t + 0.05, 240, { to: 140, dur: 0.2, type: 'sawtooth', gain: 0.14 });
}

/** Valve closed — how close did the shot land? */
export function sfxPullGrade(quality: StageQuality): void {
  const t = now();
  noiseAt(t, { dur: 0.06, freq: 3400, to: 1400, gain: 0.12 }); // valve snap
  if (quality === 'perfect') {
    toneAt(t + 0.04, 1175, { dur: 0.12, type: 'sine', gain: 0.2 });
    toneAt(t + 0.13, 1568, { dur: 0.2, type: 'sine', gain: 0.2 });
  } else if (quality === 'good') {
    toneAt(t + 0.04, 880, { dur: 0.16, type: 'sine', gain: 0.18 });
  } else {
    toneAt(t + 0.04, 330, { to: 262, dur: 0.22, type: 'triangle', gain: 0.16 });
  }
}

/** The cup floods the drip tray. Tragedy. */
export function sfxOverflow(): void {
  const t = now();
  noiseAt(t, { dur: 0.4, type: 'lowpass', freq: 700, to: 140, gain: 0.28 }); // splat
  toneAt(t + 0.02, 210, { to: 80, dur: 0.5, type: 'sawtooth', gain: 0.22 }); // womp
  for (let i = 0; i < 6; i++) {
    const d = 0.06 + Math.random() * 0.3;
    toneAt(t + d, 500 + Math.random() * 700, { to: 220, dur: 0.05, type: 'sine', gain: 0.05 }); // splashes
  }
}

/** Service bell — order up! */
export function sfxBell(): void {
  const t = now();
  noiseAt(t, { dur: 0.025, freq: 6800, q: 2, gain: 0.1 }); // the strike
  toneAt(t, 2093, { dur: 0.85, type: 'sine', gain: 0.22, attack: 0.005 });
  toneAt(t, 2637, { dur: 0.6, type: 'sine', gain: 0.1, attack: 0.005 });
}

/** Cash register cha-ching + drawer thunk. */
export function sfxRegister(delay = 0): void {
  const t = now() + delay;
  noiseAt(t, { dur: 0.05, freq: 5200, q: 1.5, gain: 0.14 });
  toneAt(t + 0.02, 1319, { dur: 0.09, type: 'square', gain: 0.12 });
  toneAt(t + 0.1, 1760, { dur: 0.16, type: 'square', gain: 0.12 });
  noiseAt(t + 0.2, { dur: 0.08, type: 'lowpass', freq: 420, to: 180, gain: 0.2 });
  toneAt(t + 0.2, 120, { to: 70, dur: 0.12, type: 'triangle', gain: 0.28 });
}

/** Serve payoff, scaled to the grade (ruined drinks get the overflow womp instead). */
export function sfxServe(grade: DrinkGrade): void {
  if (grade === 'ruined') return; // sfxOverflow already told that story
  sfxBell();
  if (grade === 'perfect') {
    sfxRegister(0.22);
    const t = now();
    toneAt(t + 0.5, 1047, { dur: 0.09, type: 'triangle', gain: 0.12 });
    toneAt(t + 0.58, 1319, { dur: 0.14, type: 'triangle', gain: 0.12 });
  } else if (grade === 'good') {
    sfxRegister(0.22);
  }
}

export function sfxTick(): void {
  toneAt(now(), 1150, { dur: 0.045, type: 'square', gain: 0.1 });
}

/** Shift's over — a tired little descending sign-off. */
export function sfxGameOver(): void {
  const t = now();
  toneAt(t, 523, { dur: 0.13, type: 'triangle', gain: 0.26 });
  toneAt(t + 0.15, 392, { dur: 0.13, type: 'triangle', gain: 0.26 });
  toneAt(t + 0.3, 330, { to: 262, dur: 0.36, type: 'triangle', gain: 0.28 });
}

export function sfxClaim(): void {
  sfxRegister();
}

// ── BGM: the lo-fi loop ────────────────────────────────────────────

const BPM = 84;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const SWING = EIGHTH * 0.3; // off-beat eighths land late — the head-nod

interface Chord {
  bass: number;
  notes: number[];
}
// Fmaj7 → Am7 → B♭maj7 → C9, one bar each.
const PROGRESSION: Chord[] = [
  { bass: 87.31, notes: [174.61, 220, 261.63, 329.63] },
  { bass: 110, notes: [196, 220, 261.63, 329.63] },
  { bass: 116.54, notes: [174.61, 220, 293.66, 349.23] },
  { bass: 130.81, notes: [164.81, 196, 233.08, 293.66] },
];

let bgmTimer: ReturnType<typeof setInterval> | null = null;
let bgmStep = 0; // global eighth-note counter
let bgmNextStepTime = 0;
let chatterVoice: LoopVoice | null = null;

function scheduleStep(step: number, t: number): void {
  const stepInBar = step % 8;
  const chord = PROGRESSION[Math.floor(step / 8) % PROGRESSION.length];
  const swungT = stepInBar % 2 === 1 ? t + SWING : t;

  // Dusty hat on every eighth, ghosted on the off-beats.
  noiseAt(swungT, { dur: 0.03, freq: 7200, q: 1, gain: stepInBar % 2 === 0 ? 0.045 : 0.028, type: 'highpass' });

  if (stepInBar === 0 || stepInBar === 5) {
    toneAt(t, 112, { to: 40, dur: 0.18, type: 'sine', gain: 0.42, attack: 0.004 }); // kick
  }
  if (stepInBar === 2 || stepInBar === 6) {
    noiseAt(t, { dur: 0.09, freq: 1900, to: 1100, q: 0.9, gain: 0.11 });            // brushed snare
    toneAt(t, 220, { to: 180, dur: 0.05, type: 'triangle', gain: 0.06 });
  }
  if (stepInBar === 0) {
    toneAt(t, chord.bass, { dur: BEAT * 2.4, type: 'triangle', gain: 0.2, attack: 0.02 });
  }
  if (stepInBar === 5) {
    toneAt(t, chord.bass * 2, { dur: 0.3, type: 'triangle', gain: 0.1, attack: 0.02 });
  }
  if (stepInBar === 3) {
    // The chord stab, soft and slightly detuned — tape-warble Rhodes.
    for (const f of chord.notes) {
      toneAt(swungT, f * (1 + (Math.random() - 0.5) * 0.004), {
        dur: BEAT * 1.4, type: 'sine', gain: 0.05, attack: 0.03,
      });
    }
  }
  // Vinyl crackle: a couple of dust ticks scattered through the step.
  for (let i = 0; i < 2; i++) {
    if (Math.random() < 0.6) {
      noiseAt(t + Math.random() * EIGHTH, { dur: 0.008, freq: 4200, q: 2, gain: 0.014 + Math.random() * 0.014 });
    }
  }
}

export function startBgm(): void {
  if (!ctx || bgmTimer !== null) return;

  // The chatter bed: low-passed noise with two slow incommensurate
  // LFOs beating against each other — the murmur of a full cafe.
  chatterVoice = startLoopVoice((src, out) => {
    const f = ctx!.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    f.Q.value = 0.7;
    const lfoA = ctx!.createOscillator();
    lfoA.frequency.value = 0.13;
    const lfoB = ctx!.createOscillator();
    lfoB.frequency.value = 0.31;
    const depthA = ctx!.createGain();
    depthA.gain.value = 0.011;
    const depthB = ctx!.createGain();
    depthB.gain.value = 0.008;
    lfoA.connect(depthA).connect(out.gain);
    lfoB.connect(depthB).connect(out.gain);
    src.connect(f).connect(out);
    return [lfoA, lfoB];
  }, 0.026, 1.2);

  bgmStep = 0;
  bgmNextStepTime = now() + 0.1;
  const LOOKAHEAD = 0.6;
  bgmTimer = setInterval(() => {
    if (!ctx) return;
    while (bgmNextStepTime < now() + LOOKAHEAD) {
      scheduleStep(bgmStep, bgmNextStepTime);
      bgmStep++;
      bgmNextStepTime += EIGHTH;
    }
  }, 200);
}

export function stopBgm(): void {
  if (bgmTimer !== null) { clearInterval(bgmTimer); bgmTimer = null; }
  stopLoopVoice(chatterVoice, 0.4);
  chatterVoice = null;
}

/** Panic button for unmount/close: silence every looping voice. */
export function stopAllAudio(): void {
  stopBgm();
  steamOff();
  pourOff();
}
