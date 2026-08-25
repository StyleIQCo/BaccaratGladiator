// ═══════════════════════════════════════════════════════════════════
//  HOTDOG PARACHUTE DROP — synthesized sound effects.
//
//  100% Web Audio oscillators + noise buffers: no audio assets, no
//  network fetches (CloudFront's script-src 'self' CSP stays happy),
//  and nothing to preload on a cold start.
//
//  The band: a procedural ACCORDION — the quintessential Oktoberfest
//  oompah instrument. The voice is "musette" tuning: three sawtooth
//  reeds, one true and two detuned ±0.65%, through a lowpass with a
//  soft bellows attack. The beat-frequency shimmer between the reeds
//  IS the accordion sound. Every catch lands on an accordion lick;
//  beer gets a full oom-pah-pah (tuba oom, chord pahs).
//
//  iOS autoplay policy: primeAudio() MUST be called from a user
//  gesture — the modal's "Drop In!" tap and canvas pointerdown do.
//  Every voice no-ops silently if audio was never primed.
// ═══════════════════════════════════════════════════════════════════
import type { GameOverReason, ItemKind } from './useHotdogPhysics';

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

/** Plain beep/sweep — used for the non-band layers (tuba oom, hums, womps). */
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

/** Filtered noise burst — bites, crunches, sizzle, beer fizz. */
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

/** One accordion note: musette reed trio + bellows envelope. */
function accordion(
  freq: number,
  opts: { dur?: number; delay?: number; gain?: number; tremolo?: boolean } = {},
): void {
  if (!ctx || !master) return;
  const { dur = 0.18, delay = 0, gain = 0.09, tremolo = false } = opts;
  const t0 = ctx.currentTime + delay;

  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(gain, t0 + 0.035);        // bellows swell, not a piano hit
  const rel = Math.max(t0 + dur - 0.06, t0 + 0.04);
  out.gain.setValueAtTime(gain, rel);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;                                 // tames the saw buzz into reediness
  lp.connect(out);
  out.connect(master);

  if (tremolo) {                                             // bellows shake on held notes
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = gain * 0.3;
    lfo.connect(lfoGain).connect(out.gain);
    lfo.start(t0);
    lfo.stop(t0 + dur);
  }

  for (const det of [1, 1.0065, 0.9935]) {                   // the musette detune trio
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq * det;
    const g = ctx.createGain();
    g.gain.value = 1 / 3;
    osc.connect(g).connect(lp);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

function accordionChord(
  freqs: number[],
  opts: { dur?: number; delay?: number; gain?: number; tremolo?: boolean } = {},
): void {
  const per = (opts.gain ?? 0.09) / Math.sqrt(freqs.length);
  for (const f of freqs) accordion(f, { ...opts, gain: per });
}

// C-major festival palette.
const N = {
  G2: 98, B3: 246.9, C4: 261.6, E4: 329.6, G4: 392, B4: 493.9,
  C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, C6: 1046.5,
} as const;

// ── Cues ───────────────────────────────────────────────────────────

/** Drop-in: wind whoosh + a quick warm-up arpeggio from the band. */
export function sfxStart(): void {
  noise({ dur: 0.6, freq: 500, to: 1800, q: 0.8, gain: 0.16 });
  accordion(N.C4, { dur: 0.1, delay: 0.05 });
  accordion(N.E4, { dur: 0.1, delay: 0.15 });
  accordion(N.G4, { dur: 0.22, delay: 0.25 });
}

/** Catch: bite crunch, then an accordion lick sized to the prize. */
export function sfxCatch(kind: ItemKind): void {
  noise({ dur: 0.07, freq: 3200, q: 0.7, gain: 0.28, type: 'highpass' });          // chomp
  noise({ dur: 0.05, delay: 0.1, freq: 2600, q: 0.7, gain: 0.2, type: 'highpass' }); // second bite
  switch (kind) {
    case 'plain_hotdog':
      accordion(N.C5, { dur: 0.16 });
      break;
    case 'pretzel':
      accordionChord([N.G4, N.B4], { dur: 0.2 });
      break;
    case 'mustard_relish':
      accordionChord([N.E5, N.G5], { dur: 0.2 });
      break;
    case 'beer_stein':                                       // OOM-pah-pah + fizz
      tone(N.G2, { dur: 0.14, type: 'triangle', gain: 0.3 });
      accordionChord([N.C4, N.E4, N.G4], { dur: 0.11, delay: 0.13 });
      accordionChord([N.C4, N.E4, N.G4], { dur: 0.11, delay: 0.27 });
      noise({ dur: 0.35, delay: 0.05, freq: 6000, q: 0.6, gain: 0.07, type: 'highpass' });
      break;
    case 'chili_cheese':                                     // run up to a held high C
      accordion(N.C5, { dur: 0.09 });
      accordion(N.E5, { dur: 0.09, delay: 0.08 });
      accordion(N.G5, { dur: 0.09, delay: 0.16 });
      accordion(N.C6, { dur: 0.4, delay: 0.24, tremolo: true });
      break;
    case 'burnt_hotdog':                                     // sfxHazard owns this cue
      break;
  }
  tone(235, { to: 196, dur: 0.28, delay: 0.18, type: 'sine', gain: 0.09 });        // satisfied hum
}

/** Burnt dog: sizzle, low womp, and a sour semitone from the band. */
export function sfxHazard(): void {
  noise({ dur: 0.45, freq: 4200, to: 900, q: 1.2, gain: 0.28 });
  tone(140, { to: 55, dur: 0.4, type: 'sawtooth', gain: 0.24 });
  accordionChord([N.B3, N.C4], { dur: 0.3, gain: 0.12 });
}

export function sfxGameOver(reason: GameOverReason): void {
  if (reason === 'time') {                                   // proper V→I cadence, big finish
    accordionChord([N.G4, N.B4, N.D5], { dur: 0.28, gain: 0.12 });
    accordionChord([N.C5, N.E5, N.G5, N.C6], { dur: 0.7, delay: 0.3, gain: 0.14, tremolo: true });
  } else {                                                   // sad-trombone descent
    tone(311, { dur: 0.26, type: 'sawtooth', gain: 0.15 });
    tone(294, { dur: 0.26, delay: 0.22, type: 'sawtooth', gain: 0.15 });
    tone(277, { dur: 0.26, delay: 0.44, type: 'sawtooth', gain: 0.15 });
    tone(262, { to: 240, dur: 0.7, delay: 0.66, type: 'sawtooth', gain: 0.17 });
  }
}

/** Claim: coin cascade + one last chord from the tent. */
export function sfxClaim(): void {
  [988, 1319, 1568, 1976, 2637].forEach((f, i) =>
    tone(f, { dur: 0.09, delay: i * 0.06, type: 'sine', gain: 0.16 }),
  );
  accordionChord([N.C5, N.E5, N.G5], { dur: 0.5, delay: 0.3, gain: 0.1, tremolo: true });
}
