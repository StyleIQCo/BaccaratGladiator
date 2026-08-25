// ═══════════════════════════════════════════════════════════════════
//  BACCARAT SCOREBOARD — the five classic roads, live.
//  Layout mirrors a Macau table display:
//    ┌──────────────── Big Road ────────────────┐
//    ├──── Bead Plate ────┬──── Big Eye Boy ────┤
//    ├──── Small Road ────┴──── Cockroach ──────┤
//  All math comes from baccaratRoadmapEngine (pure, tested); this file
//  is rendering only: SVG grids, Framer Motion cell entries, and the
//  Dragon Alert aura when a streak hits the threshold.
//  (Next.js consumers: this is a client component — add 'use client'
//  in a wrapper or at the top of your copy.)
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  computeRoadmaps,
  DERIVED_OFFSETS,
  ROAD_ROWS,
  type BigRoadResult,
  type DerivedColor,
  type DerivedRoadResult,
  type DragonInfo,
  type HandResult,
  type RoadmapStats,
  type Winner,
} from './baccaratRoadmapEngine';

/* ── Theming ─────────────────────────────────────────────────────── */

export interface ScoreboardTheme {
  id: string;
  /** Panel chrome */
  panelBg: string;
  panelBorder: string;
  gridLine: string;
  label: string;
  /** Outcome colors (banker/player double as derived RED/BLUE) */
  banker: string;
  player: string;
  tie: string;
  /** Letter inside filled bead-plate discs */
  cellText: string;
  /** Dragon Alert aura + badge — 6-digit hex (alpha is appended) */
  dragonAura: string;
  /** Neon glow filters on strokes */
  glow: boolean;
}

/** Classic casino display: parchment panel, standard red/blue/green. */
export const CASINO_THEME: ScoreboardTheme = {
  id: 'casino',
  panelBg: '#fffdf6',
  panelBorder: '#d8cdb9',
  gridLine: 'rgba(60,50,30,0.14)',
  label: '#8a7f6a',
  banker: '#d32f2f',
  player: '#1e56c8',
  tie: '#1e8e4e',
  cellText: '#ffffff',
  dragonAura: '#e8a015',
  glow: false,
};

/** App-wide dark mode: abyss panels, glowing neon strokes. */
export const NEON_THEME: ScoreboardTheme = {
  id: 'neon',
  panelBg: 'rgba(18,11,46,0.85)',
  panelBorder: 'rgba(46,230,255,0.16)',
  gridLine: 'rgba(46,230,255,0.09)',
  label: 'rgba(255,255,255,0.55)',
  banker: '#ff3b5c',
  player: '#2ee6ff',
  tie: '#3dff8f',
  cellText: '#0a0618',
  dragonAura: '#ffd24a',
  glow: true,
};

const THEMES: Record<string, ScoreboardTheme> = { casino: CASINO_THEME, neon: NEON_THEME };

/* ── Shared bits ─────────────────────────────────────────────────── */

const BEAD = 32;   // bead plate cell px
const BIG = 26;    // big road cell px
const SMALL = 14;  // derived road cell px

const popIn = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { type: 'spring', stiffness: 520, damping: 26 },
} as const;

/** SVG transforms need an explicit local origin for the scale-up entry. */
const svgOrigin = { transformBox: 'fill-box', transformOrigin: 'center' } as const;

const neonGlow = (theme: ScoreboardTheme, color: string) =>
  theme.glow ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined;

function winnerColor(theme: ScoreboardTheme, winner: Winner): string {
  return winner === 'BANKER' ? theme.banker : winner === 'PLAYER' ? theme.player : theme.tie;
}
function derivedColor(theme: ScoreboardTheme, color: DerivedColor): string {
  return color === 'RED' ? theme.banker : theme.player;
}

/** Keep the newest column in view as hands land. */
function useAutoScrollRight(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth, behavior: 'smooth' });
  }, [dep]);
  return ref;
}

function GridLines({ cols, rows, size, stroke }: { cols: number; rows: number; size: number; stroke: string }) {
  const id = useId();
  return (
    <>
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" stroke={stroke} strokeWidth={1} shapeRendering="crispEdges" />
        </pattern>
      </defs>
      <rect width={cols * size} height={rows * size} fill={`url(#${id})`} />
      <rect width={cols * size} height={rows * size} fill="none" stroke={stroke} strokeWidth={1} shapeRendering="crispEdges" />
    </>
  );
}

