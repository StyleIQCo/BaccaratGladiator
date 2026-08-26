'use client';

/**
 * SeattleArcadeHub — the Emerald City Arcade menu: a moody, neon-lit
 * Seattle waterfront where players pick their daily chip-faucet game.
 *
 * Scene layers (back → front):
 *   1. Deep rainy-blue night gradient + skyline silhouette (inline SVG,
 *      Space Needle prominent) with a glowing monorail track and a light
 *      streak gliding along it.
 *   2. Two drifting CSS rain sheets (pure repeating-gradient layers — no
 *      JS, no canvas, nothing competing with a game for frame budget).
 *   3. Neon signage: flickering EMERALD CITY ARCADE marquee + a Pike
 *      Place-style clock badge.
 *   4. UI: Daily Arcade Tickets tracker, swipeable snap-scroll carousel
 *      of game cards, and a framer-motion shared-element expansion when
 *      a card is selected (with the mandatory coin-insert SFX).
 *
 * Styling is deliberately inline-style + a scoped <style> block — NOT
 * Tailwind — so any host page can mount the hub without inheriting the
 * odyssey module's content-glob requirement.
 *
 * All game metadata comes from emeraldArcadeData.ts; this component has
 * no per-game knowledge beyond `onLaunchGame(id)`.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ARCADE_DAILY_TICKETS,
  CATEGORY_ACCENTS,
  EMERALD_ARCADE_GAMES,
  type ArcadeGameConfig,
} from '../data/emeraldArcadeData';
import { playArcadeSfx } from '../hooks/useArcadeEngine';

export interface SeattleArcadeHubProps {
  onLaunchGame: (gameId: string) => void;
  /** Remaining daily tickets; the host owns refill/persistence. */
  tickets?: number;
  maxTickets?: number;
  games?: ArcadeGameConfig[];
  onExit?: () => void;
}

const INK = '#0a1220';
const RAIN_BLUE = '#16233d';
const NEON_GREEN = '#3dffb4';
const NEON_RED = '#ff4d5e';
const TEXT_DIM = 'rgba(178, 199, 230, 0.75)';

const fontStack =
  "'Avenir Next', 'Futura', 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    overflow: 'hidden',
    background: `linear-gradient(180deg, #060b16 0%, ${INK} 38%, ${RAIN_BLUE} 78%, #1b2c4a 100%)`,
    color: '#e8f1ff',
    fontFamily: fontStack,
    display: 'flex',
    flexDirection: 'column',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  skyline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '46%',
    pointerEvents: 'none',
  },
  header: {
    position: 'relative',
    zIndex: 3,
    padding: 'calc(14px + env(safe-area-inset-top)) 16px 6px',
    textAlign: 'center',
  },
  marquee: {
    margin: 0,
    fontSize: 'clamp(21px, 6vw, 34px)',
    fontWeight: 800,
    letterSpacing: '0.14em',
    color: NEON_GREEN,
    animation: 'eaFlicker 4.2s infinite',
  },
  marqueeSub: {
    margin: '2px 0 0',
    fontSize: 11,
    letterSpacing: '0.42em',
    color: TEXT_DIM,
    textTransform: 'uppercase',
  },
  ticketRow: {
    position: 'relative',
    zIndex: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '10px 16px 4px',
  },
  ticketLabel: {
    fontSize: 11,
    letterSpacing: '0.18em',
    color: TEXT_DIM,
    textTransform: 'uppercase',
  },
  ticketCount: {
    fontSize: 14,
    fontWeight: 800,
    color: '#ffd75e',
    letterSpacing: '0.08em',
  },
  carousel: {
    position: 'relative',
    zIndex: 3,
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    overflowX: 'auto',
    overflowY: 'hidden',
    padding: '12px 24px calc(28px + env(safe-area-inset-bottom))',
    scrollSnapType: 'x mandatory',
    WebkitOverflowScrolling: 'touch',
  },
  card: {
    position: 'relative',
    flex: '0 0 auto',
    width: 'min(262px, 74vw)',
    borderRadius: 18,
    padding: 14,
    scrollSnapAlign: 'center',
    background: 'linear-gradient(168deg, rgba(23, 37, 64, 0.94), rgba(10, 18, 32, 0.96))',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  cardThumb: {
    position: 'relative',
    height: 118,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 52,
    overflow: 'hidden',
  },
  categoryChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    padding: '3px 9px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    background: 'rgba(6, 10, 18, 0.72)',
  },
  cardTitle: {
    margin: '12px 0 4px',
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: '0.03em',
  },
  cardDesc: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: TEXT_DIM,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardReward: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: '#ffd75e',
  },
  overlayBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 20,
    background: 'rgba(4, 8, 15, 0.78)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  overlayCard: {
    position: 'relative',
    width: 'min(420px, 94vw)',
    maxHeight: '86vh',
    overflowY: 'auto',
    borderRadius: 22,
    padding: 20,
    background: 'linear-gradient(168deg, rgba(26, 42, 72, 0.98), rgba(10, 18, 32, 0.99))',
  },
  playBtn: {
    width: '100%',
    marginTop: 16,
    padding: '14px 18px',
    borderRadius: 14,
    border: 'none',
    fontFamily: fontStack,
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: '0.14em',
    cursor: 'pointer',
    textTransform: 'uppercase',
  },
  closeBtn: {
    position: 'absolute',
    // Above the position:relative thumb that follows it in DOM order —
    // without this the thumb swallows every tap on the button.
    zIndex: 2,
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: '1px solid rgba(178, 199, 230, 0.35)',
    background: 'rgba(6, 10, 18, 0.6)',
    color: '#e8f1ff',
    fontSize: 16,
    cursor: 'pointer',
  },
};

