#!/usr/bin/env node
// Weekly Fishmonger (Pike Place Fish Toss) E2E — exercises the whole
// stack against real local infra:
//   1. store: ZADD GT keep-highest semantics, snapshot shape, me-row
//   2. Postgres mirror: FishmongerScore rows land fire-and-forget
//   3. payout: exactly-once week settle, prize ladder, ledger receipts
//   4. sweep: targets the most recently completed ISO week
//   5. gateway: HELLO → ft:submit → ft:get over a real websocket
//
// Prereq: docker compose up -d redis postgres   (+ migrations applied:
//         npm -w packages/persistence run db:migrate)
// Usage:  DATABASE_URL=postgres://bg:bg@localhost:5432/social \
//           node_modules/.bin/tsx test-fishtoss-e2e.js
//
// All test data is namespaced by a unique run key and cleaned up at the
// end (including the welcome credit the WS user earns from HELLO).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import {
  submitFishTossScore, fishTossSnapshot, payoutFishmongerWeek, sweepFishmongerPayout,
  FT_PRIZES, weekKeyOf, currentWeekKey, weekEndMs,
  data, pub, sub, prisma, hasDb,
} from '@bg/persistence';
import {
  ClientEvent, ServerEvent, SocialClientEvent, SocialServerEvent, PROTOCOL_VERSION,
} from '@bg/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const GW_PORT = Number(process.env.GW_PORT) || 8123;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

/** Fire-and-forget mirrors land "soon" — poll instead of trusting one
 *  fixed sleep (a cold Prisma client can eat 600ms on first connect). */
const eventually = async (fn, tries = 12, gapMs = 300) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await sleep(gapMs);
  }
  return false;
};

if (!hasDb()) {
  console.error('DATABASE_URL is required (postgres://bg:bg@localhost:5432/social for the compose stack)');
  process.exit(1);
}

const WK = `e2e-${Date.now().toString(36)}`;   // synthetic week — never collides with real boards
const db = prisma();
const users = [];                               // PG user ids, index 0 = the #11 straggler
let gw = null, sock = null;
const lastWk = weekKeyOf(new Date(Date.now() - 7 * 86_400_000));
let lastWkHadLock = false;
const wsUser = `e2e-ws-${WK}`;

