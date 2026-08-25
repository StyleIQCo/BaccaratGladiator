// ═══════════════════════════════════════════════════════════════════
//  ODYSSEY DEMO — two tester rigs behind one tab:
//
//  · CAMPAIGN VOYAGE (default): the limited-time 10-stage campaign
//    from the repo-root odyssey/ module. Map → cutscene ("SET SAIL")
//    → Aegean trial table. "WIN TRIAL" is the demo rig — it saves
//    campaign progress (namespaced odyssey localStorage, never the
//    classic save) and sails back to the map; "RESET VOYAGE" wipes it.
//  · AEGEAN VIP TABLE: the referral-only stage rig. Pokes the fake
//    VIP profile (localStorage) to flip the gate and force-fires the
//    Trojan Horse win. The gate's CTA opens the real Hongbao referral
//    modal — same artifact the live referral flow uses.
//
//  Mock-driven like the rest of DemoHub: no sockets, no backend.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useState } from 'react';
import HongbaoReferralModal from '../social/HongbaoReferralModal';
import AegeanTable from './AegeanTable';
import TrojanHorseBet from './TrojanHorseBet';
import VIPGate from './VIPGate';
import { useVIPAccess, writeMockVIPProfile } from './useVIPAccess';
import { OdysseyCampaignFlow } from '../../../../odyssey/src/components/OdysseyCampaignFlow';
import {
  DEFAULT_ODYSSEY_PROGRESS,
  loadOdysseyProgress,
  saveOdysseyProgress,
  type OdysseyStage,
} from '../../../../odyssey/src/data/odysseyStoryData';

type OdysseyView = 'campaign' | 'aegean';

export default function OdysseyDemo() {
  const [view, setView] = useState<OdysseyView>('campaign');

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <div className="flex gap-2">
        {(
          [
            ['campaign', '🗺 CAMPAIGN VOYAGE'],
            ['aegean', '🏛 AEGEAN VIP TABLE'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`btn-chunky flex-1 py-2 text-[0.65rem] ${
              view === id ? 'bg-neon-blue text-abyss-900' : 'bg-white/[0.07] text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'campaign' ? <CampaignRig /> : <AegeanRig />}
    </div>
  );
}

// ── CAMPAIGN VOYAGE — map → cutscene → trial table loop ─────────────
function CampaignRig() {
  const [activeStage, setActiveStage] = useState<OdysseyStage | null>(null);
  // Bumped by RESET VOYAGE so the mounted flow remounts and re-reads the save.
  const [epoch, setEpoch] = useState(0);

  // Demo rig for "the host owns the table + saving progress on victory":
  // record the cleared stage (and relic) in the namespaced odyssey save,
  // then return to the map — the flow remounts and re-reads the save.
  const winTrial = useCallback(() => {
    if (!activeStage) return;
    const prev = loadOdysseyProgress();
    saveOdysseyProgress({
      activeCampaign: 'ODYSSEY',
      highestClearedStage: Math.max(prev.highestClearedStage, activeStage.id),
      relics:
        activeStage.reward.relic && !prev.relics.includes(activeStage.reward.relic)
          ? [...prev.relics, activeStage.reward.relic]
          : prev.relics,
    });
    setActiveStage(null);
  }, [activeStage]);

  const abandonTrial = useCallback(() => setActiveStage(null), []);

  if (activeStage) {
    return (
      <div className="flex flex-col gap-3">
        <div className="glass flex flex-wrap items-center gap-2 p-3">
          <span className="text-[0.55rem] tracking-[0.3em] text-white/40">
            TRIAL {activeStage.id} · {activeStage.title.toUpperCase()}
          </span>
          <span className="basis-full text-[0.6rem] text-white/60">{activeStage.objective}</span>
          <button
            className="btn-chunky bg-neon-gold px-3 py-1.5 text-[0.6rem] text-abyss-900"
            onClick={winTrial}
          >
            ⚡ WIN TRIAL (DEMO)
          </button>
          <button
            className="btn-chunky bg-white/[0.07] px-3 py-1.5 text-[0.6rem] text-white/70"
            onClick={abandonTrial}
          >
            ⟵ VOYAGE MAP
          </button>
        </div>
        <AegeanTable />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="glass flex flex-wrap items-center gap-2 p-3">
        <span className="text-[0.55rem] tracking-[0.3em] text-white/40">DEMO RIG</span>
        <button
          className="btn-chunky bg-white/[0.07] px-3 py-1.5 text-[0.6rem] text-white/70"
          onClick={() => {
            saveOdysseyProgress(DEFAULT_ODYSSEY_PROGRESS);
            setEpoch((e) => e + 1);
          }}
        >
          RESET VOYAGE
        </button>
        <span className="text-[0.6rem] text-white/50">
          Tap the glowing port to set sail; bosses at 2 · 5 · 10.
        </span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <OdysseyCampaignFlow key={epoch} onEnterTable={setActiveStage} />
      </div>
    </div>
  );
}

// ── AEGEAN VIP TABLE — the original referral-gate rig, unchanged ────
function AegeanRig() {
  const { hasAccess, profile } = useVIPAccess();
  const [hongbaoOpen, setHongbaoOpen] = useState(false);
  const [trojanWon, setTrojanWon] = useState(false);

  // Stable ref so a mid-celebration re-render can't reset the timers.
  const endCelebration = useCallback(() => setTrojanWon(false), []);

  return (
    <div className="flex flex-col gap-3">
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
