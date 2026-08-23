// Local re-declaration of the wire shapes used by the mocked hook, so
// the social components compile standalone. When wiring the real
// gateway, delete this file and import from '@bg/shared' instead —
// the shapes are identical to packages/shared/src/social.ts.

export interface LeaderboardRankChangePayload {
  v: number;
  seasonKey: string;
  tier: number;
  ts: number;
  user: { userId: string; handle: string; avatarKey: string };
  score: number;
  delta: number;
  from: number | null;
  to: number;
  displaced: Array<{ userId: string; from: number; to: number }>;
}
