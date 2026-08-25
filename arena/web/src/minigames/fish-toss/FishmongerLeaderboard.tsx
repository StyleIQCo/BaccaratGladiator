// ═══════════════════════════════════════════════════════════════════
//  FishmongerLeaderboard — Weekly "Top Fishmonger" standings for the
//  Pike Place Fish Toss cabinet. Juicy Pacific-Northwest dock look:
//  crushed-ice backdrop, neon-orange accents, gold-glow champion row.
//
//  Character canon (must match the future FishTossCanvas sprite — see
//  README.md): the monger wears safety-orange waterproof bib overalls
//  over a red-plaid flannel shirt, plus a knit beanie and yellow
//  rubber gloves. The header mascot below IS that spec.
//
//  Data flows through useFishmonger (ws /arena/ws): snapshot on mount,
//  the "you" row pins under the top 10 with the exact points needed to
//  crack the prize bracket.
// ═══════════════════════════════════════════════════════════════════
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { FishTossEntry, FishTossSnapshotPayload } from '@bg/shared';
import { useFishmonger } from './useFishmonger';

// ── prize + rank dressing ──────────────────────────────────────────

const compactChips = (n: number) => (n >= 1000 ? `${n / 1000}K` : String(n));

const RANK_THEME: Record<number, { row: string; badge: string }> = {
  1: {
    row: 'border-2 border-amber-300/90 bg-gradient-to-r from-amber-400/25 via-yellow-200/10 to-transparent',
    badge: 'bg-gradient-to-b from-yellow-200 to-amber-500 text-amber-950',
  },
  2: {
    row: 'border border-slate-300/60 bg-gradient-to-r from-slate-300/20 to-transparent',
    badge: 'bg-gradient-to-b from-slate-100 to-slate-400 text-slate-900',
  },
  3: {
    row: 'border border-orange-400/60 bg-gradient-to-r from-orange-500/20 to-transparent',
    badge: 'bg-gradient-to-b from-orange-300 to-orange-700 text-orange-950',
  },
};
const DEFAULT_ROW = 'border border-cyan-100/10 bg-slate-800/40';
const DEFAULT_BADGE = 'bg-slate-700 text-cyan-100/80';

const listVariants: Variants = { show: { transition: { staggerChildren: 0.07 } } };
const rowVariants: Variants = {
  hidden: { opacity: 0, x: -28, scale: 0.96 },
  show: { opacity: 1, x: 0, scale: 1, transition: { type: 'spring', stiffness: 320, damping: 24 } },
};

// ── the monger mascot: orange bib overalls, flannel, beanie ────────

