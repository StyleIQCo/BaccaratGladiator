// ═══════════════════════════════════════════════════════════════════
//  DAILY RACE BONUS — the jumbotron broadcast, assembled.
//
//  Beat sheet:
//    1. pick    — three champion cards under an idle-drifting canvas;
//                 tapping one rolls the winner and cuts to the race.
//    2. GO!     — one-shot flash, engine-rev SFX, crowd loop fades in,
//                 the canvas throttles from drift to full scream.
//    3. race    — 10s of Framer Motion keyframes (track-% → px against
//                 the measured lane width, transform-only so the
//                 compositor owns it). A 400ms ticker interpolates the
//                 timelines to caption whoever leads right now.
//    4. payoff  — winner's onAnimationComplete flips the state machine,
//                 air-horn fires, and after a beat the result modal
//                 springs in: +5,000 (picked right) or +1,000 (pity).
//
//  Daily gate lives in the hook (localStorage date stamp) — a claimed
//  day shows "come back tomorrow" instead of the champion cards.
//  SFX files are expected at public/sfx/daily-race/ (see SFX map).
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SpeedBackground } from './SpeedBackground';
import {
  PARTICIPATION_CHIPS, RACE_DURATION_MS, WIN_CHIPS,
  progressAt, useJumbotronRace,
  type Racer, type RaceStatus,
} from './useJumbotronRace';

// ── Audio ──────────────────────────────────────────────────────────
// Placeholder synth WAVs — swap for licensed audio by replacing the
// files in ./sfx/. Imported as assets so the bundler owns the URLs:
// dev, prod (/arena/ base), and single-file demo builds all resolve.
import revUrl from './sfx/engine-rev.wav';
import crowdUrl from './sfx/crowd-loop.wav';
import hornUrl from './sfx/win-horn.wav';

const SFX = {
  rev: revUrl,     // one-shot at the GO! flash
  crowd: crowdUrl, // loops under the whole race
  horn: hornUrl,   // stadium air-horn at the finish line
} as const;

function useRaceAudio(raceStatus: RaceStatus) {
  const bank = useRef<Partial<Record<keyof typeof SFX, HTMLAudioElement>>>({});

  useEffect(() => {
    const get = (key: keyof typeof SFX) =>
      (bank.current[key] ??= new Audio(SFX[key]));

    // play() promises are caught: iOS can refuse if the gesture context
    // expired, and a silent race beats an unhandled-rejection crash.
    if (raceStatus === 'racing') {
      const rev = get('rev');
      rev.currentTime = 0;
      rev.volume = 0.9;
      rev.play().catch(() => {});
      const crowd = get('crowd');
      crowd.loop = true;
      crowd.volume = 0.55;
      crowd.play().catch(() => {});
    } else if (raceStatus === 'finished') {
      bank.current.crowd?.pause();
      const horn = get('horn');
      horn.currentTime = 0;
      horn.volume = 1;
      horn.play().catch(() => {});
    } else {
      Object.values(bank.current).forEach(a => a.pause());
    }
  }, [raceStatus]);

  // hard mute on unmount — a looping crowd outliving the modal is a bug
  useEffect(() => () => Object.values(bank.current).forEach(a => a.pause()), []);
}

// ── Confetti chips for the win modal ───────────────────────────────
function ChipBurst({ count = 14 }: { count?: number }) {
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        dx: (Math.random() - 0.5) * 280,
        dy: (Math.random() - 0.5) * 220,
        rot: (Math.random() - 0.5) * 540,
        dur: 0.7 + Math.random() * 0.5,
        delay: Math.random() * 0.15,
        glyph: ['🪙', '💰', '✨'][i % 3],
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10">
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -ml-2 -mt-2 text-xl"
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: p.dx, y: p.dy, rotate: p.rot, opacity: 0 }}
          transition={{ duration: p.dur, delay: p.delay, ease: 'easeOut' }}
        >
          {p.glyph}
        </motion.span>
      ))}
    </div>
  );
}

// ── Racer sprite: glow trail + bobbing emoji + name plate ──────────
const RACER_W = 72; // px reserved for the sprite when converting % → px
const LANE_TOPS = ['16%', '42%', '68%'];

function RacerSprite({ racer, picked, bob }: { racer: Racer; picked: boolean; bob: boolean }) {
  return (
    <div className="relative flex items-center">
      {/* exhaust trail, colored per champion */}
      <div
        className="absolute right-full top-1/2 h-2 w-16 -translate-y-1/2 rounded-full opacity-70"
        style={{ background: `linear-gradient(to left, ${racer.color}, transparent)` }}
      />
      <motion.span
        className="text-4xl sm:text-5xl"
        style={{ filter: `drop-shadow(0 0 8px ${racer.color})` }}
        animate={bob ? { y: [0, -3, 0], rotate: [0, -2, 0] } : undefined}
        transition={{ duration: 0.35, repeat: Infinity, ease: 'easeInOut' }}
      >
        {racer.icon}
      </motion.span>
      <span
        className={`absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-bold tracking-wider ${
          picked ? 'bg-neon-gold text-abyss-900' : 'bg-abyss-900/80 text-white/70'
        }`}
      >
        {picked ? '★ YOU' : racer.name.replace('The ', '')}
      </span>
    </div>
  );
}