const KEYFRAMES = `
@keyframes eaFlicker {
  0%, 6%, 8%, 100% {
    text-shadow: 0 0 6px rgba(61, 255, 180, 0.9), 0 0 24px rgba(61, 255, 180, 0.5),
      0 0 64px rgba(61, 255, 180, 0.35);
    opacity: 1;
  }
  7% { text-shadow: none; opacity: 0.62; }
  52% {
    text-shadow: 0 0 6px rgba(61, 255, 180, 0.9), 0 0 24px rgba(61, 255, 180, 0.5),
      0 0 64px rgba(61, 255, 180, 0.35);
  }
  53% { text-shadow: 0 0 3px rgba(61, 255, 180, 0.55); opacity: 0.85; }
  54% {
    text-shadow: 0 0 6px rgba(61, 255, 180, 0.9), 0 0 24px rgba(61, 255, 180, 0.5),
      0 0 64px rgba(61, 255, 180, 0.35);
  }
}
@keyframes eaRainA {
  from { transform: translate3d(0, -33.33%, 0); }
  to { transform: translate3d(-8%, 0, 0); }
}
@keyframes eaRainB {
  from { transform: translate3d(0, -33.33%, 0); }
  to { transform: translate3d(-14%, 0, 0); }
}
@keyframes eaMonorail {
  0% { transform: translateX(-18%); opacity: 0; }
  8% { opacity: 1; }
  92% { opacity: 1; }
  100% { transform: translateX(118%); opacity: 0; }
}
@keyframes eaClockPulse {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(255, 77, 94, 0.85)); }
  50% { filter: drop-shadow(0 0 12px rgba(255, 77, 94, 0.55)); }
}
.ea-carousel::-webkit-scrollbar { display: none; }
`;

const rainLayer = (dense: boolean): CSSProperties => ({
  position: 'absolute',
  left: '-20%',
  top: 0,
  width: '140%',
  height: '300%',
  zIndex: 2,
  pointerEvents: 'none',
  backgroundImage: dense
    ? 'repeating-linear-gradient(101deg, transparent 0px, transparent 9px, rgba(168, 198, 255, 0.055) 9px, rgba(168, 198, 255, 0.055) 10px)'
    : 'repeating-linear-gradient(99deg, transparent 0px, transparent 17px, rgba(168, 198, 255, 0.09) 17px, rgba(168, 198, 255, 0.09) 18.5px)',
  animation: `${dense ? 'eaRainA 1.05s' : 'eaRainB 0.68s'} linear infinite`,
});

