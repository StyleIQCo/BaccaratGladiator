// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — marble data dictionary.
//
//  Emerald City Arcade cabinet #11: tilt a hand-carved madrona board
//  and roll for the emerald inlay. This module is the single source of
//  truth for the player's marble loadout — the physics hook, the
//  canvas renderer, the inventory UI, and the sfx layer all read the
//  same spec object, so a marble is fully described by one entry here.
//
//  The design triangle:
//    STEEL — the balanced default. Learns the board honestly.
//    GLASS — 30% faster and stops on a dime (heavy roll friction),
//            but restitution 0.8 means every wall kiss is a ricochet.
//            Cannot break barriers.
//    IRON  — slow to spin up (a = force / mass, and mass is king),
//            dead bounces, and the only marble whose kinetic energy
//            can shatter a cracked barrier. Loot routes are iron-gated.
//
//  Units: the board is a 9×12 grid of 1-unit cells. Speeds are
//  units/second; masses are relative to steel = 1.
// ═══════════════════════════════════════════════════════════════════

export type MarbleId = 'steel' | 'glass' | 'iron';

/** Everything the canvas needs to draw one marble type. Offsets and
 *  radii are fractions of the ball radius so the render scales freely. */
export interface MarbleRenderSpec {
  /** Radial-gradient stops, hot-spot → mid → shaded edge. */
  body: [string, string, string];
  /** Ball-edge rim stroke. */
  rim: string;
  /** globalAlpha for the body fill — glass reads translucent at 0.85. */
  alpha: number;
  /** Specular highlight: offset from centre, radius, strength. */
  specular: { dx: number; dy: number; r: number; alpha: number };
  /** Inner glowing ring — the "polished glass" tell. Glass only. */
  innerGlow?: { color: string; radius: number; width: number; alpha: number };
  /** Draw the pitted matte speckle pass. Iron only. */
  pitted?: boolean;
}

export interface MarbleSpec {
  id: MarbleId;
  name: string;
  /** One-line pitch on the selector card. */
  tagline: string;
  /** Relative to steel = 1. Acceleration under tilt is force / mass. */
  mass: number;
  /** Bounciness on wall contact, 0.1 (dead) … 0.8 (violent). */
  restitution: number;
  /** Top speed cap, board units/s. */
  maxSpeed: number;
  /** Exponential rolling-drag rate (1/s). High = stops on a dime. */
  rollFriction: number;
  /** 0 = bounces off cracked barriers like any wall. >0 = can shatter
   *  them when kinetic energy clears the barrier's break threshold. */
  breakPower: number;
  /** 0…1 fills for the inventory card's stat bars. */
  stats: { speed: number; control: number; power: number };
  /** Card accent + swatch tint in the inventory UI. */
  accent: string;
  render: MarbleRenderSpec;
}

export const MARBLES: MarbleSpec[] = [
  {
    id: 'steel',
    name: 'Steel Marble',
    tagline: 'The mill-town classic. Honest weight, honest bounce.',
    mass: 1.0,
    restitution: 0.45,
    maxSpeed: 7.0,
    rollFriction: 1.0,
    breakPower: 0,
    stats: { speed: 0.55, control: 0.6, power: 0.1 },
    accent: '#aebfcc',
    render: {
      body: ['#f4f7fa', '#9fb0bd', '#4c5a66'],
      rim: '#2e3a44',
      alpha: 1,
      specular: { dx: -0.35, dy: -0.35, r: 0.28, alpha: 0.9 },
    },
  },
  {
    id: 'glass',
    name: 'Glass Marble',
    tagline: 'Blown on Puget Sound. Flies — and ricochets like it.',
    mass: 0.55,
    restitution: 0.8,
    // 30% over steel: speed is the whole sales pitch.
    maxSpeed: 9.1,
    rollFriction: 1.7,
    breakPower: 0,
    stats: { speed: 0.95, control: 0.4, power: 0 },
    accent: '#7fe7f2',
    render: {
      body: ['#eafcff', '#9fe8f0', '#3aa8bd'],
      rim: 'rgba(224,250,255,0.9)',
      alpha: 0.85,
      specular: { dx: -0.3, dy: -0.38, r: 0.34, alpha: 0.95 },
      innerGlow: { color: '#bffbff', radius: 0.55, width: 0.14, alpha: 0.6 },
    },
  },
  {
    id: 'iron',
    name: 'Iron Heavy-Ball',
    tagline: 'Foundry surplus. Slow to wake, and walls should worry.',
    mass: 2.2,
    restitution: 0.1,
    maxSpeed: 5.6,
    rollFriction: 0.45,
    breakPower: 10,
    stats: { speed: 0.3, control: 0.8, power: 1 },
    accent: '#e0704f',
    render: {
      body: ['#6a6f75', '#42464b', '#232629'],
      rim: '#101214',
      alpha: 1,
      specular: { dx: -0.3, dy: -0.3, r: 0.2, alpha: 0.25 },
      pitted: true,
    },
  },
];

export const DEFAULT_MARBLE_ID: MarbleId = 'steel';

export function getMarble(id: MarbleId): MarbleSpec {
  // MARBLES covers every MarbleId, so the fallback only guards data edits.
  return MARBLES.find((m) => m.id === id) ?? MARBLES[0];
}