function FishmongerMascot({ still }: { still: boolean }) {
  return (
    <svg viewBox="0 0 140 110" className="h-20 w-[6.5rem]" aria-hidden>
      <defs>
        {/* red-plaid flannel */}
        <pattern id="ft-flannel" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill="#b3402f" />
          <rect y="3" width="10" height="3.5" fill="#8f2f22" opacity="0.85" />
          <rect x="3" width="3.5" height="10" fill="#7c261b" opacity="0.6" />
        </pattern>
      </defs>

      {/* dock planks */}
      <rect x="0" y="100" width="140" height="7" rx="2" fill="#4a3a2a" />
      <rect x="6" y="102.5" width="30" height="2" rx="1" fill="#5d4a35" />
      <rect x="52" y="102.5" width="34" height="2" rx="1" fill="#5d4a35" />
      <rect x="100" y="102.5" width="28" height="2" rx="1" fill="#5d4a35" />

      {/* the salmon, mid-flight, with icy whooshes */}
      <path d="M8 15 q11 -5 22 -2" stroke="#9bd7de" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M6 24 q9 -4 17 -2" stroke="#9bd7de" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.45" />
      <motion.g
        animate={still ? undefined : { y: [0, -4, 0], rotate: [-3, 4, -3] }}
        transition={still ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ellipse cx="36" cy="27" rx="16" ry="6.5" fill="#fa8072" />
        <path d="M21 27 l-10 -5.5 v11 z" fill="#e9695b" />
        <path d="M31 21.5 q5 -3.5 10 0" stroke="#e9695b" strokeWidth="1.5" fill="none" />
        <circle cx="46.5" cy="25.5" r="1.5" fill="#3d2b26" />
      </motion.g>

      {/* raised flannel arms, yellow rubber gloves ready for the catch */}
      <path d="M84 56 Q75 46 69 38" stroke="url(#ft-flannel)" strokeWidth="7.5" fill="none" strokeLinecap="round" />
      <path d="M106 56 Q114 46 119 40" stroke="url(#ft-flannel)" strokeWidth="7.5" fill="none" strokeLinecap="round" />
      <circle cx="68" cy="36.5" r="4.2" fill="#ffd23f" />
      <circle cx="120" cy="38.5" r="4.2" fill="#ffd23f" />

      {/* head + knit beanie */}
      <circle cx="95" cy="34" r="11" fill="#f2c9a0" />
      <path d="M84 33 a11 11 0 0 1 22 0 z" fill="#2f6d75" />
      <rect x="83" y="30.5" width="24" height="5" rx="2.5" fill="#3d8891" />
      <path d="M91 25 v5 M99 25 v5" stroke="#3d8891" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="91" cy="38.5" r="1.4" fill="#33272a" />
      <circle cx="99" cy="38.5" r="1.4" fill="#33272a" />
      <path d="M91 43.5 q4 3 8 0" stroke="#33272a" strokeWidth="1.4" fill="none" strokeLinecap="round" />

      {/* flannel torso, then the waterproof orange bib overalls on top */}
      <rect x="80" y="47" width="30" height="23" rx="7" fill="url(#ft-flannel)" />
      <path d="M87 56 L84 48" stroke="#f97316" strokeWidth="4" strokeLinecap="round" />
      <path d="M103 56 L106 48" stroke="#f97316" strokeWidth="4" strokeLinecap="round" />
      <rect x="84" y="55" width="22" height="16" rx="2.5" fill="#f97316" />
      <circle cx="87.5" cy="57.5" r="1.7" fill="#fbbf24" />
      <circle cx="102.5" cy="57.5" r="1.7" fill="#fbbf24" />
      <rect x="90" y="61" width="10" height="6" rx="1.5" fill="#ea580c" /> {/* chest pocket */}

      {/* wader legs with hi-vis yellow cuffs, dark boots */}
      <rect x="82" y="69" width="26" height="9" rx="2" fill="#f97316" />
      <rect x="84" y="76" width="9.5" height="18" rx="3" fill="#f97316" />
      <rect x="96.5" y="76" width="9.5" height="18" rx="3" fill="#f97316" />
      <rect x="84" y="89" width="9.5" height="3.2" fill="#fbbf24" />
      <rect x="96.5" y="89" width="9.5" height="3.2" fill="#fbbf24" />
      <rect x="82.5" y="93.5" width="12" height="7" rx="2.5" fill="#33272a" />
      <rect x="95.5" y="93.5" width="12" height="7" rx="2.5" fill="#33272a" />
    </svg>
  );
}

function Crown() {
  return (
    <svg viewBox="0 0 24 16" className="h-5 w-7 drop-shadow-[0_0_6px_rgba(251,191,36,0.9)]" aria-hidden>
      <path d="M2 14h20l-1.5-9-5 4L12 2 8.5 9l-5-4L2 14Z" className="fill-yellow-300" stroke="#d97706" strokeWidth="1" />
    </svg>
  );
}

function Avatar({ entry, size = 'h-10 w-10 text-base' }: { entry: FishTossEntry; size?: string }) {
  return (
    <div className={`${size} flex items-center justify-center rounded-full bg-cyan-900 font-bold text-cyan-200 ring-2 ring-cyan-100/20`}>
      {(entry.handle || '?').charAt(0).toUpperCase()}
    </div>
  );
}

function useCountdown(endsAt: number | undefined) {
  const [label, setLabel] = useState('…');
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const ms = Math.max(0, endsAt - Date.now());
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLabel(`${d}d ${h}h ${String(m).padStart(2, '0')}m`);
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [endsAt]);
  return label;
}

// ── the board ──────────────────────────────────────────────────────

export interface FishmongerLeaderboardProps {
  meId: string;
  handle: string;
  avatarKey?: string;
  /** ws endpoint origin; defaults to same-origin */
  url?: string;
  /** Demo Hub mode: render this snapshot and never open a socket. */
  demoSnapshot?: FishTossSnapshotPayload;
}

