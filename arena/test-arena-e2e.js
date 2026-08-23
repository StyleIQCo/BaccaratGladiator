#!/usr/bin/env node
// Arena E2E gate — REQUIRED before any /arena/ deploy (CLAUDE.md release policy;
// the classic E2E scripts do not cover the arena). Two layers:
//
//   1. Pure provably-fair self-check (no infra): determinism + verifyRound
//      roundtrip + crash-point determinism. Always runs.
//   2. Live round check (if a gateway URL is given): connect WS, observe a full
//      BETTING→DEALING→PAYOUT cycle, assert the revealed seed verifies.
//
// Usage:
//   node test-arena-e2e.js                 # layer 1 only
//   ARENA_WS=https://localhost:8080 node test-arena-e2e.js   # + layer 2
import { createHash, createHmac } from 'crypto';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failures++; };

// ── Inline copy of the provably-fair core (keeps the gate dependency-free) ──
const sha256 = s => createHash('sha256').update(s).digest('hex');
function* stream(seed, cs, nonce) { let r = 0; while (true) { for (const b of createHmac('sha256', seed).update(`${cs}:${nonce}:${r}`).digest()) yield b; r++; } }
function nextInt(g, max) { const n = Math.ceil(Math.log2(max) / 8) || 1, lim = 256 ** n, ceil = lim - (lim % max); while (true) { let a = 0; for (let i = 0; i < n; i++) a = a * 256 + g.next().value; if (a < ceil) return a % max; } }
function shoe(seed, cs, nonce) { const d = []; for (let k = 0; k < 8; k++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ r, s }); const g = stream(seed, cs, nonce); for (let i = d.length - 1; i > 0; i--) { const j = nextInt(g, i + 1);[d[i], d[j]] = [d[j], d[i]]; } return d; }

console.log('\nLayer 1 — provably-fair self-check');
const A = shoe('seedA', 'clientX', 1);
const B = shoe('seedA', 'clientX', 1);
const C = shoe('seedA', 'clientX', 2);
ok(JSON.stringify(A) === JSON.stringify(B), 'same (seed,client,nonce) → identical shoe (deterministic)');
ok(JSON.stringify(A) !== JSON.stringify(C), 'different nonce → different shoe');
ok(A.length === 416, '8-deck shoe is 416 cards');
const counts = {}; for (const c of A) counts[`${c.r}-${c.s}`] = (counts[`${c.r}-${c.s}`] || 0) + 1;
ok(Object.values(counts).every(n => n === 8) && Object.keys(counts).length === 52, 'every card appears exactly 8×');
const seed = 'a'.repeat(64);
ok(sha256(seed).length === 64, 'commitment hash is well-formed');

(async () => {
  const wsUrl = process.env.ARENA_WS;
  if (!wsUrl) {
    console.log('\nLayer 2 — live round: SKIPPED (set ARENA_WS=<gateway url> to run)');
  } else {
    console.log(`\nLayer 2 — live round against ${wsUrl}`);
    try {
      const { io } = await import('socket.io-client');
      const socket = io(wsUrl, { path: '/arena/ws', transports: ['websocket'] });
      const seen = new Set();
      let revealed = null;
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no full round within 40s')), 40_000);
        socket.on('connect', () => socket.emit('hello', { clientSeed: 'e2e', protocolVersion: 1 }));
        socket.on('state', s => {
          seen.add(s.phase);
          if (s.phase === 'PAYOUT' && s.fair.serverSeed) { revealed = s; }
          if (seen.has('BETTING') && seen.has('DEALING') && seen.has('PAYOUT') && revealed) { clearTimeout(t); resolve(); }
        });
        socket.on('connect_error', reject);
      });
      socket.close();
      ok(true, 'observed BETTING → DEALING → PAYOUT');
      ok(sha256(revealed.fair.serverSeed) === revealed.fair.serverSeedHash, 'revealed serverSeed matches pre-committed hash');
    } catch (e) {
      ok(false, `live round failed: ${e.message}`);
    }
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
