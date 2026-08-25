/**
 * odysseyStoryData.ts — narrative + progression data for "The Odyssey",
 * the limited-time parallel campaign.
 *
 * PARALLEL-STATE GUARANTEE: nothing in this module reads or writes the
 * classic 62-stage save. Odyssey progress (including `activeCampaign`)
 * lives exclusively under ODYSSEY_STORAGE_KEY.
 */

export const ODYSSEY_EVENT_ID = 'odyssey-2026';
export const ODYSSEY_STORAGE_KEY = 'bg_odyssey_progress_v1';

/** When the limited-time event closes (drives the selector countdown). */
export const ODYSSEY_EVENT_ENDS_AT = '2026-09-30T23:59:59Z';

/** Documentation constant — the classic campaign is never touched. */
export const CLASSIC_CAMPAIGN_STAGE_COUNT = 62;

/** Which campaign the player is currently inside. Stored ONLY in the
 *  odyssey namespace; the classic save has no knowledge of it. */
export type ActiveCampaign = 'CLASSIC' | 'ODYSSEY';

export type OdysseyAudioTheme = 'mystic_chords' | 'boss_drums' | 'ocean_ambient';

export interface DialogueLine {
  speaker: string;
  text: string;
}

/** Machine-readable objective the table engine evaluates per hand. */
export type OdysseyWinCondition =
  | { type: 'WIN_HANDS'; count: number }
  | { type: 'WIN_STREAK'; count: number }
  | { type: 'NATURAL_NINE'; side: 'PLAYER' }
  | { type: 'BREAK_BANKER_STREAKS'; count: number }
  | { type: 'ROADMAP_CALLS'; count: number }
  | { type: 'SURVIVE_HANDS'; count: number }
  | { type: 'SHOOTOUT'; hands: number };

/** Table rule the stage imposes on top of the win condition. */
export type OdysseyTableModifier =
  | 'SHIFTING_MULTIPLIERS'
  | 'NO_TIE_BETS'
  | 'NO_SIDE_BETS'
  | 'HIGH_ROLLER';

export interface OdysseyStage {
  id: number;
  slug: string;
  title: string;
  /** Short flavor subtitle, shown under the node name on the campaign map. */
  epithet: string;
  isBossStage: boolean;
  audioTheme: OdysseyAudioTheme;
  /** The stage's story card — streamed by the cutscene typewriter. */
  narrative: string;
  /** Human-readable objective shown in the cutscene and table HUD. */
  objective: string;
  winCondition: OdysseyWinCondition;
  tableModifier?: OdysseyTableModifier;
  intro: DialogueLine[];
  victory: DialogueLine[];
  /** Percent coordinates on the Mediterranean campaign map (0–100). */
  mapPosition: { x: number; y: number };
  reward: { gold: number; relic?: string };
}

