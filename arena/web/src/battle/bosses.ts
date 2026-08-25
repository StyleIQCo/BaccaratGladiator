// Stage boss roster — palette-driven so each boss inherits its stage's
// theme accents (Imperial Roman gold, Neo Tokyo cyan/magenta, …).
export interface BossConfig {
  id: string;
  name: string;
  title: string;
  stage: number;
  emoji: string;
  /** Primary accent (hex) — health bar, crit text, glow */
  accent: string;
  /** Secondary accent for gradients */
  accent2: string;
  /** Avatar backdrop gradient */
  gradient: string;
  /** Taunts shown in the battle log */
  taunts: string[];
}

export const BOSSES: Record<string, BossConfig> = {
  emperor: {
    id: 'emperor',
    name: 'The Emperor',
    title: 'Lord of the Grand Arena',
    stage: 60,
    emoji: '👑',
    accent: '#ffd24a',
    accent2: '#ff8a2a',
    gradient: 'radial-gradient(circle at 35% 30%, #8a6d25 0%, #3d2e0a 60%, #161004 100%)',
    taunts: [
      'The house always crowns me.',
      'Rome was not beaten in a day.',
      'Your chips fund my colosseum.',
    ],
  },
  neonDragon: {
    id: 'neonDragon',
    name: 'Kaito',
    title: 'Neon Dragon of Neo Tokyo',
    stage: 47,
    emoji: '🐉',
    accent: '#2ee6ff',
    accent2: '#ff2e88',
    gradient: 'radial-gradient(circle at 35% 30%, #0e4a5e 0%, #2a0e3e 60%, #0a0618 100%)',
    taunts: [
      'The city never folds. Neither do I.',
      'Your luck glitches out here.',
      'I count cards in my sleep mode.',
    ],
  },
};
