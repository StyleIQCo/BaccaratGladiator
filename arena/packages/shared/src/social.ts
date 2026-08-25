// ═══════════════════════════════════════════════════════════════════
//  SOCIAL LAYER — WIRE CONTRACT
//  Same rules as protocol.ts: imported by both server and client;
//  changing a field is a breaking change — bump SOCIAL_PROTOCOL_VERSION
//  and gate on it in the handshake.
//
//  Room model: on hello, the gateway joins the socket to its bracket
//  room `lb:{seasonKey}:t{tier}`. All leaderboard traffic is
//  room-scoped — a tier-4 client never receives tier-9 churn.
//
//  Delivery model: snapshot + deltas. Clients render LB_SNAPSHOT, then
//  apply LB_RANK_CHANGE / LB_SCORE_TICK deltas ordered by `ts`. A gap
//  (missed delta / reconnect) is healed by re-requesting LB_SUBSCRIBE,
//  which replies with a fresh snapshot. Deltas are cheap; snapshots
//  are the recovery path — never diff on the client.
// ═══════════════════════════════════════════════════════════════════

export const SOCIAL_PROTOCOL_VERSION = 1;

export enum SocialServerEvent {
  LB_SNAPSHOT           = 'lb:snapshot',     // full top-N + your row, on subscribe/resync
  LEADERBOARD_RANK_CHANGE = 'lb:rank_change', // a row moved — the theatrical event
  LB_SCORE_TICK         = 'lb:score',        // score changed, rank did NOT (cheap, high-freq)
  MISSION_PROGRESS      = 'mission:progress',
  MISSION_COMPLETE      = 'mission:complete',
  REFERRAL_QUALIFIED    = 'referral:qualified',
  PASSPORT_STAMP        = 'passport:stamp',  // stage cleared → new stamp earned
  LORE_UNLOCK           = 'lore:unlock',     // secret collectible earned → play the cinematic
}

export enum SocialClientEvent {
  LB_SUBSCRIBE   = 'lb:subscribe',   // { seasonKey, tier } → LB_SNAPSHOT reply
  LB_UNSUBSCRIBE = 'lb:unsubscribe',
  MISSION_CLAIM  = 'mission:claim',  // { missionProgressId } — server validates, exactly-once
  PASS_CREATE    = 'pass:create',    // → { code, url }
  LORE_SEEN      = 'lore:seen',      // { unlockId } — acks the unlock cinematic, exactly-once
}

// ── SHARED SHAPES ──────────────────────────────────────────────────

export interface LeaderboardEntry {
  userId: string;
  handle: string;
  avatarKey: string;
  score: number;
  rank: number;       // 1-based within the tier bracket
  bestStreak: number;
}

// ── ServerEvent payloads ───────────────────────────────────────────

export interface LeaderboardSnapshotPayload {
  v: number;                 // SOCIAL_PROTOCOL_VERSION
  seasonKey: string;         // '2026-08'
  tier: number;              // 1..10 bracket
  ts: number;                // server epoch ms — ordering + drift baseline
  top: LeaderboardEntry[];   // top N (server-capped, default 10)
  me: LeaderboardEntry | null; // requesting user's row even when outside top N
  totalPlayers: number;      // bracket population, for "#87 of 1,204"
}

/**
 * THE theatrical event. Emitted only when a score write actually moved
 * someone's rank (old ZREVRANK ≠ new ZREVRANK, computed atomically in a
 * Lua script alongside the ZINCRBY so two gateways can never disagree).
 */
export interface LeaderboardRankChangePayload {
  v: number;                 // SOCIAL_PROTOCOL_VERSION
  seasonKey: string;
  tier: number;
  ts: number;                // server epoch ms — client applies deltas in ts order
  user: {
    userId: string;
    handle: string;
    avatarKey: string;
  };
  score: number;             // new authoritative total (absolute, not a diff)
  delta: number;             // score gained this event — drives the "+2,450" pop
  from: number | null;       // previous rank; null = new entrant to the bracket
  to: number;                // new rank (1-based). to < from  ⇒  RANK UP theatrics
  /**
   * Rows shifted as a side effect (the people glided past). Kept minimal —
   * clients already hold handle/score for these rows from the snapshot.
   */
  displaced: Array<{ userId: string; from: number; to: number }>;
}

export interface LeaderboardScoreTickPayload {
  v: number;
  seasonKey: string;
  tier: number;
  ts: number;
  userId: string;
  score: number;             // absolute new score, rank unchanged
  delta: number;
}

export interface MissionProgressPayload {
  v: number;
  ts: number;
  missionProgressId: string;
  slug: string;
  progress: number;          // absolute
  target: number;
  completed: boolean;        // true exactly once, on the crossing event
}

export interface ReferralQualifiedPayload {
  v: number;
  ts: number;
  referralId: string;
  refereeHandle: string;
  rewardChips: number;
  rewardGems: number;
}

export interface PassportStampPayload {
  v: number;
  ts: number;
  stageSlug: string;
  tier: number;
  stampNumber: number;       // 1..62 — "Stamp 23 of 62"
}

/** One unlocked lore collectible — the unlock cinematic's data. */
export interface LoreUnlockItem {
  unlockId: string;          // UserCollectible.id — the LORE_SEEN ack handle
  slug: string;              // 'lone-star-sheriffs-badge'
  title: string;             // "Lone Star Sheriff's Badge"
  characterName: string;     // "Sheriff Rosa 'Lone Star' Delgado"
  loreText: string;          // the backstory fragment
  icon: string;              // emoji relic for the drift-in object
  stageSlug: string;         // themes-extended.js slug the item belongs to
  tier: number;
  progress: { collected: number; total: number }; // this character's set
}

export interface LoreUnlockPayload {
  v: number;                 // SOCIAL_PROTOCOL_VERSION
  ts: number;
  unlocks: LoreUnlockItem[]; // ≥1 — the client plays them one at a time
}

// ── ClientEvent payloads ───────────────────────────────────────────

export interface LeaderboardSubscribePayload {
  seasonKey: string;
  tier: number;
}

export interface MissionClaimPayload {
  missionProgressId: string;
}

export interface LoreSeenPayload {
  unlockId: string;
}
