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
  FT_SNAPSHOT           = 'ft:snapshot',     // weekly fish-toss board: top-10 + your row
  FT_SUBMIT_RESULT      = 'ft:submit_result',// ack for ft:submit — weekly best + rank after the run
  FT_RUN_TOKEN          = 'ft:run_token',    // single-use run proof issued by ft:run_start
}

export enum SocialClientEvent {
  LB_SUBSCRIBE   = 'lb:subscribe',   // { seasonKey, tier } → LB_SNAPSHOT reply
  LB_UNSUBSCRIBE = 'lb:unsubscribe',
  MISSION_CLAIM  = 'mission:claim',  // { missionProgressId } — server validates, exactly-once
  PASS_CREATE    = 'pass:create',    // → { code, url }
  LORE_SEEN      = 'lore:seen',      // { unlockId } — acks the unlock cinematic, exactly-once
  FT_GET         = 'ft:get',         // { meId? } → FT_SNAPSHOT reply
  FT_RUN_START   = 'ft:run_start',   // { meId? } → FT_RUN_TOKEN; call when a run begins
  FT_SUBMIT      = 'ft:submit',      // { score, runId, ... } → FT_SUBMIT_RESULT + fresh FT_SNAPSHOT
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

// ── FISH TOSS: WEEKLY FISHMONGER (arcade mini-game) ────────────────
// Snapshot-on-request only — no delta stream. The board is weekly and
// low-churn; clients re-emit FT_GET to refresh (same heal-by-snapshot
// stance as the tier leaderboard, minus the deltas).

export interface FishTossEntry {
  userId: string;
  handle: string;
  avatarKey: string;
  score: number;      // highest single run this week
  rank: number;       // 1-based
}

export interface FishTossSnapshotPayload {
  v: number;                // SOCIAL_PROTOCOL_VERSION
  weekKey: string;          // ISO week, UTC — '2026-W35'
  ts: number;
  endsAt: number;           // epoch ms the board locks (Mon 00:00 UTC) — drives the countdown
  top: FishTossEntry[];     // top N (server-capped, default 10)
  me: FishTossEntry | null; // requester's row even outside top N; null = hasn't tossed yet
  totalPlayers: number;
  prizes: number[];         // chip ladder, index = rank-1 — server-authoritative for the UI
}

export interface FishTossGetPayload {
  meId?: string; // client-claimed until Cognito-verified profiles land (see gateway HELLO)
}

export interface FishTossRunStartPayload {
  meId?: string; // client-claimed until Cognito-verified profiles land
}

/** Single-use run proof. Request one at run start; it rides the submit. */
export interface FishTossRunTokenPayload {
  v: number;
  ts: number;
  runId: string;
}

export interface FishTossSubmitPayload {
  score: number;
  /** Run proof from FT_RUN_TOKEN — the submit is rejected without a live,
   *  owned, unconsumed token whose elapsed time can plausibly produce
   *  `score`. */
  runId?: string;
  // Client-claimed identity/profile — same trust level as HELLO's fields.
  meId?: string;
  handle?: string;
  avatarKey?: string;
}

export interface FishTossSubmitResultPayload {
  v: number;
  ts: number;
  weekKey: string;
  submitted: number;
  best: number;      // weekly best after this run
  improved: boolean; // this run set a new weekly best
  rank: number;      // 1-based rank after this run
}
