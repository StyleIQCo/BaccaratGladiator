// ═══════════════════════════════════════════════════════════════════
//  AEGEAN TABLE — the referral-only Odyssey stage. Cinematic-epic
//  read: a starry Mediterranean night (twinkling starfield + moon)
//  over three parallax ocean layers rolling behind a white-marble
//  betting layout framed in gold, with a Greek-key meander strip.
//
//  Build notes:
//   · Marble + wood are pure CSS gradient stacks — no image assets
//     (prod CSP is 'self'-only and the iOS bundle audit hates strays).
//   · Waves: each layer is a 200%-wide strip holding two identical
//     SVGs, translated x 0 → -50% on a linear loop = seamless scroll.
//     Back layer drifts slowest for depth. All loops park under
//     prefers-reduced-motion.
//   · Zone labels carry Greek subtitles (ΠΑΙΚΤΗΣ/ΙΣΟΠΑΛΙΑ/ΤΡΑΠΕΖΑ) —
//     flavor only, not localization; real i18n stays in i18n/.
//   · Side bets (TrojanHorseBet) mount via the children slot.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

// ── Shared surface recipes ──────────────────────────────────────────
/** Bright white marble: cool base, two crossing vein rasters, top sheen. */
export const MARBLE: CSSProperties = {
  backgroundColor: '#eceae4',
  backgroundImage: [
    'radial-gradient(120% 90% at 30% 8%, rgba(255,255,255,0.9), rgba(255,255,255,0) 55%)',
    'repeating-linear-gradient(104deg, rgba(100,116,139,0.13) 0 1px, transparent 1px 13px)',
    'repeating-linear-gradient(63deg, rgba(148,163,184,0.17) 0 1px, transparent 1px 8px)',
    'linear-gradient(160deg, #f7f6f2, #dcd9d0)',
  ].join(', '),
};

/** Gold casino chip that drops onto a zone when the bet lands. */
export function GoldChip({ label = 'Ω' }: { label?: string }) {
  return (
    <motion.span
      initial={{ y: -46, scale: 0, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 17 }}
      className="absolute -top-3 left-1/2 z-10 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border-[3px] border-dashed border-yellow-100/80 font-display text-xs font-black text-amber-900 shadow-glow-gold"
      style={{ background: 'radial-gradient(circle at 35% 30%, #ffe9a3, #ffd24a 55%, #c9971d)' }}
      aria-hidden
    >
      {label}
    </motion.span>
  );
}

// ── Night sky ───────────────────────────────────────────────────────
function Starfield({ reduced }: { reduced: boolean }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 46 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 56,          // stars stay above the waterline
        size: 1 + Math.random() * 1.8,
        dur: 2.2 + Math.random() * 3.4,
        delay: Math.random() * 4,
        base: 0.25 + Math.random() * 0.4,
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size }}
          animate={{ opacity: reduced ? s.base : [s.base, 1, s.base] }}
          transition={reduced ? { duration: 0 } : { duration: s.dur, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      {/* Moon over the Aegean — soft double halo */}
      <div
        className="absolute right-[8%] top-[9%] h-14 w-14 rounded-full"
        style={{
          background: 'radial-gradient(circle at 38% 34%, #fdf6dd, #e8d9a0 60%, #cbb877)',
          boxShadow: '0 0 40px rgba(253,246,221,0.45), 0 0 90px rgba(253,246,221,0.18)',
        }}
      />
    </div>
  );
}

// ── Ocean ───────────────────────────────────────────────────────────
const WAVE_PATH =
  'M0 60 C120 24 240 24 360 60 S600 96 720 60 S960 24 1080 60 S1320 96 1440 60 V120 H0 Z';

function WaveLayer({
  dur, height, bottom, fill, crest, reduced,
}: {
  dur: number; height: string; bottom: string; fill: string;
  /** Optional moonlight glint traced along the wave top. */
  crest?: string;
  reduced: boolean;
}) {
  return (
    <motion.div
      className="absolute left-0 flex w-[200%]"
      style={{ bottom }}
      animate={reduced ? undefined : { x: ['0%', '-50%'] }}
      transition={reduced ? undefined : { duration: dur, repeat: Infinity, ease: 'linear' }}
      aria-hidden
    >
      {[0, 1].map(i => (
        <svg key={i} viewBox="0 0 1440 120" preserveAspectRatio="none"
          className="w-1/2 shrink-0" style={{ height }}>
          <path d={WAVE_PATH} fill={fill} />
          {crest && <path d={WAVE_PATH} fill="none" stroke={crest} strokeWidth="2.5" />}
        </svg>
      ))}
    </motion.div>
  );
}