function RoadPanel({ theme, title, badge, scrollDep, children }: {
  theme: ScoreboardTheme;
  title: string;
  badge?: ReactNode;
  scrollDep: number;
  children: ReactNode;
}) {
  const scrollRef = useAutoScrollRight(scrollDep);
  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border"
      style={{ background: theme.panelBg, borderColor: theme.panelBorder }}
    >
      <div
        className="flex h-6 items-center justify-between px-2 text-[0.58rem] font-bold uppercase tracking-[0.2em]"
        style={{ color: theme.label }}
      >
        <span className="truncate">{title}</span>
        {badge}
      </div>
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden px-1.5 pb-1.5">
        {children}
      </div>
    </div>
  );
}

/* ── Bead Plate ──────────────────────────────────────────────────── */

function BeadPlateRoad({ snapshot, theme, labels }: {
  snapshot: ReturnType<typeof computeRoadmaps>;
  theme: ScoreboardTheme;
  labels: Record<Winner, string>;
}) {
  const cells = snapshot.beadPlate;
  const cols = Math.max((cells[cells.length - 1]?.col ?? 0) + 2, 9);
  const r = BEAD * 0.38;
  return (
    <svg width={cols * BEAD} height={ROAD_ROWS * BEAD} className="block">
      <GridLines cols={cols} rows={ROAD_ROWS} size={BEAD} stroke={theme.gridLine} />
      {cells.map((cell) => {
        const cx = cell.col * BEAD + BEAD / 2;
        const cy = cell.row * BEAD + BEAD / 2;
        const fill = winnerColor(theme, cell.winner);
        return (
          <motion.g key={cell.handIndex} {...popIn} style={svgOrigin}>
            <circle cx={cx} cy={cy} r={r} fill={fill} style={neonGlow(theme, fill)} />
            {cell.natural && (
              <circle cx={cx} cy={cy} r={r + 2.5} fill="none" stroke={theme.dragonAura} strokeWidth={1.5} strokeDasharray="3 2.5" />
            )}
            <text
              x={cx} y={cy + 0.5}
              textAnchor="middle" dominantBaseline="central"
              fontSize={BEAD * 0.42} fontWeight={800} fill={theme.cellText}
              style={{ userSelect: 'none' }}
            >
              {labels[cell.winner]}
            </text>
            {cell.bankerPair && <circle cx={cx - r * 0.8} cy={cy - r * 0.8} r={3.2} fill={theme.banker} stroke={theme.cellText} strokeWidth={0.8} />}
            {cell.playerPair && <circle cx={cx + r * 0.8} cy={cy + r * 0.8} r={3.2} fill={theme.player} stroke={theme.cellText} strokeWidth={0.8} />}
          </motion.g>
        );
      })}
    </svg>
  );
}

/* ── Big Road (+ Dragon Alert aura) ──────────────────────────────── */

