// ═══════════════════════════════════════════════════════════════════
//  SALISH SEA WHALE WATCH — synthesized sound + ambience.
//
//  100% Web Audio oscillators + noise buffers: no audio assets, no
//  network fetches (CloudFront's script-src 'self' CSP stays happy),
//  and nothing to preload on a cold start.
//
//  The soundscape: a looping ocean bed (lowpassed noise with a slow
//  swell LFO), a soft low tide-pulse at ~43 BPM, and a quiet open
//  fifth of a pad underneath. Sightings announce themselves with
//  imitations of the real animals' calls — orca whistle glides and
//  click trains, porpoise click bursts, a low humpback moan — and a
//  PERFECT release rings a long resonant chime.
//
//  iOS autoplay policy: primeAudio() MUST be called from a user
//  gesture — the modal's "Push Off" tap and canvas pointerdown do.
//  Every voice no-ops silently if audio was never primed.
// ═══════════════════════════════════════════════════════════════════
import type { Grade, MarineKind } from './useWhaleWatchPhysics';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function primeAudio(): void {
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

// ── Voices ─────────────────────────────────────────────────────────

/** Plain tone/sweep — thumps, plops, pad notes, chime partials. */
function tone(
  freq: number,
  opts: { to?: number; dur?: number; delay?: number; type?: OscillatorType; gain?: number } = {},
): void {
  if (!ctx || !master) return;
  const { to = freq, dur = 0.12, delay = 0, type = 'sine', gain = 0.2 } = opts;
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

/** Filtered noise burst — splashes, spray, click trains. */
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

/** One whale-call glide: sine sweep with vibrato through a lowpass. */
function call(
  f0: number,
  f1: number,
  opts: { dur?: number; delay?: number; vibHz?: number; vibAmt?: number; gain?: number } = {},
): void {
  if (!ctx || !master) return;
  const { dur = 0.7, delay = 0, vibHz = 6, vibAmt = 18, gain = 0.1 } = opts;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = vibHz;
  lfoGain.gain.value = vibAmt;
  lfo.connect(lfoGain).connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.2);
  g.gain.setValueAtTime(gain, t0 + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(lp).connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  lfo.start(t0);
  lfo.stop(t0 + dur);
}

/** Echolocation click train: n tiny high-frequency ticks. */
function clicks(n: number, spacing: number, delay = 0): void {
  for (let i = 0; i < n; i++) {
    noise({ dur: 0.025, delay: delay + i * spacing, freq: 5200, q: 2.5, gain: 0.05, type: 'highpass' });
  }
}

// ── Cues ───────────────────────────────────────────────────────────

/** A shadow slid into view — each animal announces itself. */
export function sfxShadow(kind: MarineKind): void {
  switch (kind) {
    case 'orca':      // two haunting whistle glides over a click train
      call(1250, 620, { dur: 0.7, gain: 0.09 });
      call(1050, 500, { dur: 0.8, delay: 0.4, gain: 0.07 });
      clicks(9, 0.05, 0.1);
      break;
    case 'porpoise':  // busy click bursts and one short chirp
      clicks(7, 0.035);
      clicks(5, 0.045, 0.35);
      call(1900, 1500, { dur: 0.16, delay: 0.2, vibAmt: 0, gain: 0.05 });
      break;
    case 'humpback':  // long low moan — you feel this one coming
      call(230, 130, { dur: 1.5, vibHz: 3, vibAmt: 8, gain: 0.12 });
      break;
  }
}

/** The breach launches: shearing water + a sub whoosh. */
export function sfxBreach(kind: MarineKind): void {
  const big = kind !== 'porpoise';
  noise({ dur: big ? 0.55 : 0.35, freq: 420, to: 2400, q: 0.8, gain: big ? 0.22 : 0.15 });
  tone(90, { to: 45, dur: 0.4, type: 'sine', gain: big ? 0.14 : 0.08 });
}

/** Re-entry splash, sized to the animal. */
export function sfxSplash(kind: MarineKind): void {
  const big = kind !== 'porpoise';
  noise({ dur: big ? 0.55 : 0.32, freq: 1400, to: 300, q: 0.7, gain: big ? 0.3 : 0.18, type: 'lowpass' });
  noise({ dur: 0.12, delay: 0.12, freq: 3600, q: 0.8, gain: 0.08, type: 'highpass' });   // spray
  if (big) noise({ dur: 0.1, delay: 0.24, freq: 3000, q: 0.8, gain: 0.05, type: 'highpass' });
}

/** The graded release. */
export function sfxResult(grade: Grade): void {
  if (grade === 'perfect') {
    // Long resonant chime: staggered pure partials + a breath of shimmer.
    [523.3, 659.3, 784, 1046.5, 1568].forEach((f, i) =>
      tone(f, { dur: 1.2 - i * 0.12, delay: i * 0.05, type: 'sine', gain: 0.11 }),
    );
    noise({ dur: 0.5, freq: 6500, q: 0.6, gain: 0.03, type: 'highpass' });
  } else if (grade === 'good') {
    tone(392, { dur: 0.22, gain: 0.12 });
    tone(523.3, { dur: 0.34, delay: 0.09, gain: 0.12 });
  } else {
    tone(170, { to: 85, dur: 0.28, type: 'triangle', gain: 0.14 });          // dull plop
    noise({ dur: 0.2, freq: 700, to: 250, q: 0.8, gain: 0.1, type: 'lowpass' });
  }
}

/** Sundown: a soft settling cadence over the last wave. */
export function sfxSunset(): void {
  noise({ dur: 1.6, freq: 500, to: 220, q: 0.5, gain: 0.1, type: 'lowpass' });
  [392, 329.6, 261.6].forEach((f, i) => tone(f, { dur: 0.8, delay: i * 0.35, gain: 0.09 }));
  tone(196, { dur: 1.6, delay: 1.05, gain: 0.1 });
}

// ── Ambience (BGM) ─────────────────────────────────────────────────
// Started from the wrapper on "Push Off", stopped on game over/close.
// The tide-pulse is scheduled with a lookahead interval so it never
// drifts, and every node is tracked for a clean teardown.

interface Bgm {
  sources: AudioNode[];
  stops: Array<{ stop: (when?: number) => void }>;
  timer: number;
  out: GainNode;
}
let bgm: Bgm | null = null;

export function startBgm(): void {
  if (!ctx || !master || bgm) return;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);   // fade the sea in
  out.connect(master);

  const sources: AudioNode[] = [out];
  const stops: Array<{ stop: (when?: number) => void }> = [];

  // Ocean bed: looping noise → lowpass, swelling on a slow LFO.
  const len = Math.ceil(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const sea = ctx.createBufferSource();
  sea.buffer = buf;
  sea.loop = true;
  const seaLp = ctx.createBiquadFilter();
  seaLp.type = 'lowpass';
  seaLp.frequency.value = 420;
  const seaGain = ctx.createGain();
  seaGain.gain.value = 0.07;
  const swell = ctx.createOscillator();
  const swellGain = ctx.createGain();
  swell.frequency.value = 0.08;                                  // one swell ≈ 12 s
  swellGain.gain.value = 0.035;
  swell.connect(swellGain).connect(seaGain.gain);
  sea.connect(seaLp).connect(seaGain).connect(out);
  sea.start();
  swell.start();
  sources.push(sea, seaLp, seaGain, swell, swellGain);
  stops.push(sea, swell);

  // Pad: a barely-there open fifth (G2 + D3) under everything.
  for (const f of [98, 146.8]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.022;
    osc.connect(g).connect(out);
    osc.start();
    sources.push(osc, g);
    stops.push(osc);
  }

  // Tide-pulse: a soft low thump every 1.4 s, lookahead-scheduled.
  let nextBeat = ctx.currentTime + 0.8;
  const scheduleThump = (t0: number) => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(58, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.11, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  };
  const timer = window.setInterval(() => {
    if (!ctx) return;
    while (nextBeat < ctx.currentTime + 0.6) {
      scheduleThump(nextBeat);
      nextBeat += 1.4;
    }
  }, 250);

  bgm = { sources, stops, timer, out };
}

export function stopBgm(): void {
  if (!bgm || !ctx) return;
  const { sources, stops, timer, out } = bgm;
  bgm = null;
  window.clearInterval(timer);
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
  out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);    // fade out, then tear down
  const t = ctx.currentTime + 0.55;
  for (const s of stops) s.stop(t);
  window.setTimeout(() => { for (const n of sources) n.disconnect(); }, 700);
}
