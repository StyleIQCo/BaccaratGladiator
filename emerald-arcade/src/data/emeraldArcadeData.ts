/**
 * emeraldArcadeData.ts — configuration dictionary for the Emerald City
 * Arcade: 11 Seattle-themed daily-challenge mini-games acting as chip
 * faucets for the main table.
 *
 * This module is the single source of truth the hub, the reward pipeline,
 * and every mini-game read from. Adding game #11 means adding one entry
 * here — the hub carousel, category chips, and reward caps all derive
 * from this array.
 *
 * PARALLEL-STATE GUARANTEE (same contract as the Odyssey module): nothing
 * here reads or writes the classic 62-stage save. Arcade progress and
 * daily-ticket state live exclusively under ARCADE_STORAGE_KEY.
 */

export const ARCADE_EVENT_ID = 'emerald-arcade-2026';
export const ARCADE_STORAGE_KEY = 'bg_emerald_arcade_v1';

/** Tickets refill daily; one ticket = one scored run of any arcade game. */
export const ARCADE_DAILY_TICKETS = 3;

export type ArcadeCategory = 'Action' | 'Racing' | 'Rhythm';

/** Neon accent per category — the hub's rain-soaked signage palette. */
export const CATEGORY_ACCENTS: Record<ArcadeCategory, string> = {
  Action: '#ff5c7a', // salmon-neon pink
  Racing: '#37e5ff', // monorail cyan
  Rhythm: '#b56bff', // stage-light violet
};

export interface ArcadeGameConfig {
  id: string;
  title: string;
  category: ArcadeCategory;
  /** Art-direction brief for the card thumbnail (and, later, key art). */
  thumbnail: string;
  /** Placeholder glyph shown on the hub card until key art lands. */
  glyph: string;
  /** One-line pitch shown on the card; the expanded view shows it in full. */
  description: string;
  /** Max chips a single calendar day of runs can pay out for this game. */
  dailyRewardLimit: number;
  isUnlocked: boolean;
  /** Per-game neon accent; defaults to the category accent when styling. */
  accent: string;
}

