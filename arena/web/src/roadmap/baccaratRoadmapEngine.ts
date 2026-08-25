/**
 * baccaratRoadmapEngine.ts
 *
 * Pure derivation of the five classic baccarat roads from a raw outcome
 * history. No React / DOM imports — usable from workers, the Node backend,
 * and unit tests.
 *
 * Roads produced:
 *   1. Bead Plate (珠仔路)      — every hand, column-major, 6 rows
 *   2. Big Road (大路)          — streak columns with tie badges + dragon tail
 *   3. Big Eye Boy (大眼仔路)   — derived, offset 1
 *   4. Small Road (小路)        — derived, offset 2
 *   5. Cockroach Road (曱甴路)  — derived, offset 3
 */

export type Winner = 'BANKER' | 'PLAYER' | 'TIE';

export interface HandResult {
  winner: Winner;
  bankerPair?: boolean;
  playerPair?: boolean;
  natural?: boolean;
}

/** All roads render on the standard 6-row scoreboard grid. */
export const ROAD_ROWS = 6;

/* ═══════════════════════════ Bead Plate ═══════════════════════════ */

export interface BeadPlateCell {
  col: number;
  row: number;
  winner: Winner;
  bankerPair: boolean;
  playerPair: boolean;
  natural: boolean;
  /** Index into the source history array. Stable — use as a React key. */
  handIndex: number;
}

/** Column-major fill, top-to-bottom then rightward: hand i → (⌊i/rows⌋, i mod rows). */
export function computeBeadPlate(
  history: readonly HandResult[],
  rows: number = ROAD_ROWS,
): BeadPlateCell[] {
  return history.map((hand, handIndex) => ({
    col: Math.floor(handIndex / rows),
    row: handIndex % rows,
    winner: hand.winner,
    bankerPair: !!hand.bankerPair,
    playerPair: !!hand.playerPair,
    natural: !!hand.natural,
    handIndex,
  }));
}

/* ═══════════════════ Shared grid plotter (dragon tail) ═══════════════════ */

/**
 * Places symbols big-road-style on a 6-row grid with occupancy tracking:
 *  - a new streak starts at row 0 of the column right of the previous
 *    streak's HEAD column (skipping right past any cell a dragon tail
 *    already claimed);
 *  - a continuing streak moves straight down, and when the next row is
 *    off-grid or occupied it turns right along its current row (the
 *    "dragon tail"), again skipping past occupied cells.
 * Used by Big Road and by all three derived roads (they plot identically,
 * just with RED/BLUE symbols instead of B/P).
 */
function createRoadPlotter(rows: number) {
  const occupied = new Set<number>();
  const key = (col: number, row: number) => col * rows + row;
  let last: { col: number; row: number } | null = null;
  let columnStart = 0;

  return {
    place(startNewColumn: boolean): { col: number; row: number } {
      let col: number;
      let row: number;
      if (last === null) {
        col = 0;
        row = 0;
      } else if (startNewColumn) {
        col = columnStart + 1;
        row = 0;
        while (occupied.has(key(col, row))) col++;
      } else {
        col = last.col;
        row = last.row + 1;
        if (row >= rows || occupied.has(key(col, row))) {
          row = last.row;
          col = last.col + 1;
          while (occupied.has(key(col, row))) col++;
        }
      }
      if (row === 0) columnStart = col;
      occupied.add(key(col, row));
      last = { col, row };
      return { col, row };
    },
  };
}

/* ═══════════════════════════ Big Road ═══════════════════════════ */

export interface BigRoadCell {
  /** Grid position AFTER dragon-tail bending — what you draw. */
  col: number;
  row: number;
  winner: 'BANKER' | 'PLAYER';
  /** Ties that landed on this cell (ties never occupy their own cell). */
  tieCount: number;
  natural: boolean;
  handIndex: number;
  /** Streak number (0-based), ignoring dragon-tail bending. */
  logicalCol: number;
  /** Depth within the streak (0-based). logicalRow can exceed rows-1. */
  logicalRow: number;
}

export interface BigRoadColumn {
  winner: 'BANKER' | 'PLAYER';
  /** True streak length — NOT clipped to 6 by the dragon tail. */
  length: number;
  /** Grid column of the streak's first cell. */
  startCol: number;
  /** Indexes into BigRoadResult.cells, in order. */
  cellIndexes: number[];
}

export interface BigRoadResult {
  cells: BigRoadCell[];
  columns: BigRoadColumn[];
  /**
   * Ties dealt before any BANKER/PLAYER outcome exists. Only non-zero while
   * the road has no cells (once the first cell lands, these fold into its
   * tieCount). Render as a lone tie badge at (0,0).
   */
  unattachedTieCount: number;
  /** Grid columns in use — size your viewport with this. */
  colCount: number;
}

