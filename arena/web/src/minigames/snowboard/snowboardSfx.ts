// ═══════════════════════════════════════════════════════════════════
//  SNOQUALMIE NIGHT SHRED — synthesized sound + music.
//
//  100% Web Audio oscillators + noise buffers: no audio assets, no
//  network fetches (CloudFront's script-src 'self' CSP stays happy),
//  nothing to preload on a cold start.
//
//  Three layers:
//    1. THE BED — a looping wind-rush (lowpassed noise) plus a carve
//       hiss (bandpassed noise). The canvas loop feeds updateWind()
//       every frame; gains chase speed / edge-pressure via
//       setTargetAtTime so the mix breathes with the riding.
//    2. THE BAND — a driving 126 BPM synthwave loop: four-on-the-floor
//       kick, offbeat hats, a sawtooth octave bassline and detuned
//       chord stabs over Am–F–C–G. Scheduled with the standard
//       25 ms-interval / 120 ms-lookahead pattern so a busy main
//       thread never drops the groove.
//    3. EVENTS — gate chime (pitch climbs with the combo), wipeout
//       thud + groan, launch whoosh + crowd roar, landing thump.
//
//  iOS autoplay policy: primeAudio() MUST be called from a user
//  gesture — the modal's "SHRED" tap and canvas pointerdown do.
//  Every voice no-ops silently if audio was never primed.
// ═══════════════════════════════════════════════════════════════════

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function primeAudio(): void {
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
}

// ── Primitive voices ───────────────────────────────────────────────