export const EMERALD_ARCADE_GAMES: ArcadeGameConfig[] = [
  {
    id: 'salmon-run-ladder',
    title: 'Salmon Run Ladder',
    category: 'Action',
    thumbnail:
      'A silver king salmon mid-leap up the Ballard Locks fish ladder, spray frozen in neon backlight, gulls silhouetted against a slate sky.',
    glyph: '🐟',
    description:
      'Time your taps to leap the salmon up the Ballard Locks ladder. Miss a rung and the current drags you back — chain perfect leaps for spawning-run multipliers.',
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#ff8d6b',
  },
  {
    id: 'market-produce-toss',
    title: 'Market Produce Toss',
    category: 'Action',
    thumbnail:
      'A Pike Place stall crew hurling produce over the counter, motion-blurred arcs of red and green under hanging market bulbs.',
    glyph: '🥬',
    description:
      'The stall crew is throwing, you are catching. Snag clean produce, dodge the bruised stuff, and never — ever — drop the flying fish finale.',
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#7dff9b',
  },
  {
    id: 'rainier-cherry-picker',
    title: 'Rainier Cherry Picker',
    category: 'Action',
    thumbnail:
      'A woven basket under a heavy cherry bough, Mount Rainier glowing gold at dusk behind the orchard rows, cherries mid-fall.',
    glyph: '🍒',
    description:
      'One sunny afternoon, one basket, sixty seconds. Drag the basket to catch falling Bings (+10) and prized golden Rainiers (+50) — but let the bird-pecked rot (−20) hit the dirt.',
    dailyRewardLimit: 5000,
    isUnlocked: true,
    accent: '#ffd75e',
  },
  {
    id: 'monorail-dash',
    title: 'Monorail Dash',
    category: 'Racing',
    thumbnail:
      'The Seattle Center Monorail streaking down its elevated track at night, neon reflections smeared across wet glass towers.',
    glyph: '🚝',
    description:
      'Throttle the historic monorail from Westlake to Seattle Center. Feather the brakes into stations, hit the platform marks, and keep the tourists upright.',
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#37e5ff',
  },
  {
    id: 'ski-to-sea-relay',
    title: 'Ski-to-Sea Relay',
    category: 'Racing',
    thumbnail:
      'A split-panel relay: skier carving a mountain face, cyclist descending a forest road, kayaker digging into whitecapped bay water.',
    glyph: '⛷️',
    description:
      'Mountain to bay in one breathless relay — ski, bike, and paddle three timed legs. Clean handoffs bank bonus seconds; wipeouts cost you the podium.',
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#8fd8ff',
  },
  {
    id: 'float-plane-landing',
    title: 'Float Plane Landing',
    category: 'Racing',
    thumbnail:
      'A DHC-2 float plane on final approach over Lake Union at dusk, houseboats and seaplane wakes below, city lights doubling on the water.',
    glyph: '🛩️',
    description:
      'Bring the float plane down onto Lake Union in one piece. Manage descent, dodge sailboats and wakes, and grease the landing inside the scoring lane.',
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#5eb8ff',
  },
  {
    id: 'grunge-garage-jam',
    title: 'Grunge Garage Jam',
    category: 'Rhythm',
    thumbnail:
      'A dim garage band silhouette — flannel, drum kit, a single hanging bulb — with note lanes crashing toward a battered amp stack.',
    glyph: '🎸',
    description:
      "Four lanes, one garage, all fuzz. Hit the riffs on the beat to keep the jam alive — string perfects together and the amp goes legendary.",
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#b56bff',
  },
  {
    id: 'pike-st-barista-rush',
    title: 'Pike St. Barista Rush',
    category: 'Rhythm',
    thumbnail:
      'A rain-streaked cafe window on Pike St., a barista silhouetted against the copper glow of an espresso machine, steam curling past hanging Edison bulbs.',
    glyph: '☕',
    description:
      'Sixty seconds of morning rush. Tamp on the needle, cut the shot at the etched line, pour latte art before the foam settles — perfect drinks stack a Caffeine Rush multiplier.',
    dailyRewardLimit: 5000,
    isUnlocked: true,
    accent: '#ffb17a',
  },
  {
    id: 'underground-tour-maze',
    title: 'Underground Tour Maze',
    category: 'Rhythm',
    thumbnail:
      'Lantern light on brick arches beneath Pioneer Square, a winding passage of old storefronts sinking into darkness.',
    glyph: '🏮',
    description:
      'The lantern shows the path under Pioneer Square once — then the dark takes it back. Memorize the route through the buried city and walk it from memory.',
    dailyRewardLimit: 5000,
    isUnlocked: false,
    accent: '#ffb86b',
  },
  {
    id: 'cascadian-forest-forager',
    title: 'Cascadian Forest Forager',
    category: 'Action',
    thumbnail:
      'A woven cedar basket spilling chanterelles and huckleberries on a mossy nurse log, dawn shafts cutting through old-growth firs, a truffle dog mid-point at fresh-turned soil.',
    glyph: '🍄',
    description:
      'Sixty seconds, three zones, one legendary meal. Pluck chanterelles off the mossy log, catch huckleberries in the brambles, and hold your nerve digging truffles — fill the full quota to unlock the 25,000-chip Artisan Feast.',
    // Limit equals the feast payout: one perfect run a day is the ceiling.
    dailyRewardLimit: 25000,
    isUnlocked: true,
    accent: '#9be06b',
  },
  {
    id: 'madrona-wood-labyrinth',
    title: 'Madrona Wood Labyrinth',
    category: 'Action',
    thumbnail:
      'A hand-carved madrona-wood maze board tilting under lantern light, a glass marble mid-roll past a splintered barrier, an emerald inlay glowing at the maze heart.',
    glyph: '🪵',
    description:
      'Tilt the carved madrona board and roll for the emerald. Pick your marble — glass flies, iron crushes the cracked barriers — and mind the knot-holes.',
    dailyRewardLimit: 5000,
    isUnlocked: true,
    accent: '#e0704f',
  },
  {
    id: 'emerald-city-claw',
    title: 'Emerald City Claw',
    category: 'Action',
    thumbnail:
      'A claw-machine cabinet glowing neon pink and cyan on a rainy arcade floor, a chrome three-prong claw poised over a pile of Seattle souvenirs — a Rainier tallboy, a plush kraken, a glass Chihuly orb catching the light.',
    glyph: '🕹️',
    description:
      'Four tokens, one motorized claw, a cabinet full of Seattle. Line up the drop and pray the grip holds — heavy prizes slip, glass orbs squirm, and the Fremont Troll demands a perfect grab. Land them in the chute for chips.',
    // Ceiling ≈ the orb + the troll in one hot run; the full cabinet is 21,250.
    dailyRewardLimit: 15000,
    isUnlocked: true,
    accent: '#ff5ce1',
  },
];

export function getArcadeGame(id: string): ArcadeGameConfig | undefined {
  return EMERALD_ARCADE_GAMES.find((g) => g.id === id);
}
