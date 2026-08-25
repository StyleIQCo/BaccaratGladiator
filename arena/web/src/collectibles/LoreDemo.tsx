// ═══════════════════════════════════════════════════════════════════
//  LORE DEMO — DemoHub tab for the collectible unlock cinematic.
//  Mock-driven like every DemoHub feature: no sockets, no backend.
//  The five fragments mirror prisma/seed-lore.mjs (the Wild West set),
//  so what testers preview here is exactly what the live trigger drops.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import CollectibleUnlockModal, { type LoreUnlockView } from './CollectibleUnlockModal';

const CHARACTER = "Sheriff Rosa 'Lone Star' Delgado";

const SET: Array<{ title: string; icon: string; how: string; loreText: string }> = [
  {
    title: "Lone Star Sheriff's Badge", icon: '⭐', how: 'Win a TIE bet',
    loreText: 'Rosa pinned this star on at nineteen, the night the Delgado table burned. She swore the house would never cheat an honest player again — and in thirty years, it never has.',
  },
  {
    title: 'Torn Wanted Poster', icon: '📜', how: 'Win with a natural 8 or 9',
    loreText: "Half a face and a $2,000 bounty. The other half of the poster is in Rosa's desk drawer, and she'll tell you the dealer it names left town in a hurry. She won't tell you why she kept it.",
  },
  {
    title: 'Brass Saloon Key', icon: '🗝️', how: 'Win 3 hands in a row',
    loreText: "Opens the back room of the Mockingbird Saloon, where the real games were played before Rosa took the badge. The lock's been changed twice. The key still works.",
  },
  {
    title: 'Dusty Diary Page', icon: '📖', how: 'Win a PLAYER bet',
    loreText: '"Papa says the cards remember. I say the cards forget, and that\'s their mercy. — R.D., age 11." The ink is faded; the hand is unmistakably hers.',
  },
  {
    title: 'Engraved Pocket Watch', icon: '🕰️', how: 'Clear the Wild West stage',
    loreText: 'Stopped at 3:47 — the minute the old Delgado table burned. Rosa winds it every morning anyway. "Time doesn\'t heal," she says. "It just deals the next hand."',
  },
];

export default function LoreDemo() {
  const [collected, setCollected] = useState(0); // fragments 0..collected-1 are owned
  const [open, setOpen] = useState<LoreUnlockView | null>(null);

  function unlockNext() {
    if (collected >= SET.length || open) return;
    const f = SET[collected];
    setOpen({
      unlockId: `demo-${collected}`,
      title: f.title, characterName: CHARACTER, loreText: f.loreText, icon: f.icon,
      stageName: 'Wild West',
      progress: { collected: collected + 1, total: SET.length },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="glass p-4 text-[0.75rem] leading-relaxed text-white/60">
        Every stage hides secret collectibles — win the right hand and a
        fragment of that stage's story drops. Each one plays a cinematic
        and fills the character's backstory bar. Trigger the Wild West set:
      </div>

      {/* The set, codex-style: unlocked fragments show themselves; locked
          ones show only the deed that earns them. */}
      <div className="glass flex flex-col gap-2 p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-white/55">
            Wild West Backstory
          </span>
          <span className="font-display text-sm font-black text-neon-gold">
            {collected}/{SET.length} COLLECTED
          </span>
        </div>
        {SET.map((f, i) => (
          <div
            key={f.title}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
              i < collected ? 'bg-neon-gold/10' : 'bg-white/[0.04]'
            }`}
          >
            <span className={`text-xl ${i < collected ? '' : 'opacity-40 grayscale'}`}>
              {i < collected ? f.icon : '🔒'}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[0.78rem] font-bold ${i < collected ? 'text-neon-gold' : 'text-white/45'}`}>
                {i < collected ? f.title : '???'}
              </div>
              <div className="text-[0.65rem] text-white/40">{f.how}</div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={unlockNext}
        disabled={collected >= SET.length}
        className="btn-chunky bg-neon-gold py-3 text-sm text-abyss-900 disabled:opacity-40"
      >
        {collected >= SET.length ? '✦ SET COMPLETE ✦' : `SIMULATE: ${SET[collected].how.toUpperCase()}`}
      </button>

      <CollectibleUnlockModal
        unlock={open}
        onClose={() => { setOpen(null); setCollected(c => Math.min(c + 1, SET.length)); }}
      />
    </div>
  );
}