/** Beep/sweep. `lp` inserts a lowpass — tames saws into bass/pads. */
function tone(
  freq: number,
  opts: { to?: number; dur?: number; delay?: number; type?: OscillatorType; gain?: number; lp?: number } = {},
): void {
  if (!ctx || !master) return;
  const { to = freq, dur = 0.12, delay = 0, type = 'triangle', gain = 0.25, lp } = opts;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    osc.connect(f).connect(g).connect(master);
  } else {
    osc.connect(g).connect(master);
  }
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise burst — whooshes, thuds, snow spray. */
function noise(
  opts: { dur?: number; delay?: number; freq?: number; to?: number; q?: number; gain?: number; type?: BiquadFilterType; attack?: number } = {},
): void {
  if (!ctx || !master) return;
  const { dur = 0.15, delay = 0, freq = 2000, to = freq, q = 1, gain = 0.2, type = 'bandpass', attack = 0 } = opts;
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
  if (attack > 0) {
    // Swell (crowd roars) instead of the default hard front.
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
  } else {
    g.gain.setValueAtTime(gain, t0);
  }
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// ── Layer 1: the wind + carve bed ──────────────────────────────────

interface WindBed {
  windGain: GainNode;
  windLp: BiquadFilterNode;
  hissGain: GainNode;
  sources: AudioBufferSourceNode[];
}
let bed: WindBed | null = null;

function loopingNoise(): AudioBufferSourceNode {
  const c = ctx as AudioContext;
  const len = c.sampleRate * 2;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

export function startWind(): void {
  if (!ctx || !master || bed) return;
  // Wind rush: lowpassed roar. Frequency and gain both open with speed.
  const wind = loopingNoise();
  const windLp = ctx.createBiquadFilter();
  windLp.type = 'lowpass';
  windLp.frequency.value = 420;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  wind.connect(windLp).connect(windGain).connect(master);
  wind.start();
  // Carve hiss: bright edge-on-snow scrape, volume rides |vx|.
  const hiss = loopingNoise();
  const hissBp = ctx.createBiquadFilter();
  hissBp.type = 'bandpass';
  hissBp.frequency.value = 2800;
  hissBp.Q.value = 0.7;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0;
  hiss.connect(hissBp).connect(hissGain).connect(master);
  hiss.start();
  bed = { windGain, windLp, hissGain, sources: [wind, hiss] };
}

/** Called every frame from the canvas loop. τ=80 ms smoothing means
 *  per-frame calls are cheap AND the mix never zippers. */
export function updateWind(speedFrac: number, carveFrac: number): void {
  if (!ctx || !bed) return;
  const t = ctx.currentTime;
  bed.windGain.gain.setTargetAtTime(0.05 + speedFrac * 0.2, t, 0.08);
  bed.windLp.frequency.setTargetAtTime(420 + speedFrac * 1400, t, 0.08);
  bed.hissGain.gain.setTargetAtTime(carveFrac * 0.14, t, 0.05);
}

export function stopWind(): void {
  if (!ctx || !bed) return;
  const t = ctx.currentTime;
  const dying = bed;
  bed = null;
  dying.windGain.gain.setTargetAtTime(0.0001, t, 0.15);
  dying.hissGain.gain.setTargetAtTime(0.0001, t, 0.15);
  for (const s of dying.sources) s.stop(t + 0.8);
}

// ── Layer 2: the synthwave band ────────────────────────────────────

const BPM = 126;
const SIXTEENTH = 60 / BPM / 4;
// One chord per bar, four-bar loop: Am – F – C – G.
const BASS_ROOTS = [110, 87.31, 130.81, 98];                      // A2 F2 C3 G2
const STABS: number[][] = [
  [220, 261.63, 329.63],   // A minor
  [174.61, 220, 261.63],   // F major
  [261.63, 329.63, 392],   // C major
  [196, 246.94, 293.66],   // G major
];

let bgmTimer: ReturnType<typeof setInterval> | null = null;
let bgmGain: GainNode | null = null;
let bgmStep = 0;
let bgmNextT = 0;

function at(t: number): number {
  return Math.max(t - (ctx as AudioContext).currentTime, 0);
}

function scheduleStep(step: number, t: number): void {
  const bar = Math.floor(step / 16) % 4;
  const i = step % 16;
  const root = BASS_ROOTS[bar];
  const delay = at(t);

  // Four-on-the-floor kick: pitched sine drop.
  if (i % 4 === 0) tone(150, { to: 42, dur: 0.16, delay, type: 'sine', gain: 0.4 });
  // Offbeat hats.
  if (i % 4 === 2) noise({ dur: 0.04, delay, freq: 7000, q: 0.7, gain: 0.06, type: 'highpass' });
  // Driving 8th-note bass, octave pop on the bar's last 8th.
  if (i % 2 === 0) {
    const f = i === 14 ? root * 2 : root;
    tone(f, { dur: 0.12, delay, type: 'sawtooth', gain: 0.14, lp: 700 });
  }
  // Chord stabs on beats 2 and 4 — the detune pair is the synthwave shimmer.
  if (i === 4 || i === 12) {
    for (const f of STABS[bar]) {
      tone(f, { dur: 0.16, delay, type: 'sawtooth', gain: 0.035, lp: 2200 });
      tone(f * 1.006, { dur: 0.16, delay, type: 'sawtooth', gain: 0.035, lp: 2200 });
    }
  }
  // Sparkle arp note once a bar, octaves above the root.
  if (i === 7) tone(root * 8, { dur: 0.1, delay, type: 'square', gain: 0.03, lp: 3600 });
}

export function startBgm(): void {
  if (!ctx || !master || bgmTimer) return;
  bgmStep = 0;
  bgmNextT = ctx.currentTime + 0.1;
  // Lookahead scheduler: wake every 25 ms, book everything due in the
  // next 120 ms. rAF jank on the game thread never skips a beat.
  bgmTimer = setInterval(() => {
    if (!ctx) return;
    while (bgmNextT < ctx.currentTime + 0.12) {
      scheduleStep(bgmStep, bgmNextT);
      bgmStep += 1;
      bgmNextT += SIXTEENTH;
    }
  }, 25);
}

export function stopBgm(): void {
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
  bgmGain = null;
}
// bgmGain is reserved for a future duck-under-results pass; the loop
// currently rides the master bus.
void bgmGain;

// ── Layer 3: events ────────────────────────────────────────────────

/** Drop-in: a lift-off riser under the first push. */
export function sfxStart(): void {
  noise({ dur: 0.7, freq: 400, to: 2400, q: 0.8, gain: 0.18 });
  tone(220, { to: 440, dur: 0.5, type: 'sawtooth', gain: 0.08, lp: 1200 });
}

/** Clean gate: digital chime, a perfect 4th apart, pitched up as the
 *  combo climbs — the streak is audible without looking at the HUD. */
export function sfxGate(combo: number): void {
  const f = 700 + Math.min(combo, 10) * 60;
  tone(f, { dur: 0.07, type: 'triangle', gain: 0.22 });
  tone(f * 4 / 3, { dur: 0.14, delay: 0.07, type: 'triangle', gain: 0.22 });
  noise({ dur: 0.08, delay: 0.05, freq: 6500, q: 0.6, gain: 0.05, type: 'highpass' });
}

/** Missed gate: one dull descending blip. Guilt, not punishment. */
export function sfxGateMissed(): void {
  tone(320, { to: 240, dur: 0.16, type: 'triangle', gain: 0.12 });
}

/** Tree/rock: heavy thud into snow + a wounded groan. */
export function sfxWipeout(): void {
  tone(100, { to: 28, dur: 0.28, type: 'sine', gain: 0.5 });                       // body drop
  noise({ dur: 0.25, freq: 900, to: 200, q: 0.8, gain: 0.3, type: 'lowpass' });    // powder burst
  tone(165, { to: 95, dur: 0.45, delay: 0.12, type: 'sawtooth', gain: 0.1, lp: 520 });   // the groan
  tone(162, { to: 92, dur: 0.45, delay: 0.12, type: 'sawtooth', gain: 0.08, lp: 520 });  // (detuned pair)
}

/** Kicker: launch whoosh, then the invisible crowd loses it. */
export function sfxRamp(): void {
  noise({ dur: 0.45, freq: 500, to: 3400, q: 0.8, gain: 0.24 });                   // launch
  noise({ dur: 1.3, delay: 0.15, freq: 950, q: 0.5, gain: 0.16, attack: 0.3 });    // crowd roar (swell)
  noise({ dur: 1.0, delay: 0.25, freq: 3200, q: 0.6, gain: 0.06, type: 'highpass', attack: 0.25 }); // whistles
  [523.25, 659.26, 783.99].forEach((f, i) =>
    tone(f, { dur: 0.3, delay: 0.1 + i * 0.08, type: 'triangle', gain: 0.1 }),
  );
}

/** Touchdown after the 360: soft thump + snow spray. */
export function sfxLand(): void {
  tone(120, { to: 60, dur: 0.12, type: 'sine', gain: 0.3 });
  noise({ dur: 0.18, freq: 2200, to: 900, q: 0.7, gain: 0.14 });
}

/** The lodge: V→I cadence, big and warm, over one last riser. */
export function sfxRunComplete(): void {
  noise({ dur: 0.5, freq: 600, to: 3000, q: 0.8, gain: 0.12 });
  for (const f of [196, 246.94, 293.66]) tone(f, { dur: 0.3, type: 'sawtooth', gain: 0.05, lp: 2000 });
  for (const f of [261.63, 329.63, 392, 523.25]) {
    tone(f, { dur: 0.9, delay: 0.32, type: 'sawtooth', gain: 0.05, lp: 2400 });
    tone(f * 1.006, { dur: 0.9, delay: 0.32, type: 'sawtooth', gain: 0.04, lp: 2400 });
  }
}

/** Claim: coin cascade down the mountain. */
export function sfxClaim(): void {
  [988, 1319, 1568, 1976, 2637].forEach((f, i) =>
    tone(f, { dur: 0.09, delay: i * 0.06, type: 'sine', gain: 0.16 }),
  );
}
