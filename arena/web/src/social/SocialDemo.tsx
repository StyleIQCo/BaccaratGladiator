// One-stop preview of the social layer. To see it:
//   render <SocialDemo /> from App.tsx — the css import below is all
//   the wiring Tailwind needs (Vite handles it).
import { useState } from 'react';
import './social.css';
import LiveLeaderboard from './LiveLeaderboard';
import DigitalPassport from './DigitalPassport';
import DailyMissions from './DailyMissions';
import BuddyPassModal from './BuddyPassModal';

export default function SocialDemo() {
  const [buddyOpen, setBuddyOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-abyss-900 via-abyss-800 to-abyss-900 p-4 md:p-8">
      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <LiveLeaderboard tier={4} seasonKey="2026-08" meId="me" meHandle="You" />
        </div>
        <div className="space-y-4">
          <DigitalPassport handle="You" tier={4} stageIndex={22} />
          <DailyMissions />
          <button
            onClick={() => setBuddyOpen(true)}
            className="btn-chunky w-full bg-gradient-to-r from-neon-gold to-neon-pink py-3 text-sm text-abyss-900"
          >
            🎟 OPEN BUDDY PASS
          </button>
        </div>
      </div>
      <BuddyPassModal open={buddyOpen} onClose={() => setBuddyOpen(false)} />
    </div>
  );
}
