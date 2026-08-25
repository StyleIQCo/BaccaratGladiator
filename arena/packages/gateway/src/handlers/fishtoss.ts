// Weekly Fishmonger (Pike Place Fish Toss) — start a run, submit it,
// read the board. Every submit must present a run proof: a single-use
// token issued by ft:run_start, consumed atomically here, whose
// elapsed time must plausibly produce the claimed score. That kills
// devtools submits, replays, and impossible hauls outright. Identity
// (userId/handle/avatarKey) is still client-claimed — same trust level
// as HELLO's fields until Cognito-verified profiles land.
import type { Socket } from 'socket.io';
import {
  SOCIAL_PROTOCOL_VERSION, SocialClientEvent, SocialServerEvent,
  type FishTossGetPayload, type FishTossRunStartPayload, type FishTossSubmitPayload,
} from '@bg/shared';
import {
  currentWeekKey, fishTossSnapshot, submitFishTossScore,
  startFishTossRun, consumeFishTossRun,
} from '@bg/persistence';
import { tryConsume } from '../ratelimit';

const MAX_RUN_SCORE = 100_000; // nothing a legitimate ~30s toss run can exceed
// Peak legit rate is ~1.1k pts/s at the end-of-run spawn cadence
// (500-pt kings at a 0.45s interval) — 1.2k/s of ELAPSED run time is a
// generous ceiling that still caps a forged 2-second submit at 2.4k.
const MAX_PTS_PER_SEC = 1_200;

const idOf = (socket: Socket, claimed?: unknown): string | null => {
  const id = socket.data.userId ?? (typeof claimed === 'string' ? claimed.slice(0, 64) : '');
  return id ? String(id) : null;
};

export function registerFishToss(socket: Socket) {
  socket.on(SocialClientEvent.FT_GET, async (p: FishTossGetPayload) => {
    if (!tryConsume(`ft:get:${socket.id}`, 5, 10_000)) return; // 5 refreshes / 10s
    socket.emit(
      SocialServerEvent.FT_SNAPSHOT,
      await fishTossSnapshot(currentWeekKey(), idOf(socket, p?.meId)),
    );
  });

  socket.on(SocialClientEvent.FT_RUN_START, async (p: FishTossRunStartPayload) => {
    if (!tryConsume(`ft:run:${socket.id}`, 4, 60_000)) return; // one per run; 4/min absorbs retries
    const userId = idOf(socket, p?.meId);
    if (!userId) return;
    const { runId } = await startFishTossRun(userId);
    socket.emit(SocialServerEvent.FT_RUN_TOKEN, { v: SOCIAL_PROTOCOL_VERSION, ts: Date.now(), runId });
  });

  socket.on(SocialClientEvent.FT_SUBMIT, async (p: FishTossSubmitPayload) => {
    if (!tryConsume(`ft:submit:${socket.id}`, 4, 60_000)) return; // a run takes ~30s; 4/min absorbs retries
    const userId = idOf(socket, p?.meId);
    const score = Number(p?.score);
    if (!userId || !Number.isInteger(score) || score <= 0 || score > MAX_RUN_SCORE) return;

    // Run proof: token must exist, be this user's, and be unconsumed —
    // GETDEL makes the claim atomic, so a replay races to nothing. The
    // elapsed check needs ≥1s of real run time (a boot can end a run
    // early, so no minimum beyond that) and caps the score at what the
    // spawner could physically have delivered in that window.
    const run = await consumeFishTossRun(typeof p?.runId === 'string' ? p.runId : '', userId);
    if (!run.ok || run.elapsedMs < 1_000) return;
    if (score > Math.ceil(run.elapsedMs / 1_000) * MAX_PTS_PER_SEC) return;

    const weekKey = currentWeekKey();
    const r = await submitFishTossScore(weekKey, {
      userId,
      handle: typeof p?.handle === 'string' && p.handle ? p.handle.slice(0, 24) : socket.data.name ?? 'Gladiator',
      avatarKey: typeof p?.avatarKey === 'string' ? p.avatarKey.slice(0, 32) : socket.data.avatarKey ?? 'gladiator-01',
    }, score);

    socket.emit(SocialServerEvent.FT_SUBMIT_RESULT, {
      v: SOCIAL_PROTOCOL_VERSION, ts: Date.now(), weekKey,
      submitted: score, best: r.best, improved: r.improved, rank: r.rank,
    });
    // Fresh board rides along so the UI re-renders without a second round-trip.
    socket.emit(SocialServerEvent.FT_SNAPSHOT, await fishTossSnapshot(weekKey, userId));
  });
}