export function computeBigRoad(
  history: readonly HandResult[],
  rows: number = ROAD_ROWS,
): BigRoadResult {
  const cells: BigRoadCell[] = [];
  const columns: BigRoadColumn[] = [];
  const plotter = createRoadPlotter(rows);
  let unattachedTieCount = 0;
  let colCount = 0;

  history.forEach((hand, handIndex) => {
    if (hand.winner === 'TIE') {
      const lastCell = cells[cells.length - 1];
      if (lastCell) lastCell.tieCount++;
      else unattachedTieCount++;
      return;
    }

    const current = columns[columns.length - 1];
    const startNewColumn = !current || current.winner !== hand.winner;
    const pos = plotter.place(startNewColumn);

    const cell: BigRoadCell = {
      col: pos.col,
      row: pos.row,
      winner: hand.winner,
      tieCount: cells.length === 0 ? unattachedTieCount : 0,
      natural: !!hand.natural,
      handIndex,
      logicalCol: startNewColumn ? columns.length : columns.length - 1,
      logicalRow: startNewColumn ? 0 : current.length,
    };
    if (cells.length === 0) unattachedTieCount = 0;
    cells.push(cell);

    if (startNewColumn) {
      columns.push({
        winner: hand.winner,
        length: 1,
        startCol: pos.col,
        cellIndexes: [cells.length - 1],
      });
    } else {
      current.length++;
      current.cellIndexes.push(cells.length - 1);
    }
    colCount = Math.max(colCount, pos.col + 1);
  });

  return { cells, columns, unattachedTieCount, colCount };
}

/* ═══════════════════════════ Derived roads ═══════════════════════════ */

export type DerivedColor = 'RED' | 'BLUE';

export interface DerivedRoadCell {
  col: number;
  row: number;
  color: DerivedColor;
  /** The Big Road hand whose placement generated this entry. */
  handIndex: number;
}

export interface DerivedRoadResult {
  cells: DerivedRoadCell[];
  colCount: number;
}

/** Big Eye Boy = 1, Small Road = 2, Cockroach Road = 3. */
export const DERIVED_OFFSETS = { bigEyeBoy: 1, smallRoad: 2, cockroachRoad: 3 } as const;

/**
 * The classic comparison rules, with `offset` = how many Big Road columns
 * back we compare against (all positions 0-based, using LOGICAL columns —
 * true streak lengths, unaffected by dragon-tail bending):
 *
 * A Big Road cell at (logicalCol c, logicalRow r) yields an entry when:
 *   • r ≥ 1 and c ≥ offset      — "did the reference column go this deep?"
 *       BLUE  iff len(c - offset) === r   (reference stopped exactly one
 *       short — the pattern just broke), RED otherwise (it either reached
 *       this depth, or had already ended: both read as "repeating").
 *   • r === 0 and c ≥ offset+1  — "did the last two compared columns fall
 *       the same way?"
 *       RED   iff len(c - 1) === len(c - 1 - offset), BLUE otherwise.
 *
 * With offset 1 the first possible entry is Big Road (col 2, row 2) or
 * (col 3, row 1) in 1-based terms — i.e. "after the 1st hand of column 2";
 * offsets 2 and 3 shift that start to columns 3 and 4 respectively.
 *
 * Entries then plot onto their own 6-row grid exactly like a Big Road:
 * repeated colors stack down, a color change opens a new column, and long
 * runs dragon-tail rightward.
 */
export function computeDerivedRoad(
  bigRoadCells: readonly BigRoadCell[],
  offset: number,
  rows: number = ROAD_ROWS,
): DerivedRoadResult {
  const lens: number[] = []; // running logical-column lengths as of each cell
  const cells: DerivedRoadCell[] = [];
  const plotter = createRoadPlotter(rows);
  let prevColor: DerivedColor | null = null;
  let colCount = 0;

  for (const cell of bigRoadCells) {
    const c = cell.logicalCol;
    const r = cell.logicalRow;
    if (r === 0) lens.push(1);
    else lens[c] = r + 1;

    let color: DerivedColor | null = null;
    if (r === 0) {
      if (c >= offset + 1) {
        color = lens[c - 1] === lens[c - 1 - offset] ? 'RED' : 'BLUE';
      }
    } else if (c >= offset) {
      color = lens[c - offset] === r ? 'BLUE' : 'RED';
    }
    if (color === null) continue;

    const pos = plotter.place(color !== prevColor);
    prevColor = color;
    cells.push({ col: pos.col, row: pos.row, color, handIndex: cell.handIndex });
    colCount = Math.max(colCount, pos.col + 1);
  }

  return { cells, colCount };
}