export function FishmongerLeaderboard({ meId, handle, avatarKey, url, demoSnapshot }: FishmongerLeaderboardProps) {
  const live = useFishmonger({ meId, handle, avatarKey, url, disabled: !!demoSnapshot });
  const snap = demoSnapshot ?? live.snap;
  const connected = demoSnapshot ? true : live.connected;
  const refresh = live.refresh;
  const reducedMotion = useReducedMotion() ?? false;
  const countdown = useCountdown(snap?.endsAt);

  const prizeFor = (rank: number) => snap?.prizes[rank - 1] ?? 0;
  const bubble = snap && snap.top.length >= 10 ? snap.top[9].score : 0;
  const meOutside = snap?.me && snap.me.rank > snap.top.length ? snap.me : null;
  // Ties keep the incumbent, so breaking in means strictly beating #10.
  const pointsToBracket = meOutside ? Math.max(1, bubble - meOutside.score + 1) : 0;

  return (
    <div className="relative mx-auto max-w-md overflow-hidden rounded-3xl border border-cyan-100/20 bg-slate-950 p-5 text-cyan-50 shadow-2xl">
      {/* crushed-ice backdrop: layered cold glows over deep slate */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(165,243,252,0.14),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(125,211,252,0.10),transparent_50%),radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.08),transparent_35%)]" />
      <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full bg-cyan-200/10 blur-3xl" />

      <div className="relative">
        {/* header: mascot + neon title + countdown */}
        <div className="mb-1 flex items-end gap-2">
          <FishmongerMascot still={reducedMotion} />
          <div className="pb-1">
            <h2 className="text-xl font-black uppercase tracking-widest text-orange-400 [text-shadow:0_0_14px_rgba(251,146,60,0.85)]">
              Top Fishmonger
            </h2>
            <p className="text-[11px] text-cyan-200/70">Pike Place Fish Toss · {snap?.weekKey ?? '…'}</p>
          </div>
        </div>
        <div className="mb-4 flex items-center justify-between text-xs">
          <span className="text-cyan-200/60">
            {snap ? `${snap.totalPlayers.toLocaleString()} mongers this week` : 'hauling in the board…'}
          </span>
          <span className="rounded-full border border-orange-400/40 bg-orange-500/10 px-2 py-0.5 font-semibold text-orange-300">
            Payout in {countdown}
          </span>
        </div>

        {!snap ? (
          <ul className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="h-14 animate-pulse rounded-2xl bg-slate-800/50" />
            ))}
          </ul>
        ) : (
          <>
            <motion.ul variants={listVariants} initial="hidden" animate="show" className="space-y-2">
              {snap.top.map(entry => {
                const theme = RANK_THEME[entry.rank];
                const isChamp = entry.rank === 1;
                const isMe = entry.userId === meId;
                return (
                  <motion.li key={entry.userId} variants={rowVariants}>
                    <motion.div
                      animate={isChamp && !reducedMotion ? {
                        boxShadow: [
                          '0 0 10px rgba(251,191,36,0.35)',
                          '0 0 26px rgba(251,191,36,0.7)',
                          '0 0 10px rgba(251,191,36,0.35)',
                        ],
                      } : undefined}
                      transition={isChamp && !reducedMotion ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
                      whileHover={reducedMotion ? undefined : { scale: 1.02 }}
                      className={`flex items-center gap-3 rounded-2xl p-2.5 backdrop-blur-sm ${theme?.row ?? DEFAULT_ROW} ${isMe ? 'ring-1 ring-orange-400/60' : ''}`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black shadow ${theme?.badge ?? DEFAULT_BADGE}`}>
                        {entry.rank}
                      </span>
                      <div className="relative shrink-0">
                        {isChamp && (
                          <motion.div
                            className="absolute -top-4 left-1/2 -translate-x-1/2"
                            animate={reducedMotion ? undefined : { rotate: [-8, 8, -8] }}
                            transition={reducedMotion ? undefined : { duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                          >
                            <Crown />
                          </motion.div>
                        )}
                        <Avatar entry={entry} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {entry.handle}{isMe && <span className="ml-1 text-[10px] font-black text-orange-400">YOU</span>}
                        </p>
                        {isChamp ? (
                          <span className="inline-block rounded-full bg-gradient-to-r from-yellow-300 to-amber-500 px-2 py-px text-[10px] font-black uppercase tracking-wider text-amber-950">
                            Master Fishmonger
                          </span>
                        ) : (
                          <p className="text-[11px] text-cyan-200/60">Rank #{entry.rank}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black tabular-nums">{entry.score.toLocaleString()} pts</p>
                        <p className="text-[11px] font-bold text-orange-400 [text-shadow:0_0_8px_rgba(251,146,60,0.7)]">
                          +{compactChips(prizeFor(entry.rank))} chips
                        </p>
                      </div>
                    </motion.div>
                  </motion.li>
                );
              })}
              {snap.top.length === 0 && (
                <li className="py-10 text-center text-sm text-cyan-200/60">
                  The stall is empty — toss the first fish of the week!
                </li>
              )}
            </motion.ul>

            {/* pinned "you are here" row when outside the top 10 */}
            {meOutside && (
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8, type: 'spring', stiffness: 260, damping: 22 }}
                className="mt-3 flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-orange-400/70 bg-orange-500/10 p-3"
              >
                <Avatar entry={meOutside} size="h-9 w-9 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-orange-300">You — Rank #{meOutside.rank}</p>
                  <p className="text-[11px] text-cyan-200/70">{meOutside.score.toLocaleString()} pts this week</p>
                </div>
                <p className="text-right text-xs font-bold text-orange-400 [text-shadow:0_0_8px_rgba(251,146,60,0.7)]">
                  {pointsToBracket.toLocaleString()} pts
                  <span className="block text-[10px] font-semibold text-cyan-200/70">to crack the prize bracket</span>
                </p>
              </motion.div>
            )}
          </>
        )}

        {!connected && snap && (
          <button onClick={refresh} className="mt-3 w-full rounded-xl border border-cyan-100/20 py-2 text-xs font-bold text-cyan-200/70">
            Reconnecting… tap to retry
          </button>
        )}
      </div>
    </div>
  );
}