export const ODYSSEY_STAGES: OdysseyStage[] = [
  {
    id: 1,
    slug: 'lotus-eaters',
    title: 'Isle of the Lotus-Eaters',
    epithet: 'Sweet fruit. Forgotten homes.',
    isBossStage: false,
    audioTheme: 'mystic_chords',
    narrative:
      'The air is sweet, and the cards are heavy. The trance is setting in. Win three hands to clear your mind before you forget your way home.',
    objective: 'Win 3 hands to clear your mind.',
    winCondition: { type: 'WIN_HANDS', count: 3 },
    intro: [
      { speaker: 'Eurylochus', text: 'Captain... why hurry? The fruit is sweet. Stay. Play forever...' },
      { speaker: 'Athena', text: 'Three clean wins, Gladiator — prove your mind is still your own.' },
    ],
    victory: [
      { speaker: 'Narrator', text: 'You drag your crew back to the ships and lash them to the benches. The haze lifts.' },
      { speaker: 'Athena', text: 'A sharp mind beats a sweet fruit. Onward.' },
    ],
    mapPosition: { x: 8, y: 74 },
    reward: { gold: 500 },
  },
  {
    id: 2,
    slug: 'cave-of-polyphemus',
    title: 'Cave of Polyphemus',
    epithet: 'One eye. One perfect hand.',
    isBossStage: true,
    audioTheme: 'boss_drums',
    narrative:
      'The Cyclops traps you in his cavern. He plays a brutal, high-stakes game. A Natural 9 on the Player side will blind the beast!',
    objective: 'Deal a Natural 9 on the Player side.',
    winCondition: { type: 'NATURAL_NINE', side: 'PLAYER' },
    intro: [
      { speaker: 'Polyphemus', text: 'WHO DARES GAMBLE IN MY CAVE? I will eat you last, little Nobody.' },
      { speaker: 'Athena', text: 'One eye, one perfect hand. Nine on the Player side, and we sail out of this tomb.' },
    ],
    victory: [
      { speaker: 'Polyphemus', text: 'AAARGH! NOBODY HAS BLINDED ME! NOBODY!' },
      { speaker: 'Narrator', text: 'You ride beneath the rams and slip out into daylight. But a wounded son cries out — and Poseidon hears.' },
    ],
    mapPosition: { x: 18, y: 54 },
    reward: { gold: 1500, relic: 'Eye of Polyphemus' },
  },
  {
    id: 3,
    slug: 'island-of-aeolus',
    title: 'Island of Aeolus',
    epithet: 'Fortune rides the winds.',
    isBossStage: false,
    audioTheme: 'ocean_ambient',
    narrative:
      'The King of Winds offers a chaotic breeze. Watch the table closely—multipliers will shift wildly with every draw.',
    objective: 'Win 4 hands while the multipliers gust.',
    winCondition: { type: 'WIN_HANDS', count: 4 },
    tableModifier: 'SHIFTING_MULTIPLIERS',
    intro: [
      { speaker: 'Aeolus', text: 'A gift, wanderer: every ill wind bound in ox-hide — and a table where fortune itself gusts and turns.' },
      { speaker: 'Athena', text: 'The multipliers ride his winds. Strike when they blow gold.' },
    ],
    victory: [
      { speaker: 'Narrator', text: 'The cord holds. The west wind fills your sail, and Ithaca rises on the horizon.' },
      { speaker: 'Aeolus', text: 'Discipline at the table, discipline at the mast. You may make it home yet.' },
    ],
    mapPosition: { x: 30, y: 38 },
    reward: { gold: 1000 },
  },
  {
    id: 4,
    slug: 'circes-palace',
    title: "Circe's Palace",
    epithet: 'The enchantress deals in swine.',
    isBossStage: false,
    audioTheme: 'mystic_chords',
    narrative:
      'The sorceress Circe turns losing gamblers into swine. Defeat her Banker streaks to keep your humanity and your chips.',
    objective: 'Break 3 of her Banker streaks.',
    winCondition: { type: 'BREAK_BANKER_STREAKS', count: 3 },
    intro: [
      { speaker: 'Circe', text: 'Welcome, weary sailor. Sit. Drink. Wager. My table is... transformative.' },
      { speaker: 'Narrator', text: 'Around you, men with the faces of pigs grunt over their cards. Her potion is already in the wine.' },
      { speaker: 'Athena', text: 'The moly herb protects you. Break her Banker streaks, and she must yield.' },
    ],
    victory: [
      { speaker: 'Circe', text: 'You are no ordinary gambler. Your crew is restored... and my charts of the Underworld are yours.' },
      { speaker: 'Narrator', text: 'She marks a course to the one place no living gambler has returned from.' },
    ],
    mapPosition: { x: 43, y: 52 },
    reward: { gold: 1250 },
  },
  {
    id: 5,
    slug: 'the-underworld',
    title: 'The Underworld',
    epithet: 'Even the dead hold cards.',
    isBossStage: true,
    audioTheme: 'boss_drums',
    narrative:
      'Tiresias the Oracle waits in the shadows of the River Styx. You must consult the Roadmaps of the dead to survive this trial.',
    objective: 'Read the Roadmaps and call 3 hands true.',
    winCondition: { type: 'ROADMAP_CALLS', count: 3 },
    intro: [
      { speaker: 'Narrator', text: 'You pour the offerings into the trench, and the shades crowd close — pale gamblers still clutching their last hands.' },
      { speaker: 'Tiresias', text: 'The dead remember every hand ever dealt, Gladiator. Their roads are drawn in bead and blood.' },
      { speaker: 'Tiresias', text: "Read the Roadmaps of the dead. Call the river's turn three times, and the ferryman will carry you back." },
    ],
    victory: [
      { speaker: 'Tiresias', text: 'You read the roads as the dead do. Go — and beware the cattle of the sun, and the song upon the strait.' },
      { speaker: 'Narrator', text: 'The gates groan open. You climb back toward sunlight, carrying a prophecy.' },
    ],
    mapPosition: { x: 39, y: 78 },
    reward: { gold: 2500, relic: 'Obol of the Ferryman' },
  },
  {
    id: 6,
    slug: 'sirens-cove',
    title: "Sirens' Cove",
    epithet: 'A song that empties every bankroll.',
    isBossStage: false,
    audioTheme: 'mystic_chords',
    narrative:
      "Their song promises endless chips on the Tie bet... but it's a trap. Stick to your strategy or drown in the reef.",
    objective: 'Win 4 hands — the Tie bet is sealed.',
    winCondition: { type: 'WIN_HANDS', count: 4 },
    tableModifier: 'NO_TIE_BETS',
    intro: [
      { speaker: 'The Sirens', text: 'Come, clever one... the Tie pays eight to one, every time, forever and everrr...' },
      { speaker: 'Athena', text: 'Wax for the crew, rope for your wrists. Their song is tilt itself — hold your strategy.' },
    ],
    victory: [
      { speaker: 'Narrator', text: 'The song fades astern. Your wrists are raw from the rope — but your bankroll is whole.' },
      { speaker: 'Athena', text: 'You heard the song every gambler drowns to, and rowed on. Remarkable.' },
    ],
    mapPosition: { x: 55, y: 68 },
    reward: { gold: 1500 },
  },
  {
    id: 7,
    slug: 'scylla-charybdis',
    title: 'Scylla & Charybdis',
    epithet: 'Six heads above, a whirlpool below.',
    isBossStage: false,
    audioTheme: 'ocean_ambient',
    narrative:
      'A six-headed monster to the left, a chip-draining whirlpool to the right. Survive 5 hands without busting your stack.',
    objective: 'Survive 5 hands without busting.',
    winCondition: { type: 'SURVIVE_HANDS', count: 5 },
    intro: [
      { speaker: 'Narrator', text: 'The strait narrows. Six heads strike from the cliff above; below, Charybdis drinks the sea and spits it back.' },
      { speaker: 'Circe', text: 'You cannot beat them both, sailor. Lose a little to the monster — never everything to the whirlpool.' },
    ],
    victory: [
      { speaker: 'Narrator', text: 'Scylla takes her toll, but the ship holds. You count your crew, your coins — still above water, in every sense.' },
      { speaker: 'Athena', text: 'Every master of the table knows: the win is surviving the variance.' },
    ],
    mapPosition: { x: 65, y: 48 },
    reward: { gold: 2000 },
  },
  {
    id: 8,
    slug: 'island-of-helios',
    title: 'Island of Helios',
    epithet: 'Touch nothing that belongs to the sun.',
    isBossStage: false,
    audioTheme: 'ocean_ambient',
    narrative:
      "The sun god's golden cattle graze here. Beware the forbidden side bets. Pure Player and Banker wins only.",
    objective: 'Win 4 hands — main bets only, no side bets.',
    winCondition: { type: 'WIN_HANDS', count: 4 },
    tableModifier: 'NO_SIDE_BETS',
    intro: [
      { speaker: 'Narrator', text: 'Golden cattle graze the shore — sacred, forbidden, tempting. Your starving crew eyes the herd.' },
      { speaker: 'Athena', text: 'No side bets on holy ground, Gladiator. Player and Banker, nothing more.' },
    ],
    victory: [
      { speaker: 'Narrator', text: 'The herd grazes on, uncounted and untouched. Helios finds no cause for wrath.' },
      { speaker: 'Athena', text: 'Restraint is a weapon few gamblers ever master.' },
    ],
    mapPosition: { x: 76, y: 62 },
    reward: { gold: 1750 },
  },
  {
    id: 9,
    slug: 'calypsos-island',
    title: "Calypso's Island",
    epithet: 'A gilded cage. A VIP room.',
    isBossStage: false,
    audioTheme: 'mystic_chords',
    narrative:
      'A golden cage of endless luxury. You must win 3 consecutive hands (A Dragon Streak) to break her spell and leave this VIP room.',
    objective: 'Win 3 hands in a row — a Dragon Streak.',
    winCondition: { type: 'WIN_STREAK', count: 3 },
    intro: [
      { speaker: 'Calypso', text: 'Stay, and I will make you immortal. Every night at my table, every stake covered, forever.' },
      { speaker: 'Athena', text: "Three wins, back to back. A Dragon Streak breaks a goddess's spell." },
    ],
    victory: [
      { speaker: 'Calypso', text: 'Go, then. No goddess can hold a heart that is already home.' },
      { speaker: 'Narrator', text: 'Log by log, win by win, the raft takes shape. Ithaca is one storm away.' },
    ],
    mapPosition: { x: 86, y: 44 },
    reward: { gold: 3000 },
  },
  {
    id: 10,
    slug: 'great-hall-of-ithaca',
    title: 'Great Hall of Ithaca',
    epithet: 'String the bow. Reclaim the hall.',
    isBossStage: true,
    audioTheme: 'boss_drums',
    narrative:
      'The Suitors have taken over your casino. String the Great Bow and reclaim your throne in a 10-hand high-roller shootout!',
    objective: 'Win the 10-hand high-roller shootout.',
    winCondition: { type: 'SHOOTOUT', hands: 10 },
    tableModifier: 'HIGH_ROLLER',
    intro: [
      { speaker: 'Narrator', text: 'Twenty years, and home at last — to find your hall full of suitors gambling away your kingdom with your own gold.' },
      { speaker: 'Antinous', text: 'Look, a beggar wants a seat at the table! Very well, old man. One hand. Everything you have.' },
      { speaker: 'Athena', text: 'String the bow, Gladiator. Ten hands, all stakes — reclaim your hall.' },
    ],
    victory: [
      { speaker: 'Narrator', text: "The final hand lands like an arrow through twelve axe heads. The beggar's rags fall away, and the suitors know their king." },
      { speaker: 'Penelope', text: 'Twenty years I kept your seat at this table. Welcome home, Gladiator.' },
      { speaker: 'Athena', text: 'The Odyssey is complete. Sing, Muse, of the gambler of many ways.' },
    ],
    mapPosition: { x: 93, y: 22 },
    reward: { gold: 10000, relic: 'Bow of Odysseus' },
  },
];

