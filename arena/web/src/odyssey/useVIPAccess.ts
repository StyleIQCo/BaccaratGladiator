// ═══════════════════════════════════════════════════════════════════
//  useVIPAccess — gatekeeper logic for the referral-only ODYSSEY
//  stage. Pure state, no JSX: the visual half (blurred stage, glowing
//  lock, "board the ship" CTA) lives in VIPGate.tsx, which consumes
//  this hook. Keeping them apart means the same access check can gate
//  a route, a nav badge, or a push-notification opt-in later.
//
//  Boarding rule — either side of the referral graph gets a berth:
//   · successfulReferrals >= 1  — you brought a shipmate (mirrors
//     User.referralsSent rows with status COMPLETED), or
//   · signedUpWithReferral      — you ARE the shipmate
//     (Referral.refereeId is @unique: set once per account, ever).
//
//  Demo mode has no gateway, so the profile lives in localStorage and
//  the OdysseyDemo rig pokes it via writeMockVIPProfile. When the real
//  gateway lands, pass the session's profile slice as the override (or
//  swap the storage shim for it) — the VIPAccess return shape is the
//  contract and shouldn't change.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';

export interface VIPProfile {
  successfulReferrals: number;
  signedUpWithReferral: boolean;
}

export type VIPAccessReason =
  | 'referrer' // earned passage: ≥1 completed referral
  | 'referee'  // gifted passage: joined with a friend's code
  | 'locked';

export interface VIPAccess {
  hasAccess: boolean;
  /** Why the gate opened (or didn't) — gate copy varies on this. */
  reason: VIPAccessReason;
  profile: VIPProfile;
}

const STORAGE_KEY = 'bg.odyssey.vip';
const PROFILE_EVENT = 'bg:vip-profile-changed';
const LOCKED_PROFILE: VIPProfile = { successfulReferrals: 0, signedUpWithReferral: false };

export function readMockVIPProfile(): VIPProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return LOCKED_PROFILE;
    const parsed = JSON.parse(raw) as Partial<VIPProfile>;
    return {
      successfulReferrals: Number(parsed.successfulReferrals) || 0,
      signedUpWithReferral: Boolean(parsed.signedUpWithReferral),
    };
  } catch {
    return LOCKED_PROFILE; // private mode / corrupt value — fail closed
  }
}

export function writeMockVIPProfile(profile: VIPProfile): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* private mode */ }
  // 'storage' events never fire in the tab that wrote — nudge ourselves.
  window.dispatchEvent(new Event(PROFILE_EVENT));
}

export function useVIPAccess(profileOverride?: VIPProfile): VIPAccess {
  const [stored, setStored] = useState<VIPProfile>(readMockVIPProfile);

  useEffect(() => {
    const sync = () => setStored(readMockVIPProfile());
    window.addEventListener(PROFILE_EVENT, sync);
    window.addEventListener('storage', sync); // cross-tab
    return () => {
      window.removeEventListener(PROFILE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const profile = profileOverride ?? stored;
  const reason: VIPAccessReason =
    profile.successfulReferrals >= 1 ? 'referrer'
    : profile.signedUpWithReferral ? 'referee'
    : 'locked';

  return { hasAccess: reason !== 'locked', reason, profile };
}
