// ═══════════════════════════════════════════════════════════════════
//  DEMO HUB — the tester-facing preview of the Grand Arena feature
//  set while the live backend is not yet hosted. Enabled by
//  `demoMode: true` in config/flags.json (the same no-store kill-
//  switch file, so it can be flipped off without a build).
//  Every feature here is mock-driven: no sockets, no backend.
// ═══════════════════════════════════════════════════════════════════
import { useState } from 'react';
import './social/social.css';
import SocialDemo from './social/SocialDemo';
import BossBattle from './battle/BossBattle';
import { BOSSES } from './battle/bosses';
import SpectateMode from './spectate/SpectateMode';
import { ClutchDemo } from './replay/ClutchReplayModal';
import { MockingbirdDemo } from './stage/MockingbirdTable';
import OdysseyDemo from './odyssey/OdysseyDemo';
import LoreDemo from './collectibles/LoreDemo';

type Tab = 'social' | 'battle' | 'spectate' | 'clutch' | 'mockingbird' | 'odyssey' | 'lore';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'social',      label: '🏆 SOCIAL' },
  { id: 'battle',      label: '⚔️ BOSS BATTLE' },
  { id: 'spectate',    label: '👁 SPECTATE' },
  { id: 'clutch',      label: '🎬 CLUTCH REPLAY' },
  { id: 'mockingbird', label: '🤠 MOCKINGBIRD' },
  { id: 'odyssey',     label: '🏛 ODYSSEY' },
  { id: 'lore',        label: '📜 LORE' },
];

export default function DemoHub() {
  const [tab, setTab] = useState<Tab>('social');
  const [bossId, setBossId] = useState<'emperor' | 'neonDragon'>('emperor');

  return (
    <div className="min-h-screen bg-gradient-to-b from-abyss-900 via-abyss-800 to-abyss-900 pb-10 text-white">
      <header className="mx-auto max-w-5xl px-4 pt-6 text-center">
        <div className="font-display text-2xl font-black tracking-widest text-neon-gold">
          ⚔ GRAND ARENA
        </div>
        <div className="mt-1 text-[0.7rem] tracking-[0.3em] text-white/45">
          FEATURE PREVIEW · GAMEPLAY IS SIMULATED · NO REAL-MONEY PLAY
        </div>
        <nav className="mt-4 flex flex-wrap justify-center gap-2">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`btn-chunky px-4 py-2 text-[0.7rem] ${
                tab === t.id
                  ? 'bg-gradient-to-r from-neon-gold to-neon-pink text-abyss-900'
                  : 'bg-white/[0.07] text-white/70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto mt-6 max-w-5xl px-4">
        {/* Tabs mount-on-select so mock timers only run while visible */}
        {tab === 'social' && <SocialDemo />}

        {tab === 'battle' && (
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <div className="flex gap-2">
              {(['emperor', 'neonDragon'] as const).map(id => (
                <button
                  key={id}
                  onClick={() => setBossId(id)}
                  className={`btn-chunky flex-1 py-2 text-[0.65rem] ${
                    bossId === id ? 'bg-neon-blue text-abyss-900' : 'bg-white/[0.07] text-white/70'
                  }`}
                >
                  {BOSSES[id].emoji} {BOSSES[id].name.toUpperCase()} · S{BOSSES[id].stage}
                </button>
              ))}
            </div>
            <BossBattle key={bossId} boss={BOSSES[bossId]} />
          </div>
        )}

        {tab === 'spectate' && (
          <div className="mx-auto max-w-md"><SpectateMode /></div>
        )}

        {tab === 'mockingbird' && (
          <div className="mx-auto max-w-xl"><MockingbirdDemo /></div>
        )}

        {tab === 'odyssey' && <OdysseyDemo />}

        {tab === 'lore' && (
          <div className="mx-auto max-w-md"><LoreDemo /></div>
        )}

        {tab === 'clutch' && (
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <div className="glass p-4 text-[0.75rem] leading-relaxed text-white/60">
              When you win big on a third-card draw, the game cuts a vertical
              instant replay and hands you a share-ready clip. Simulate one:
            </div>
            <ClutchDemo />
          </div>
        )}
      </main>
    </div>
  );
}