export const ODYSSEY_STAGE_COUNT = ODYSSEY_STAGES.length;

/** Node ids the campaign map badges as BOSS (kept in data, not hard-coded UI). */
export const ODYSSEY_BOSS_STAGE_IDS = ODYSSEY_STAGES.filter((s) => s.isBossStage).map(
  (s) => s.id,
);

export function getOdysseyStage(id: number): OdysseyStage | undefined {
  return ODYSSEY_STAGES.find((s) => s.id === id);
}

// ---- parallel campaign state ----------------------------------------------

export interface OdysseyProgress {
  activeCampaign: ActiveCampaign;
  /** Highest Odyssey stage cleared (0 = none). Classic progress lives elsewhere. */
  highestClearedStage: number;
  relics: string[];
}

export const DEFAULT_ODYSSEY_PROGRESS: OdysseyProgress = {
  activeCampaign: 'CLASSIC',
  highestClearedStage: 0,
  relics: [],
};

export function loadOdysseyProgress(): OdysseyProgress {
  if (typeof window === 'undefined') return DEFAULT_ODYSSEY_PROGRESS;
  try {
    const raw = window.localStorage.getItem(ODYSSEY_STORAGE_KEY);
    if (!raw) return DEFAULT_ODYSSEY_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<OdysseyProgress>;
    return {
      activeCampaign: parsed.activeCampaign === 'ODYSSEY' ? 'ODYSSEY' : 'CLASSIC',
      highestClearedStage:
        typeof parsed.highestClearedStage === 'number'
          ? Math.min(Math.max(parsed.highestClearedStage, 0), ODYSSEY_STAGE_COUNT)
          : 0,
      relics: Array.isArray(parsed.relics) ? parsed.relics.filter((r) => typeof r === 'string') : [],
    };
  } catch {
    return DEFAULT_ODYSSEY_PROGRESS;
  }
}

export function saveOdysseyProgress(progress: OdysseyProgress): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ODYSSEY_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full or blocked (private mode) — progress is session-only then.
  }
}
