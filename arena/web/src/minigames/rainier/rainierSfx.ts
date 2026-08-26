// ═══════════════════════════════════════════════════════════════════
//  RAINIER SUMMIT SCRAMBLE — synthesized sound effects + BGM.
//
//  100% Web Audio oscillators + noise buffers: no audio assets, no
//  network fetches (CloudFront's script-src 'self' CSP stays happy),
//  and nothing to preload on a cold start. Same contract as hotdogSfx.
//
//  The soundtrack: HOWLING ALPINE WIND — a looping noise buffer pushed
//  through a bandpass whose centre frequency is swept by two slow,
//  incommensurate LFOs (the beat between them is the howl) — under
//  SUSPENSEFUL TRIBAL DRUMS, a deep floor-tom heartbeat scheduled a
//  bar at a time against ctx.currentTime.
//
//  iOS autoplay policy: primeAudio() MUST be called from a user
//  gesture — the modal's "Begin Ascent" tap and canvas pointerdown do.
//  Every voice no-ops silently if audio was never primed.
// ═══════════════════════════════════════════════════════════════════
import type { GameOverReason } from './useRainierPhysics';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function primeAudio(): void {
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

// ── Voices ─────────────────────────────────────────────────────────

/** Plain beep/sweep — thumps, horns, womps. */
function tone(
  freq: number,
  opts: { to?: number; dur?: number; delay?: number; type?: OscillatorType; gain?: number } = {},
): void {
  if (!ctx || !master) return;
  const { to = freq, dur = 0.12, delay = 0, type = 'triangle', gain = 0.25 } = opts;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise burst — crunches, rumbles, gusts. */
function noise(
  opts: { dur?: number; delay?: number; freq?: number; to?: number; q?: number; gain?: number; type?: BiquadFilterType } = {},
): void {
  if (!ctx || !master) return;
  const { dur = 0.15, delay = 0, freq = 2000, to = freq, q = 1, gain = 0.2, type = 'bandpass' } = opts;
  const t0 = ctx.currentTime + delay;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
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
}

/** The goat. A sawtooth with a fast square-ish gain tremolo — that
 *  stuttering "meh-eh-eh-eh" IS the bleat. */
function bleatVoice(freq: number, opts: { dur?: number; delay?: number; gain?: number } = {}): void {
  if (!ctx || !master) return;
  const { dur = 0.32, delay = 0, gain = 0.14 } = opts;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.78, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.setValueAtTime(gain, t0 + dur - 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  const trem = ctx.createOscillator();      // the stutter
  const tremGain = ctx.createGain();
  trem.type = 'square';
  trem.frequency.value = 15;
  tremGain.gain.value = gain * 0.55;
  trem.connect(tremGain).connect(g.gain);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;                // keeps the saw goat-throated, not buzzy
  osc.connect(lp).connect(g).connect(master);
  osc.start(t0); trem.start(t0);
  osc.stop(t0 + dur + 0.02); trem.stop(t0 + dur + 0.02);
}

/** One tribal drum hit: deep sine drop + skin-slap noise tap. */
function drum(when: number, freq: number, gain: number): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.45, when + 0.22);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
  osc.connect(g).connect(master);
  osc.start(when);
  osc.stop(when + 0.34);
  const len = Math.ceil(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gain * 0.5, when);
  ng.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
  src.connect(f).connect(ng).connect(master);
  src.start(when);
}

// ── BGM: wind loop + drum scheduler ────────────────────────────────

interface Bgm {
  windSrc: AudioBufferSourceNode;
  windGain: GainNode;
  lfos: OscillatorNode[];
  drumTimer: number;
}
let bgm: Bgm | null = null;

const BAR_SECONDS = 1.85;   // ~65 bpm heartbeat — suspense, not a rave
// Offsets within the bar (fractions): BOOM … ba-BOOM.
const DRUM_PATTERN: Array<{ at: number; freq: number; gain: number }> = [
  { at: 0.0, freq: 110, gain: 0.4 },
  { at: 0.5, freq: 82, gain: 0.22 },
  { at: 0.62, freq: 110, gain: 0.34 },
];

export function startBgm(): void {
  primeAudio();
  if (!ctx || !master || bgm) return;

  // Wind: a 2-second looping noise bed. The howl is the bandpass centre
  // swept by two slow LFOs at incommensurate rates — never repeats.
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = buf;
  windSrc.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 480;
  bp.Q.value = 1.6;
  const windGain = ctx.createGain();
  windGain.gain.setValueAtTime(0, ctx.currentTime);
  windGain.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 1.2); // the storm rolls in
  const lfos: OscillatorNode[] = [];
  for (const [rate, depth] of [[0.13, 260], [0.071, 150]] as const) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const lg = ctx.createGain();
    lg.gain.value = depth;
    lfo.connect(lg).connect(bp.frequency);
    lfo.start();
    lfos.push(lfo);
  }
  windSrc.connect(bp).connect(windGain).connect(master);
  windSrc.start();

  // Drums: schedule one bar at a time, half a bar ahead of the clock.
  let nextBar = ctx.currentTime + 0.4;
  const drumTimer = window.setInterval(() => {
    if (!ctx) return;
    while (nextBar < ctx.currentTime + BAR_SECONDS) {
      for (const hit of DRUM_PATTERN) drum(nextBar + hit.at * BAR_SECONDS, hit.freq, hit.gain);
      nextBar += BAR_SECONDS;
    }
  }, (BAR_SECONDS * 1000) / 2);

  bgm = { windSrc, windGain, lfos, drumTimer };
}