// ── Master component ───────────────────────────────────────────────
export interface DailyRaceBonusProps {
  /** Grant chips in the host app when the player collects. */
  onClaim?: (chips: number) => void;
  onClose?: () => void;
}

export function DailyRaceBonus({ onClaim, onClose }: DailyRaceBonusProps) {
  const race = useJumbotronRace();
  const reducedMotion = useReducedMotion() ?? false;
  useRaceAudio(race.raceStatus);

  // Lanes are % of a track we must measure — Framer animates transform-x
  // in px so the compositor never touches layout mid-race. The track div
  // only exists once the race screen mounts, so the observer hangs off a
  // callback-ref'd state, not a mount-time effect.
  const [trackEl, setTrackEl] = useState<HTMLDivElement | null>(null);
  const [trackW, setTrackW] = useState(0);
  useLayoutEffect(() => {
    if (!trackEl) return;
    const ro = new ResizeObserver(() => setTrackW(trackEl.clientWidth));
    ro.observe(trackEl);
    setTrackW(trackEl.clientWidth);
    return () => ro.disconnect();
  }, [trackEl]);
  const travel = Math.max(0, trackW - RACER_W - 28); // 100% lands on the checkered strip

  // Live leader caption: interpolate the authored timelines a few times
  // a second — no re-render of the racers themselves, just the banner.
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const raceStartRef = useRef(0);
  useEffect(() => {
    if (race.raceStatus !== 'racing') return;
    raceStartRef.current = performance.now();
    const tick = setInterval(() => {
      const elapsed = performance.now() - raceStartRef.current;
      let best: string | null = null;
      let bestPct = -1;
      for (const r of race.racers) {
        const pct = progressAt(race.timelines[r.id], elapsed);
        if (pct > bestPct) { bestPct = pct; best = r.id; }
      }
      setLeaderId(best);
    }, 400);
    return () => clearInterval(tick);
  }, [race.raceStatus, race.racers, race.timelines]);

  const leader = race.racers.find(r => r.id === leaderId);
  const winner = race.racers.find(r => r.id === race.winnerId);
  const racing = race.raceStatus === 'racing';
  const finished = race.raceStatus === 'finished';

  const collect = () => {
    const chips = race.claimReward();
    onClaim?.(chips);
    if (onClose) onClose();
    else race.reset(); // no host close handler → fall back to the claimed screen
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-abyss-900/90 p-3 backdrop-blur-sm">
      {/* jumbotron bezel */}
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border-4 border-abyss-600 bg-abyss-800 shadow-chunky">
        {/* marquee bar */}
        <div className="flex items-center justify-between border-b-2 border-abyss-600 bg-abyss-700 px-4 py-2">
          <span className="font-display text-sm font-black tracking-[0.2em] text-neon-gold">
            🏁 DAILY JUMBOTRON RACE
          </span>
          {!racing && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded px-2 text-lg text-white/50 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* screen */}
        <div className="relative h-[52vh] max-h-[460px] min-h-[320px]">
          <SpeedBackground active={racing} />

          {/* ── selection / claimed ── */}
          {race.raceStatus === 'selection' && (race.claimedToday ? (
            <div className="relative flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="text-5xl">🏁</span>
              <h2 className="font-display text-2xl font-black text-neon-gold">RACE COMPLETE</h2>
              <p className="text-sm text-white/70">
                Today's bonus is banked. Come back tomorrow for the next race!
              </p>
              <button
                onClick={onClose}
                className="mt-2 rounded-xl bg-abyss-600 px-6 py-3 font-display font-bold text-white shadow-chunky-sm"
              >
                BACK TO THE TABLES
              </button>
            </div>
          ) : (
            <div className="relative flex h-full flex-col items-center justify-center gap-4 p-4">
              <motion.h2
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center font-display text-2xl font-black text-neon-gold [text-shadow:0_0_18px_rgba(255,210,74,0.6)] sm:text-3xl"
              >
                PICK YOUR CHAMPION FOR THE DAILY BONUS!
              </motion.h2>
              <p className="text-[11px] tracking-[0.3em] text-neon-blue/80">
                WINNER TAKES {WIN_CHIPS.toLocaleString()} CHIPS
              </p>
              <div className="grid w-full max-w-xl grid-cols-3 gap-2 sm:gap-4">
                {race.racers.map((r, i) => (
                  <motion.button
                    key={r.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.08 }}
                    whileHover={{ y: -4 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => race.startRace(r.id)}
                    className="flex flex-col items-center gap-1 rounded-xl border-2 bg-abyss-700/90 p-3 shadow-chunky-sm sm:p-4"
                    style={{ borderColor: r.color, boxShadow: `0 0 18px ${r.color}44` }}
                  >
                    <span className="text-4xl sm:text-5xl">{r.icon}</span>
                    <span className="font-display text-xs font-black text-white sm:text-sm">{r.name}</span>
                    <span className="text-[9px] text-white/50 sm:text-[10px]">{r.tagline}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          ))}

          {/* ── race broadcast ── */}
          {(racing || finished) && (
            <div ref={setTrackEl} className="absolute inset-0">
              {/* checkered finish strip */}
              <div
                className="absolute bottom-0 right-5 top-0 w-3 opacity-90"
                style={{ background: 'repeating-conic-gradient(#fff 0% 25%, #111 0% 50%) 0 0 / 12px 12px' }}
              />
              {/* lane separators */}
              {LANE_TOPS.map(top => (
                <div key={top} className="absolute left-0 right-0 border-t border-dashed border-white/10" style={{ top: `calc(${top} + 34px)` }} />
              ))}

              {trackW > 0 && race.racers.map((r, i) => (
                <motion.div
                  key={r.id}
                  className="absolute left-2 will-change-transform"
                  style={{ top: LANE_TOPS[i] }}
                  animate={{ x: race.timelines[r.id].map(pct => (pct / 100) * travel) }}
                  transition={{ duration: RACE_DURATION_MS / 1000, ease: 'linear' }}
                  onAnimationComplete={r.id === race.winnerId ? race.finishRace : undefined}
                >
                  <RacerSprite racer={r} picked={r.id === race.selectedRacerId} bob={racing && !reducedMotion} />
                </motion.div>
              ))}

              {/* live leader caption */}
              <AnimatePresence mode="wait">
                {racing && leader && (
                  <motion.div
                    key={leader.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-abyss-900/80 px-3 py-1 text-[10px] font-bold tracking-[0.15em] text-neon-blue"
                  >
                    ⚡ {leader.name.replace('The ', '').toUpperCase()} LEADS!
                  </motion.div>
                )}
              </AnimatePresence>

              {/* GO! flash */}
              <AnimatePresence>
                {racing && (
                  <motion.div
                    initial={{ opacity: 1, scale: 0.4 }}
                    animate={{ opacity: 0, scale: 2.2 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 grid place-items-center font-display text-7xl font-black text-neon-green [text-shadow:0_0_30px_rgba(61,255,143,0.8)]"
                  >
                    GO!
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* scanlines — the jumbotron tell, over every screen state */}
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.25) 0 1px, transparent 1px 3px)' }}
          />
        </div>

        {/* ── payoff modal ── */}
        <AnimatePresence>
          {finished && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }} // let the finish-line moment breathe first
              className="absolute inset-0 z-20 grid place-items-center bg-abyss-900/85 p-4"
            >
              <motion.div
                initial={{ scale: 0.7, y: 30 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ delay: 0.8, type: 'spring', stiffness: 260, damping: 18 }}
                className={`relative flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl border-2 bg-abyss-800 p-6 text-center ${
                  race.didWin ? 'border-neon-gold shadow-glow-gold' : 'border-abyss-600 shadow-chunky'
                }`}
              >
                {race.didWin && !reducedMotion && <ChipBurst />}
                <span className="text-6xl">{race.didWin ? '🏆' : '🏁'}</span>
                <h3 className={`font-display text-2xl font-black ${race.didWin ? 'text-neon-gold' : 'text-white'}`}>
                  {race.didWin ? 'WINNER!' : 'PHOTO FINISH!'}
                </h3>
                <p className="text-xs text-white/60">
                  {winner ? `${winner.icon} ${winner.name} takes the cup` : ''}
                  {race.didWin ? ' — and you called it!' : ` — your pick came up short.`}
                </p>
                <div
                  className={`my-2 font-display text-4xl font-black ${
                    race.didWin ? 'text-neon-gold [text-shadow:0_0_24px_rgba(255,210,74,0.7)]' : 'text-neon-blue'
                  }`}
                >
                  +{(race.didWin ? WIN_CHIPS : PARTICIPATION_CHIPS).toLocaleString()} CHIPS
                </div>
                <span className="text-[10px] tracking-[0.25em] text-white/40">
                  {race.didWin ? '5× DAILY MULTIPLIER' : 'PARTICIPATION BONUS'}
                </span>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={collect}
                  className="animate-pulse-glow mt-3 w-full rounded-xl bg-neon-gold px-6 py-3 font-display text-lg font-black text-abyss-900 shadow-chunky-sm"
                >
                  COLLECT
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