/** Seattle waterfront silhouette — Space Needle + towers + monorail track. */
function SkylineSilhouette() {
  return (
    <svg
      style={styles.skyline}
      viewBox="0 0 400 180"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      {/* towers */}
      <path
        d="M0 180 L0 120 L26 120 L26 96 L44 96 L44 132 L70 132 L70 88 L92 88 L92 180
           M118 180 L118 104 L142 104 L142 72 L158 72 L158 180
           M240 180 L240 92 L262 92 L262 118 L286 118 L286 76 L306 76 L306 180
           M330 180 L330 108 L352 108 L352 84 L376 84 L376 128 L400 128 L400 180 Z"
        fill="#0b1526"
      />
      {/* Space Needle */}
      <g fill="#0e1930">
        <rect x="196" y="58" width="8" height="96" />
        <path d="M178 58 Q200 40 222 58 L214 66 Q200 58 186 66 Z" />
        <ellipse cx="200" cy="60" rx="26" ry="7" />
        <rect x="198" y="24" width="4" height="22" />
      </g>
      <circle cx="200" cy="24" r="2.6" fill={NEON_RED}>
        <animate attributeName="opacity" values="1;0.25;1" dur="2.2s" repeatCount="indefinite" />
      </circle>
      {/* lit windows */}
      <g fill="rgba(255, 214, 140, 0.5)">
        <rect x="10" y="128" width="4" height="5" />
        <rect x="30" y="104" width="4" height="5" />
        <rect x="76" y="98" width="4" height="5" />
        <rect x="126" y="116" width="4" height="5" />
        <rect x="146" y="84" width="4" height="5" />
        <rect x="248" y="102" width="4" height="5" />
        <rect x="292" y="88" width="4" height="5" />
        <rect x="338" y="118" width="4" height="5" />
        <rect x="360" y="94" width="4" height="5" />
      </g>
      {/* monorail track + gliding light streak */}
      <rect x="0" y="150" width="400" height="3.5" fill="#132443" />
      <rect x="0" y="150" width="400" height="1" fill="rgba(55, 229, 255, 0.4)" />
      <g style={{ animation: 'eaMonorail 7.5s linear infinite' }}>
        <rect x="0" y="144" width="52" height="7" rx="3.5" fill="#37e5ff" opacity="0.9" />
        <rect x="-26" y="145.5" width="30" height="4" rx="2" fill="rgba(55, 229, 255, 0.35)" />
      </g>
      {/* waterline shimmer */}
      <rect x="0" y="168" width="400" height="12" fill="#091120" />
      <g fill="rgba(61, 255, 180, 0.14)">
        <rect x="150" y="170" width="100" height="1.5" />
        <rect x="180" y="174" width="46" height="1.2" />
      </g>
    </svg>
  );
}

/** Pike Place-style neon clock badge. */
function MarketClock() {
  return (
    <svg
      width="46"
      height="46"
      viewBox="0 0 46 46"
      aria-hidden="true"
      style={{ animation: 'eaClockPulse 3s ease-in-out infinite' }}
    >
      <circle cx="23" cy="23" r="19" fill="rgba(6,10,18,0.7)" stroke={NEON_RED} strokeWidth="2.5" />
      <circle cx="23" cy="23" r="14.5" fill="none" stroke="rgba(255,77,94,0.4)" strokeWidth="1" />
      <line x1="23" y1="23" x2="23" y2="12.5" stroke={NEON_RED} strokeWidth="2" strokeLinecap="round" />
      <line x1="23" y1="23" x2="30" y2="26" stroke={NEON_RED} strokeWidth="2" strokeLinecap="round" />
      <circle cx="23" cy="8.5" r="1.4" fill={NEON_RED} />
    </svg>
  );
}