/* ═══════════════════════════ Dragon detection ═══════════════════════════ */

export interface DragonInfo {
  winner: 'BANKER' | 'PLAYER';
  length: number;
  logicalCol: number;
  /** The streak is the latest Big Road column — still growable. */
  live: boolean;
  /** Indexes into BigRoadResult.cells. */
  cellIndexes: number[];
}

export function findDragons(bigRoad: BigRoadResult, threshold = 5): DragonInfo[] {
  return bigRoad.columns.flatMap((column, logicalCol) =>
    column.length >= threshold
      ? [{
          winner: column.winner,
          length: column.length,
          logicalCol,
          live: logicalCol === bigRoad.columns.length - 1,
          cellIndexes: column.cellIndexes,
        }]
      : [],
  );
}

/* ═══════════════════════════ Aggregate snapshot ═══════════════════════════ */

export interface RoadmapStats {
  hands: number;
  banker: number;
  player: number;
  tie: number;
  bankerPairs: number;
  playerPairs: number;
  naturals: number;
}

export interface RoadmapSnapshot {
  beadPlate: BeadPlateCell[];
  bigRoad: BigRoadResult;
  bigEyeBoy: DerivedRoadResult;
  smallRoad: DerivedRoadResult;
  cockroachRoad: DerivedRoadResult;
  dragons: DragonInfo[];
  stats: RoadmapStats;
}

export interface RoadmapOptions {
  rows?: number;
  /** Streak length that triggers a Dragon alert. Default 5. */
  dragonThreshold?: number;
}

export function computeRoadmaps(
  history: readonly HandResult[],
  options: RoadmapOptions = {},
): RoadmapSnapshot {
  const rows = options.rows ?? ROAD_ROWS;
  const bigRoad = computeBigRoad(history, rows);

  const stats: RoadmapStats = {
    hands: history.length,
    banker: 0,
    player: 0,
    tie: 0,
    bankerPairs: 0,
    playerPairs: 0,
    naturals: 0,
  };
  for (const hand of history) {
    if (hand.winner === 'BANKER') stats.banker++;
    else if (hand.winner === 'PLAYER') stats.player++;
    else stats.tie++;
    if (hand.bankerPair) stats.bankerPairs++;
    if (hand.playerPair) stats.playerPairs++;
    if (hand.natural) stats.naturals++;
  }

  return {
    beadPlate: computeBeadPlate(history, rows),
    bigRoad,
    bigEyeBoy: computeDerivedRoad(bigRoad.cells, DERIVED_OFFSETS.bigEyeBoy, rows),
    smallRoad: computeDerivedRoad(bigRoad.cells, DERIVED_OFFSETS.smallRoad, rows),
    cockroachRoad: computeDerivedRoad(bigRoad.cells, DERIVED_OFFSETS.cockroachRoad, rows),
    dragons: findDragons(bigRoad, options.dragonThreshold ?? 5),
    stats,
  };
}

/* ═══════════════════════════ "Ask the road" ═══════════════════════════ */

export interface RoadPrediction {
  bigEyeBoy: DerivedColor | null;
  smallRoad: DerivedColor | null;
  cockroachRoad: DerivedColor | null;
}

/**
 * The two prediction dots on live scoreboards: for a hypothetical next
 * BANKER and next PLAYER win, which color would each derived road append?
 * null = that road would gain no entry yet.
 */
export function askTheRoad(
  history: readonly HandResult[],
  rows: number = ROAD_ROWS,
): { banker: RoadPrediction; player: RoadPrediction } {
  const baseCells = computeBigRoad(history, rows).cells;
  const baseCounts = (
    [DERIVED_OFFSETS.bigEyeBoy, DERIVED_OFFSETS.smallRoad, DERIVED_OFFSETS.cockroachRoad] as const
  ).map((offset) => computeDerivedRoad(baseCells, offset, rows).cells.length);

  const predict = (winner: 'BANKER' | 'PLAYER'): RoadPrediction => {
    const cells = computeBigRoad([...history, { winner }], rows).cells;
    const last = (offset: number, baseCount: number): DerivedColor | null => {
      const road = computeDerivedRoad(cells, offset, rows);
      return road.cells.length > baseCount ? road.cells[road.cells.length - 1].color : null;
    };
    return {
      bigEyeBoy: last(DERIVED_OFFSETS.bigEyeBoy, baseCounts[0]),
      smallRoad: last(DERIVED_OFFSETS.smallRoad, baseCounts[1]),
      cockroachRoad: last(DERIVED_OFFSETS.cockroachRoad, baseCounts[2]),
    };
  };

  return { banker: predict('BANKER'), player: predict('PLAYER') };
}
