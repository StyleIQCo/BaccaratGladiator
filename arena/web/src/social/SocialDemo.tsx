// One-stop preview of the social layer. To see it:
//   render <SocialDemo /> from App.tsx — the css import below is all
//   the wiring Tailwind needs (Vite handles it).
import { useState } from 'react';
import './social.css';
import LiveLeaderboard from './LiveLeaderboard';
import DigitalPassport from './DigitalPassport';
import DailyMissions from './DailyMissions';
import BuddyPassModal from './BuddyPassModal';
import HongbaoReferralModal from './HongbaoReferralModal';
import { LocaleProvider, useLocale } from '../i18n/LocaleContext';

/** Proof strip for the outcome-token flip: the same `win`/`loss`
 *  utilities render green/red in EN and red/green in 中文 — no
 *  component re-renders, the swap is pure CSS on <html>. */
function OutcomeLegend() {
  const { isZh, setLocale } = useLocale();
  return (
    <div className="glass flex items-center justify-between px-4 py-3 text-sm">
      <span className="font-display font-black text-win">▲ WIN 赢</span>
      <span className="font-display font-black text-loss">▼ LOSS 输</span>
      <button
        onClick={() => setLocale(isZh ? 'en' : 'zh')}
        className="btn-chunky bg-neon-blue px-3 py-1.5 text-xs text-abyss-900"
      >
        {isZh ? '中文 → EN' : 'EN → 中文'}
      </button>
    </div>
  );
}

function DemoInner() {
  const [buddyOpen, setBuddyOpen] = useState(false);
  const [hongbaoOpen, setHongbaoOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-abyss-900 via-abyss-800 to-abyss-900 p-4 md:p-8">
      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <OutcomeLegend />
          <LiveLeaderboard tier={4} seasonKey="2026-08" meId="me" meHandle="You" />
        </div>
        <div className="space-y-4">
          <DigitalPassport handle="You" tier={4} stageIndex={22} />
          <DailyMissions />
          <button
            onClick={() => setHongbaoOpen(true)}
            className="btn-chunky w-full bg-gradient-to-r from-[#e02430] to-[#7a1016] py-3 text-sm text-neon-gold"
          >
            🧧 SEND A HONGBAO 送福
          </button>
          <button
            onClick={() => setBuddyOpen(true)}
            className="btn-chunky w-full bg-gradient-to-r from-neon-gold to-neon-pink py-3 text-sm text-abyss-900"
          >
            🎟 OPEN BUDDY PASS
          </button>
        </div>
      </div>
      <BuddyPassModal open={buddyOpen} onClose={() => setBuddyOpen(false)} />
      <HongbaoReferralModal open={hongbaoOpen} onClose={() => setHongbaoOpen(false)} />
    </div>
  );
}

export default function SocialDemo() {
  return (
    <LocaleProvider>
      <DemoInner />
    </LocaleProvider>
  );
}