export function stopBgm(): void {
  if (!ctx || !bgm) return;
  const { windSrc, windGain, lfos, drumTimer } = bgm;
  bgm = null;
  window.clearInterval(drumTimer);
  const t = ctx.currentTime;
  windGain.gain.cancelScheduledValues(t);
  windGain.gain.setValueAtTime(windGain.gain.value, t);
  windGain.gain.linearRampToValueAtTime(0.0001, t + 0.6);
  windSrc.stop(t + 0.7);
  for (const lfo of lfos) lfo.stop(t + 0.7);
}

// ── Cues ───────────────────────────────────────────────────────────

/** Begin Ascent: a gust up the couloir + the goat announces itself. */
export function sfxStart(): void {
  noise({ dur: 0.7, freq: 400, to: 1600, q: 0.8, gain: 0.16 });
  sfxBleat();
}

/** Ice crunch — hooves biting into a ledge. Fires every bounce; kept light. */
export function sfxLand(): void {
  noise({ dur: 0.06, freq: 3400, q: 0.7, gain: 0.2, type: 'highpass' });
  tone(170, { to: 90, dur: 0.09, type: 'sine', gain: 0.14 });
}

/** The goat bleats — game start and every dodged serac. */
export function sfxBleat(): void {
  bleatVoice(700, { dur: 0.3 });
  bleatVoice(540, { dur: 0.22, delay: 0.26, gain: 0.1 });
}

/** Metal clink — a carabiner snaps onto the harness. */
export function sfxCollect(): void {
  tone(2093, { dur: 0.08, type: 'triangle', gain: 0.22 });
  tone(2793, { dur: 0.12, delay: 0.06, type: 'sine', gain: 0.18 });
  noise({ dur: 0.05, freq: 5200, q: 3, gain: 0.1 });
}

/** Heavy rumble — the mountain clears its throat before a blizzard. */
export function sfxRumble(): void {
  noise({ dur: 1.3, freq: 140, to: 90, q: 0.8, gain: 0.32, type: 'lowpass' });
  tone(48, { to: 36, dur: 1.2, type: 'sine', gain: 0.26 });
}

export function sfxGameOver(reason: GameOverReason): void {
  if (reason === 'summit') {           // horn call over the peaks, then the big chord
    tone(262, { dur: 0.22, type: 'sawtooth', gain: 0.12 });
    tone(392, { dur: 0.22, delay: 0.2, type: 'sawtooth', gain: 0.12 });
    tone(523, { dur: 0.8, delay: 0.4, type: 'sawtooth', gain: 0.14 });
    tone(659, { dur: 0.8, delay: 0.4, type: 'sawtooth', gain: 0.1 });
    tone(784, { dur: 0.8, delay: 0.4, type: 'sawtooth', gain: 0.08 });
    noise({ dur: 1.0, delay: 0.4, freq: 900, to: 2600, q: 0.7, gain: 0.08 });
  } else if (reason === 'fell') {      // the long drop
    tone(600, { to: 90, dur: 1.0, type: 'sawtooth', gain: 0.16 });
    bleatVoice(620, { dur: 0.4, gain: 0.12 });
    tone(70, { to: 40, dur: 0.5, delay: 0.9, type: 'sine', gain: 0.24 });
  } else {                             // serac hit: ice crash + low womp
    noise({ dur: 0.5, freq: 3800, to: 700, q: 1.1, gain: 0.3 });
    tone(130, { to: 50, dur: 0.45, type: 'sawtooth', gain: 0.24 });
    bleatVoice(500, { dur: 0.3, delay: 0.15, gain: 0.1 });
  }
}

/** Claim: coin cascade down the glacier. */
export function sfxClaim(): void {
  [988, 1319, 1568, 1976, 2637].forEach((f, i) =>
    tone(f, { dur: 0.09, delay: i * 0.06, type: 'sine', gain: 0.16 }),
  );
  tone(523, { dur: 0.5, delay: 0.32, type: 'triangle', gain: 0.12 });
}