try {
  // ── 1. week math ─────────────────────────────────────────────────
  console.log('\n[1] week math');
  ok(/^\d{4}-W\d{2}$/.test(currentWeekKey()), `currentWeekKey format (${currentWeekKey()})`);
  ok(weekKeyOf(new Date('2026-08-30T23:59:00Z')) === '2026-W35', 'Sunday 23:59 stays in its week');
  ok(weekKeyOf(new Date('2026-08-31T00:00:00Z')) === '2026-W36', 'Monday 00:00 rolls to the next week');
  ok(weekKeyOf(new Date('2025-12-29T12:00:00Z')) === '2026-W01', 'ISO year boundary (2025-12-29 → 2026-W01)');
  ok(weekEndMs(new Date('2026-08-25T12:00:00Z')) === Date.UTC(2026, 7, 31), 'weekEnd = next Monday 00:00 UTC');

  // ── 2. store: keep-highest + snapshot ────────────────────────────
  console.log('\n[2] store semantics');
  for (let i = 1; i <= 11; i++) {
    const u = await db.user.create({ data: { handle: `e2e-monger-${WK}-${i}` } });
    users.push(u.id);
  }
  const prof = (i, handle) => ({ userId: users[i], handle, avatarKey: 'gladiator-01' });

  const r1 = await submitFishTossScore(WK, prof(0, 'Toss Boss'), 100);
  ok(r1.improved && r1.best === 100, 'first run recorded (100)');
  const r2 = await submitFishTossScore(WK, prof(0, 'Toss Boss'), 50);
  ok(!r2.improved && r2.best === 100, 'lower run does NOT overwrite (GT semantics)');
  const r3 = await submitFishTossScore(WK, prof(0, 'Toss Boss'), 777);
  ok(r3.improved && r3.best === 777, 'higher run replaces the best (777)');

  for (let i = 1; i <= 10; i++) await submitFishTossScore(WK, prof(i, `Monger ${i}`), 1000 * (i + 1));

  const snap = await fishTossSnapshot(WK, users[0]);
  ok(snap.top.length === 10, 'snapshot caps at top 10');
  ok(snap.top[0].userId === users[10] && snap.top[0].score === 11_000 && snap.top[0].rank === 1, 'rank 1 is the highest run');
  ok(snap.top[9].score === 2000, 'bubble (#10) is the 10th-best score');
  ok(snap.me?.rank === 11 && snap.me?.score === 777, 'me-row pins outside the top 10');
  ok(snap.totalPlayers === 11, 'totalPlayers counts the whole board');
  ok(snap.prizes.length === 10 && snap.prizes[0] === 50_000, 'prize ladder rides the snapshot');
  ok(snap.endsAt > Date.now(), 'endsAt is in the future');

  // ── 3. durable mirror ────────────────────────────────────────────
  console.log('\n[3] postgres mirror');
  await eventually(async () => (await db.fishmongerScore.count({ where: { weekKey: WK } })) === 11);
  const rows = await db.fishmongerScore.findMany({ where: { weekKey: WK } });
  ok(rows.length === 11, 'one FishmongerScore row per player');
  ok(rows.find(r => r.userId === users[0])?.score === 777, 'mirror kept the highest run only');

  // ── 4. payout: exactly-once + receipts ───────────────────────────
  console.log('\n[4] weekly payout');
  const p1 = await payoutFishmongerWeek(WK);
  const LADDER_TOTAL = FT_PRIZES.reduce((a, b) => a + b, 0); // 120,000
  ok(p1.paid && p1.winners === 10 && p1.totalPaid === LADDER_TOTAL, `pays 10 winners, ${LADDER_TOTAL} chips total`);
  ok(Number(await data.get(`bal:${users[10]}`)) === 50_000, 'rank 1 credited 50K');
  ok(Number(await data.get(`bal:${users[9]}`)) === 25_000, 'rank 2 credited 25K');
  ok(Number(await data.get(`bal:${users[7]}`)) === 5_000, 'rank 4 credited 5K (consolation tier)');
  ok(await data.get(`bal:${users[0]}`) === null, 'rank 11 gets nothing');
  const p2 = await payoutFishmongerWeek(WK);
  ok(!p2.paid, 'replaying the payout is a no-op (NX lock)');

  await eventually(async () =>
    (await db.chipTransaction.count({ where: { idemKey: { startsWith: `ft:${WK}:` } } })) === 10);
  const payoutRow = await db.fishmongerPayout.findUnique({ where: { weekKey: WK } });
  ok(payoutRow?.winners === 10 && payoutRow?.totalPaid === BigInt(LADDER_TOTAL), 'FishmongerPayout receipt row');
  const txns = await db.chipTransaction.findMany({ where: { idemKey: { startsWith: `ft:${WK}:` } } });
  ok(txns.length === 10, 'one ChipTransaction receipt per winner');
  const t1 = txns.find(t => t.userId === users[10]);
  ok(t1?.amount === 50_000n && t1?.reason === 'MINIGAME_PAYOUT' && t1?.balanceAfter === 50_000n, 'rank-1 receipt: amount, reason, balanceAfter');
  ok(t1?.meta?.rank === 1 && t1?.meta?.game === 'fish-toss', 'receipt meta carries rank + game');

  // ── 5. sweep targeting ───────────────────────────────────────────
  console.log('\n[5] sweep');
  lastWkHadLock = (await data.exists(`ft:paid:${lastWk}`)) === 1;
  await sweepFishmongerPayout();
  ok((await data.exists(`ft:paid:${lastWk}`)) === 1, `sweep settles the most recently completed week (${lastWk})`);

  // ── 6. gateway over a real websocket ─────────────────────────────
  console.log('\n[6] gateway ws');
  gw = spawn(join(HERE, 'node_modules', '.bin', 'tsx'), ['packages/gateway/src/server.ts'], {
    cwd: HERE,
    env: { ...process.env, PORT: String(GW_PORT), REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('gateway boot timeout')), 30_000);
    gw.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(to); res(); } });
    gw.on('exit', c => rej(new Error(`gateway exited early (${c})`)));
  });

  sock = io(`http://localhost:${GW_PORT}`, { path: '/arena/ws', transports: ['websocket'] });
  const once = ev => new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), 10_000);
    sock.once(ev, p => { clearTimeout(to); res(p); });
  });
  await new Promise(res => sock.on('connect', res));

  sock.emit(ClientEvent.HELLO, {
    protocolVersion: PROTOCOL_VERSION, clientSeed: 'e2e',
    userId: wsUser, name: 'Dock Hand', tier: 1, avatarKey: 'gladiator-01',
  });
  const balEv = await once(ServerEvent.BALANCE);
  ok(balEv.balance === 1000, 'HELLO welcome credit');

  /** Fire an event and confirm the server stays SILENT (rejected submit). */
  const notSeen = (ev, ms, fire) => new Promise(res => {
    let got = false;
    const h = () => { got = true; };
    sock.once(ev, h);
    fire();
    setTimeout(() => { sock.off(ev, h); res(!got); }, ms);
  });

  ok(
    await notSeen(SocialServerEvent.FT_SUBMIT_RESULT, 700, () =>
      sock.emit(SocialClientEvent.FT_SUBMIT, { score: 1150 })),
    'submit WITHOUT a run token is silently dropped',
  );

  // The real flow: run proof → ≥1s of run time → submit.
  const tokenP = once(SocialServerEvent.FT_RUN_TOKEN);
  sock.emit(SocialClientEvent.FT_RUN_START, {});
  const token = await tokenP;
  ok(typeof token.runId === 'string' && token.runId.length >= 32, 'ft:run_start issues a run token');
  await sleep(1200); // the elapsed gate needs ≥1s of real run time

  const resultP = once(SocialServerEvent.FT_SUBMIT_RESULT);
  const snapP = once(SocialServerEvent.FT_SNAPSHOT);
  sock.emit(SocialClientEvent.FT_SUBMIT, { score: 1150, runId: token.runId });
  const result = await resultP;
  ok(result.best === 1150 && result.improved === true && result.weekKey === currentWeekKey(), 'proven submit → result with weekly best');
  const wsSnap = await snapP;
  ok(wsSnap.me?.userId === wsUser && wsSnap.me?.score === 1150, 'fresh snapshot rides along with me-row');

  ok(
    await notSeen(SocialServerEvent.FT_SUBMIT_RESULT, 700, () =>
      sock.emit(SocialClientEvent.FT_SUBMIT, { score: 2000, runId: token.runId })),
    'replaying a consumed run token is rejected',
  );

  // A fresh token can't launder an impossible haul: ~1.2s elapsed caps
  // a legit score at ceil(1.2)·1200 = 2400.
  const token2P = once(SocialServerEvent.FT_RUN_TOKEN);
  sock.emit(SocialClientEvent.FT_RUN_START, {});
  const token2 = await token2P;
  await sleep(1100);
  ok(
    await notSeen(SocialServerEvent.FT_SUBMIT_RESULT, 700, () =>
      sock.emit(SocialClientEvent.FT_SUBMIT, { score: 50_000, runId: token2.runId })),
    'implausible score for the elapsed run time is rejected',
  );

  const snapP2 = once(SocialServerEvent.FT_SNAPSHOT);
  sock.emit(SocialClientEvent.FT_GET, {});
  const snap2 = await snapP2;
  ok(snap2.me?.score === 1150, 'ft:get confirms the weekly best is untouched by rejects');
} catch (e) {
  fail++;
  console.error('\nFATAL:', e.message);
} finally {
  // ── cleanup: leave local dev state exactly as we found it ────────
  try {
    sock?.close();
    gw?.kill();
    const keys = await data.keys(`*${WK}*`);
    if (keys.length) await data.del(keys);
    await data.zrem(`ft:lb:${currentWeekKey()}`, wsUser);
    await data.hdel('ft:profiles', wsUser, ...users);
    await data.del(`bal:${wsUser}`, `settled:welcome:${wsUser}`, ...users.map(id => `bal:${id}`));
    if (!lastWkHadLock) {
      await data.del(`ft:paid:${lastWk}`);
      await db.fishmongerPayout.deleteMany({ where: { weekKey: lastWk } });
    }
    await db.user.deleteMany({ where: { id: { in: users } } }); // cascades scores + receipts
    await db.fishmongerPayout.deleteMany({ where: { weekKey: WK } });
    await db.$disconnect();
    await Promise.all([data.quit(), pub.quit(), sub.quit()]);
  } catch (e) {
    console.error('cleanup issue (non-fatal):', e.message);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
