// ═══════════════════════════════════════════════════════════════════
//  HOTDOG DROP — local top-10 board (demo-mode mock).
//  Seeded with Oktoberfest bots; claimed runs join as "YOU". Lives in
//  localStorage until the arena backend hosts a real weekly board
//  (fish-toss is landing that plumbing — this will ride the same
//  snapshot pattern). Cracking the top 10 is the signup hook: the
//  results screen asks the player to create an account to claim the
//  rank when the global board goes live.
// ═══════════════════════════════════════════════════════════════════

export interface BoardRow {
  name: string;
  score: number;
}

const BOARD_KEY = 'arena.hotdog.board';

// Bottom seed (700) is beatable in one decent run; HELGA takes practice.
const SEED_BOARD: BoardRow[] = [
  { name: 'HELGA', score: 4200 },
  { name: 'FRITZ', score: 3650 },
  { name: 'KLAUS', score: 3100 },
  { name: 'BRUNHILDE', score: 2800 },
  { name: 'OTTO', score: 2450 },
  { name: 'GRETEL', score: 2100 },
  { name: 'HANS', score: 1750 },
  { name: 'LIESL', score: 1400 },
  { name: 'WURSTKING', score: 1050 },
  { name: 'SEPP', score: 700 },
];

export function loadBoard(): BoardRow[] {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BoardRow[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // fall through to seed
  }
  return [...SEED_BOARD];
}

/** 1-based rank this score would take, or null if it misses the top 10. */
export function hotdogRank(score: number): number | null {
  if (score <= 0) return null;
  const rank = loadBoard().filter(r => r.score >= score).length + 1;
  return rank <= 10 ? rank : null;
}

/** Record a claimed run under "YOU"; board stays exactly 10 rows. */
export function recordScore(score: number): void {
  const board = loadBoard();
  board.push({ name: 'YOU', score });
  board.sort((a, b) => b.score - a.score);
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board.slice(0, 10)));
  } catch {
    // storage full/blocked — the run still counts, the board just won't persist
  }
}
