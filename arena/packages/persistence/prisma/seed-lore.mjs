// Seed the Wild West lore set — the first authored collectible set
// (mirrored by web/src/collectibles/LoreDemo.tsx, keep them in sync).
// Idempotent via skipDuplicates; run once per environment:
//   DATABASE_URL=... node prisma/seed-lore.mjs
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const CHARACTER = "Sheriff Rosa 'Lone Star' Delgado";

const WILD_WEST_SET = [
  {
    slug: 'lone-star-sheriffs-badge',
    title: "Lone Star Sheriff's Badge",
    icon: '⭐',
    trigger: 'TIE_WIN',
    sortOrder: 0,
    loreText:
      'Rosa pinned this star on at nineteen, the night the Delgado table burned. ' +
      'She swore the house would never cheat an honest player again — and in thirty years, it never has.',
  },
  {
    slug: 'torn-wanted-poster',
    title: 'Torn Wanted Poster',
    icon: '📜',
    trigger: 'NATURAL_WIN',
    sortOrder: 1,
    loreText:
      "Half a face and a $2,000 bounty. The other half of the poster is in Rosa's desk drawer, " +
      "and she'll tell you the dealer it names left town in a hurry. She won't tell you why she kept it.",
  },
  {
    slug: 'brass-saloon-key',
    title: 'Brass Saloon Key',
    icon: '🗝️',
    trigger: 'WIN_STREAK',
    triggerValue: 3,
    sortOrder: 2,
    loreText:
      'Opens the back room of the Mockingbird Saloon, where the real games were played before Rosa ' +
      "took the badge. The lock's been changed twice. The key still works.",
  },
  {
    slug: 'dusty-diary-page',
    title: 'Dusty Diary Page',
    icon: '📖',
    trigger: 'PLAYER_WIN',
    sortOrder: 3,
    loreText:
      '"Papa says the cards remember. I say the cards forget, and that\'s their mercy. — R.D., age 11." ' +
      'The ink is faded; the hand is unmistakably hers.',
  },
  {
    slug: 'engraved-pocket-watch',
    title: 'Engraved Pocket Watch',
    icon: '🕰️',
    trigger: 'STAGE_CLEAR',
    sortOrder: 4,
    loreText:
      'Stopped at 3:47 — the minute the old Delgado table burned. Rosa winds it every morning anyway. ' +
      '"Time doesn\'t heal," she says. "It just deals the next hand."',
  },
].map(item => ({ ...item, characterName: CHARACTER, stageSlug: 'wild-west', tier: 4 }));

const res = await db.collectible.createMany({ data: WILD_WEST_SET, skipDuplicates: true });
console.log(`[seed-lore] inserted ${res.count} collectibles (${WILD_WEST_SET.length - res.count} already present)`);
await db.$disconnect();