function DragonAura({ dragon, road, theme }: { dragon: DragonInfo; road: BigRoadResult; theme: ScoreboardTheme }) {
  const cells = dragon.cellIndexes.map((i) => road.cells[i]);
  const minCol = Math.min(...cells.map((c) => c.col));
  const maxCol = Math.max(...cells.map((c) => c.col));
  const minRow = Math.min(...cells.map((c) => c.row));
  const maxRow = Math.max(...cells.map((c) => c.row));
  return (
    <motion.rect
      x={minCol * BIG + 1.5}
      y={minRow * BIG + 1.5}
      width={(maxCol - minCol + 1) * BIG - 3}
      height={(maxRow - minRow + 1) * BIG - 3}
      rx={7}
      fill={`${theme.dragonAura}14`}
      stroke={theme.dragonAura}
      strokeWidth={1.6}
      initial={{ opacity: 0 }}
      animate={dragon.live ? { opacity: [0.35, 0.95, 0.35] } : { opacity: 0.28 }}
      transition={dragon.live ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
      style={{ filter: `drop-shadow(0 0 6px ${theme.dragonAura})` }}
    />
  );
}

function BigRoadView({ road, dragons, theme }: { road: BigRoadResult; dragons: DragonInfo[]; theme: ScoreboardTheme }) {
  const cols = Math.max(road.colCount + 2, 22);
  const r = BIG * 0.33;
  const slash = BIG * 0.3;
  return (
    <svg width={cols * BIG} height={ROAD_ROWS * BIG} className="block">
      <GridLines cols={cols} rows={ROAD_ROWS} size={BIG} stroke={theme.gridLine} />
      {dragons.map((d) => (
        <DragonAura key={d.logicalCol} dragon={d} road={road} theme={theme} />
      ))}
      {road.cells.length === 0 && road.unattachedTieCount > 0 && (
        <motion.g {...popIn} style={svgOrigin}>
          <circle cx={BIG / 2} cy={BIG / 2} r={r} fill="none" stroke={theme.tie} strokeWidth={2.2} style={neonGlow(theme, theme.tie)} />
          <text x={BIG / 2} y={BIG / 2 + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={BIG * 0.38} fontWeight={800} fill={theme.tie}>
            {road.unattachedTieCount}
          </text>
        </motion.g>
      )}
      {road.cells.map((cell) => {
        const cx = cell.col * BIG + BIG / 2;
        const cy = cell.row * BIG + BIG / 2;
        const stroke = winnerColor(theme, cell.winner);
        return (
          <motion.g key={cell.handIndex} {...popIn} style={svgOrigin}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={2.4} style={neonGlow(theme, stroke)} />
            {cell.tieCount > 0 && (
              <line
                x1={cx - slash} y1={cy + slash} x2={cx + slash} y2={cy - slash}
                stroke={theme.tie} strokeWidth={2.2} strokeLinecap="round"
                style={neonGlow(theme, theme.tie)}
              />
            )}
            {cell.tieCount > 1 && (
              <text x={cx + r * 0.9} y={cy + r * 1.05} textAnchor="middle" fontSize={BIG * 0.32} fontWeight={800} fill={theme.tie}>
                {cell.tieCount}
              </text>
            )}
          </motion.g>
        );
      })}
    </svg>
  );
}

function DragonBadge({ dragon, theme, labels }: {
  dragon: DragonInfo | undefined;
  theme: ScoreboardTheme;
  labels: Record<Winner, string>;
}) {
  return (
    <AnimatePresence>
      {dragon && (
        <motion.span
          key={`${dragon.logicalCol}-${dragon.winner}`}
          initial={{ scale: 0, y: 6, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
          className="flex shrink-0 items-center gap-1 rounded-full border px-2 py-px font-bold normal-case tracking-normal"
          style={{
            color: theme.dragonAura,
            borderColor: `${theme.dragonAura}66`,
            background: `${theme.dragonAura}1a`,
            textShadow: theme.glow ? `0 0 8px ${theme.dragonAura}` : undefined,
          }}
        >
          🐉 {labels[dragon.winner]} DRAGON ×{dragon.length}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* ── Derived roads ───────────────────────────────────────────────── */

function DerivedRoadView({ road, variant, theme }: {
  road: DerivedRoadResult;
  variant: 'hollow' | 'solid' | 'slash';
  theme: ScoreboardTheme;
}) {
  const cols = Math.max(road.colCount + 2, 21);
  const r = SMALL * 0.32;
  return (
    <svg width={cols * SMALL} height={ROAD_ROWS * SMALL} className="block">
      <GridLines cols={cols} rows={ROAD_ROWS} size={SMALL} stroke={theme.gridLine} />
      {road.cells.map((cell) => {
        const cx = cell.col * SMALL + SMALL / 2;
        const cy = cell.row * SMALL + SMALL / 2;
        const color = derivedColor(theme, cell.color);
        return (
          <motion.g key={cell.handIndex} {...popIn} style={svgOrigin}>
            {variant === 'hollow' && (
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.8} style={neonGlow(theme, color)} />
            )}
            {variant === 'solid' && (
              <circle cx={cx} cy={cy} r={r + 0.5} fill={color} style={neonGlow(theme, color)} />
            )}
            {variant === 'slash' && (
              <line
                x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r}
                stroke={color} strokeWidth={2} strokeLinecap="round"
                style={neonGlow(theme, color)}
              />
            )}
          </motion.g>
        );
      })}
    </svg>
  );
}

/* ── Stats footer ────────────────────────────────────────────────── */

function StatChip({ color, label, value, glow }: { color: string; label: string; value: number; glow: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.62rem] font-bold tabular-nums"
      style={{ color, borderColor: `${color}55`, textShadow: glow ? `0 0 6px ${color}88` : undefined }}
    >
      {label}
      <span>{value}</span>
    </span>
  );
}

function StatsBar({ stats, theme, labels }: { stats: RoadmapStats; theme: ScoreboardTheme; labels: Record<Winner, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5">
      <StatChip color={theme.banker} label={labels.BANKER} value={stats.banker} glow={theme.glow} />
      <StatChip color={theme.player} label={labels.PLAYER} value={stats.player} glow={theme.glow} />
      <StatChip color={theme.tie} label={labels.TIE} value={stats.tie} glow={theme.glow} />
      <StatChip color={theme.banker} label={`${labels.BANKER}♊`} value={stats.bankerPairs} glow={theme.glow} />
      <StatChip color={theme.player} label={`${labels.PLAYER}♊`} value={stats.playerPairs} glow={theme.glow} />
      <span className="ml-auto text-[0.62rem] font-semibold tabular-nums" style={{ color: theme.label }}>
        {stats.hands} hands
      </span>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

export interface BaccaratScoreboardProps {
  /** Raw outcomes, oldest first. Append immutably — pass a new array. */
  history: HandResult[];
  /** 'casino' | 'neon' or a full custom ScoreboardTheme. Default 'neon'. */
  theme?: 'casino' | 'neon' | ScoreboardTheme;
  /** Cell letters, e.g. { BANKER: '庄', PLAYER: '闲', TIE: '和' }. */
  labels?: Partial<Record<Winner, string>>;
  /** Streak length that triggers the Dragon Alert. Default 5. */
  dragonThreshold?: number;
  showStats?: boolean;
  className?: string;
}

export function BaccaratScoreboard({
  history,
  theme = 'neon',
  labels,
  dragonThreshold = 5,
  showStats = true,
  className = '',
}: BaccaratScoreboardProps) {
  const resolvedTheme = typeof theme === 'string' ? THEMES[theme] ?? NEON_THEME : theme;
  const resolvedLabels: Record<Winner, string> = { BANKER: 'B', PLAYER: 'P', TIE: 'T', ...labels };

  const snapshot = useMemo(
    () => computeRoadmaps(history, { dragonThreshold }),
    [history, dragonThreshold],
  );
  const liveDragon = snapshot.dragons.find((d) => d.live);
  const handCount = history.length;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <RoadPanel
            theme={resolvedTheme}
            title="Big Road 大路"
            badge={<DragonBadge dragon={liveDragon} theme={resolvedTheme} labels={resolvedLabels} />}
            scrollDep={handCount}
          >
            <BigRoadView road={snapshot.bigRoad} dragons={snapshot.dragons} theme={resolvedTheme} />
          </RoadPanel>
        </div>

        <RoadPanel theme={resolvedTheme} title="Bead Plate 珠仔路" scrollDep={handCount}>
          <BeadPlateRoad snapshot={snapshot} theme={resolvedTheme} labels={resolvedLabels} />
        </RoadPanel>

        <div className="flex min-w-0 flex-col gap-1.5">
          <RoadPanel theme={resolvedTheme} title="Big Eye Boy 大眼仔" scrollDep={handCount}>
            <DerivedRoadView road={snapshot.bigEyeBoy} variant="hollow" theme={resolvedTheme} />
          </RoadPanel>
          <RoadPanel theme={resolvedTheme} title="Small Road 小路" scrollDep={handCount}>
            <DerivedRoadView road={snapshot.smallRoad} variant="solid" theme={resolvedTheme} />
          </RoadPanel>
          <RoadPanel theme={resolvedTheme} title="Cockroach 曱甴路" scrollDep={handCount}>
            <DerivedRoadView road={snapshot.cockroachRoad} variant="slash" theme={resolvedTheme} />
          </RoadPanel>
        </div>
      </div>

      {showStats && <StatsBar stats={snapshot.stats} theme={resolvedTheme} labels={resolvedLabels} />}
    </div>
  );
}

export default BaccaratScoreboard;
// Re-export the engine surface so consumers can `import { computeRoadmaps,
// askTheRoad, type HandResult } from './roadmap/BaccaratScoreboard'`.
export { computeRoadmaps, askTheRoad, DERIVED_OFFSETS, ROAD_ROWS } from './baccaratRoadmapEngine';
export type { HandResult, Winner, RoadmapSnapshot, DerivedColor } from './baccaratRoadmapEngine';
