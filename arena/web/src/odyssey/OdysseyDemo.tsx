// ═══════════════════════════════════════════════════════════════════
//  ODYSSEY DEMO — tester rig for the referral-only Aegean stage.
//  Mock-driven like the rest of DemoHub: the rig pokes the fake VIP
//  profile (localStorage) to flip the gate, and force-fires the
//  Trojan Horse win so testers can see the burst without playing a
//  shoe. The gate's CTA opens the real Hongbao referral modal — same
//  artifact the live referral flow uses.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useState } from 'react';
import HongbaoReferralModal from '../social/HongbaoReferralModal';
import AegeanTable from './AegeanTable';
import TrojanHorseBet from './TrojanHorseBet';
import VIPGate from './VIPGate';
import { useVIPAccess, writeMockVIPProfile } from './useVIPAccess';

export default function OdysseyDemo() {
  const { hasAccess, profile } = useVIPAccess();
  const [hongbaoOpen, setHongbaoOpen] = useState(false);
  const [trojanWon, setTrojanWon] = useState(false);

  // Stable ref so a mid-celebration re-render can't reset the timers.
  const endCelebration = useCallback(() => setTrojanWon(false), []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      {/* Demo rig — simulate referral-profile states */}
      <div className="glass flex flex-wrap items-center gap-2 p-3">
        <span className="text-[0.55rem] tracking-[0.3em] text-white/40">DEMO RIG</span>
        <button
          className="btn-chunky bg-white/[0.07] px-3 py-1.5 text-[0.6rem] text-white/70"
          onClick={() => writeMockVIPProfile({ ...profile, successfulReferrals: profile.successfulReferrals + 1 })}
        >
          +1 SUCCESSFUL REFERRAL
        </button>
        <button
          className="btn-chunky bg-white/[0.07] px-3 py-1.5 text-[0.6rem] text-white/70"
          onClick={() => writeMockVIPProfile({ ...profile, signedUpWithReferral: true })}
        >
          JOINED VIA CODE
        </button>
        <button
          className="btn-chunky bg-white/[0.07] px-3 py-1.5 text-[0.6rem] text-white/70"
          onClick={() => writeMockVIPProfile({ successfulReferrals: 0, signedUpWithReferral: false })}
        >
          RESET · LOCK
        </button>
        {hasAccess && (
          <button
            className="btn-chunky bg-neon-gold px-3 py-1.5 text-[0.6rem] text-abyss-900"
            onClick={() => setTrojanWon(true)}
          >
            🐴 FORCE TROJAN WIN
          </button>
        )}
      </div>

      <VIPGate onReferFriend={() => setHongbaoOpen(true)}>
        <AegeanTable>
          <TrojanHorseBet won={trojanWon} onCelebrationEnd={endCelebration} />
        </AegeanTable>
      </VIPGate>

      <HongbaoReferralModal open={hongbaoOpen} onClose={() => setHongbaoOpen(false)} />
    </div>
  );
}