function TicketStub({ filled }: { filled: boolean }) {
  return (
    <svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true">
      <path
        d="M2 3 h26 v5 a3 3 0 0 0 0 4 v5 h-26 v-5 a3 3 0 0 0 0-4 Z"
        fill={filled ? '#ffd75e' : 'rgba(178, 199, 230, 0.14)'}
        stroke={filled ? '#b8912a' : 'rgba(178, 199, 230, 0.3)'}
        strokeWidth="1.2"
      />
      <line
        x1="10"
        y1="4"
        x2="10"
        y2="16"
        stroke={filled ? '#b8912a' : 'rgba(178, 199, 230, 0.3)'}
        strokeWidth="1"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 26 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.32 + i * 0.07, duration: 0.45, ease: 'easeOut' as const },
  }),
};

export function SeattleArcadeHub({
  onLaunchGame,
  tickets = ARCADE_DAILY_TICKETS,
  maxTickets = ARCADE_DAILY_TICKETS,
  games = EMERALD_ARCADE_GAMES,
  onExit,
}: SeattleArcadeHubProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      for (const id of timersRef.current) window.clearTimeout(id);
    };
  }, []);

  const handleCardTap = useCallback(
    (game: ArcadeGameConfig) => {
      if (launching) return;
      playArcadeSfx(game.isUnlocked ? 'coin_insert' : 'clank', { volume: 0.9 });
      setExpandedId(game.id);
    },
    [launching],
  );

  const handleClose = useCallback(() => {
    if (launching) return;
    playArcadeSfx('click', { volume: 0.7 });
    setExpandedId(null);
  }, [launching]);

  const handlePlay = useCallback(
    (game: ArcadeGameConfig) => {
      if (launching || !game.isUnlocked || tickets <= 0) return;
      setLaunching(true);
      playArcadeSfx('whoosh', { volume: 0.9 });
      // Let the whoosh land before the host swaps views.
      timersRef.current.push(
        window.setTimeout(() => {
          setLaunching(false);
          setExpandedId(null);
          onLaunchGame(game.id);
        }, 480),
      );
    },
    [launching, onLaunchGame, tickets],
  );

  const expanded = expandedId ? games.find((g) => g.id === expandedId) ?? null : null;

  return (
    <div style={styles.root} data-testid="arcade-hub">
      <style>{KEYFRAMES}</style>

      <SkylineSilhouette />
      <div style={rainLayer(true)} />
      <div style={rainLayer(false)} />

      <motion.header
        style={styles.header}
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <MarketClock />
          <div>
            <h1 style={styles.marquee}>EMERALD CITY ARCADE</h1>
            <p style={styles.marqueeSub}>Seattle Daily Challenges</p>
          </div>
        </div>
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            aria-label="Back to the tables"
            style={{ ...styles.closeBtn, top: 'calc(10px + env(safe-area-inset-top))', left: 10, right: 'auto' }}
          >
            ←
          </button>
        )}
      </motion.header>

      <motion.div
        style={styles.ticketRow}
        data-testid="arcade-tickets"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <span style={styles.ticketLabel}>Daily Arcade Tickets</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: maxTickets }, (_, i) => (
            <TicketStub key={i} filled={i < tickets} />
          ))}
        </span>
        <span style={styles.ticketCount} data-testid="arcade-ticket-count">
          {tickets}/{maxTickets}
        </span>
      </motion.div>

      <div className="ea-carousel" style={styles.carousel}>
        {games.map((game, i) => {
          const accent = game.accent || CATEGORY_ACCENTS[game.category];
          return (
            <motion.div
              key={game.id}
              layoutId={`ea-card-${game.id}`}
              data-testid={`arcade-card-${game.id}`}
              data-locked={game.isUnlocked ? 'false' : 'true'}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="show"
              whileTap={{ scale: 0.96 }}
              onClick={() => handleCardTap(game)}
              style={{
                ...styles.card,
                border: `1px solid ${game.isUnlocked ? accent : 'rgba(178, 199, 230, 0.18)'}`,
                boxShadow: game.isUnlocked
                  ? `0 0 18px -6px ${accent}, inset 0 0 22px -14px ${accent}`
                  : 'none',
                opacity: game.isUnlocked ? 1 : 0.68,
              }}
            >
              <div
                style={{
                  ...styles.cardThumb,
                  background: `radial-gradient(circle at 50% 42%, ${accent}33 0%, rgba(8, 14, 26, 0.9) 72%)`,
                  filter: game.isUnlocked ? 'none' : 'grayscale(0.75)',
                }}
              >
                <span aria-hidden="true">{game.glyph}</span>
                <span style={{ ...styles.categoryChip, color: CATEGORY_ACCENTS[game.category] }}>
                  {game.category}
                </span>
                {!game.isUnlocked && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      right: 8,
                      padding: '3px 9px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.12em',
                      background: 'rgba(6, 10, 18, 0.8)',
                      color: TEXT_DIM,
                    }}
                  >
                    🔒 COMING SOON
                  </span>
                )}
              </div>
              <h2 style={styles.cardTitle}>{game.title}</h2>
              <p style={styles.cardDesc}>{game.description}</p>
              <div style={styles.cardReward}>
                ⛁ UP TO {game.dailyRewardLimit.toLocaleString()} CHIPS / DAY
              </div>
            </motion.div>
          );
        })}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            style={styles.overlayBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          >
            <motion.div
              layoutId={`ea-card-${expanded.id}`}
              data-testid="arcade-expanded"
              style={{
                ...styles.overlayCard,
                border: `1px solid ${expanded.accent || CATEGORY_ACCENTS[expanded.category]}`,
                boxShadow: `0 0 42px -8px ${expanded.accent || CATEGORY_ACCENTS[expanded.category]}`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                style={styles.closeBtn}
                onClick={handleClose}
                aria-label="Close"
                data-testid="arcade-expanded-close"
              >
                ✕
              </button>
              <div
                style={{
                  ...styles.cardThumb,
                  height: 150,
                  fontSize: 64,
                  background: `radial-gradient(circle at 50% 42%, ${
                    expanded.accent || CATEGORY_ACCENTS[expanded.category]
                  }40 0%, rgba(8, 14, 26, 0.92) 74%)`,
                }}
              >
                <span aria-hidden="true">{expanded.glyph}</span>
                <span style={{ ...styles.categoryChip, color: CATEGORY_ACCENTS[expanded.category] }}>
                  {expanded.category}
                </span>
              </div>
              <h2 style={{ ...styles.cardTitle, fontSize: 21, marginTop: 14 }}>{expanded.title}</h2>
              <p style={{ ...styles.cardDesc, display: 'block', WebkitLineClamp: 'unset', fontSize: 13.5 }}>
                {expanded.description}
              </p>
              <div style={{ ...styles.cardReward, marginTop: 12 }}>
                ⛁ DAILY REWARD LIMIT: {expanded.dailyRewardLimit.toLocaleString()} CHIPS
              </div>
              {(() => {
                const canPlay = expanded.isUnlocked && tickets > 0;
                const label = !expanded.isUnlocked
                  ? '🔒 Coming Soon'
                  : tickets <= 0
                    ? 'Out of Tickets — Back Tomorrow'
                    : launching
                      ? 'Inserting Coin…'
                      : `▶ Insert Coin — Play (1 Ticket)`;
                return (
                  <motion.button
                    type="button"
                    data-testid="arcade-play-btn"
                    whileTap={canPlay ? { scale: 0.96 } : undefined}
                    onClick={() => handlePlay(expanded)}
                    disabled={!canPlay || launching}
                    style={{
                      ...styles.playBtn,
                      background: canPlay
                        ? `linear-gradient(180deg, ${NEON_GREEN}, #1fbf82)`
                        : 'rgba(178, 199, 230, 0.14)',
                      color: canPlay ? '#04160e' : TEXT_DIM,
                      cursor: canPlay ? 'pointer' : 'default',
                    }}
                  >
                    {label}
                  </motion.button>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