// ── Ornament ────────────────────────────────────────────────────────
/** Greek-key meander strip, an SVG pattern so it tiles at any width. */
function MeanderStrip() {
  return (
    <svg className="h-3 w-full opacity-70" aria-hidden>
      <defs>
        <pattern id="aegeanMeander" width="14" height="12" patternUnits="userSpaceOnUse">
          <path d="M1 10 H10 V2 H4 V6 H7" fill="none" stroke="#ffd24a" strokeWidth="1.3" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#aegeanMeander)" />
    </svg>
  );
}

// ── Main betting zones ──────────────────────────────────────────────
type ZoneId = 'player' | 'tie' | 'banker';

const ZONES: Array<{ id: ZoneId; label: string; greek: string; pays: string }> = [
  { id: 'player', label: 'PLAYER', greek: 'ΠΑΙΚΤΗΣ',  pays: 'PAYS 1:1' },
  { id: 'tie',    label: 'TIE',    greek: 'ΙΣΟΠΑΛΙΑ', pays: 'PAYS 8:1' },
  { id: 'banker', label: 'BANKER', greek: 'ΤΡΑΠΕΖΑ',  pays: 'PAYS 19:20' },
];

export default function AegeanTable({ children }: { children?: ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const [selected, setSelected] = useState<ZoneId | null>(null);

  return (
    <section
      className="relative overflow-hidden rounded-[2rem] border border-blue-300/15 bg-gradient-to-b from-slate-900 via-blue-950 to-blue-900 shadow-chunky"
      aria-label="The Aegean Table — referral-only Odyssey stage"
    >
      <Starfield reduced={reduced} />

      {/* Three-layer parallax swell; front layer catches the moonlight */}
      <div className="absolute inset-x-0 bottom-0 h-32 overflow-hidden" aria-hidden>
        <WaveLayer dur={30} height="110px" bottom="14px" fill="rgba(30,58,138,0.45)" reduced={reduced} />
        <WaveLayer dur={21} height="90px"  bottom="6px"  fill="rgba(29,78,166,0.55)" reduced={reduced} />
        <WaveLayer dur={14} height="70px"  bottom="0px"  fill="rgba(15,30,80,0.92)"
          crest="rgba(255,210,74,0.16)" reduced={reduced} />
      </div>

      <div className="relative z-10 px-4 pb-12 pt-6 sm:px-8">
        {/* Stage plaque */}
        <header className="mb-5 text-center">
          <div className="font-display text-2xl font-black tracking-[0.25em] text-neon-gold"
            style={{ textShadow: '0 0 22px rgba(255,210,74,0.5)' }}>
            THE AEGEAN TABLE
          </div>
          <div className="mt-1 text-[0.6rem] tracking-[0.4em] text-blue-200/60">
            REFERRAL-ONLY VOYAGE · ΚΑΛΗ ΤΥΧΗ
          </div>
        </header>

        {/* Marble layout in a gold frame */}
        <div className="mx-auto max-w-xl rounded-[1.6rem] bg-gradient-to-br from-yellow-200 via-amber-400 to-yellow-600 p-[3px] shadow-glow-gold">
          <div className="rounded-[1.45rem] px-3 pb-4 pt-2 sm:px-5" style={MARBLE}>
            <MeanderStrip />

            <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
              {ZONES.map(z => {
                const isSel = selected === z.id;
                return (
                  <motion.button
                    key={z.id}
                    onClick={() => setSelected(isSel ? null : z.id)}
                    whileHover={{ scale: 1.03, y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    aria-pressed={isSel}
                    className={`relative rounded-2xl border-2 px-1 pb-3 pt-4 text-center transition-shadow duration-200 ${
                      isSel ? 'border-neon-gold shadow-glow-gold' : 'border-amber-600/50'
                    }`}
                    style={MARBLE}
                  >
                    <AnimatePresence>{isSel && <GoldChip />}</AnimatePresence>
                    <div className="font-display text-base font-black tracking-[0.14em] text-slate-800 sm:text-lg">
                      {z.label}
                    </div>
                    <div className="text-[0.55rem] tracking-[0.3em] text-slate-500">{z.greek}</div>
                    <div className="mt-1 text-[0.58rem] font-bold tracking-widest text-amber-700">
                      {z.pays}
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* Side-bet reef — TrojanHorseBet mounts here */}
            {children && <div className="mt-3">{children}</div>}

            <div className="mt-3 rotate-180"><MeanderStrip /></div>
          </div>
        </div>
      </div>
    </section>
  );
}
