// THE authoritative loop. Exactly one instance runs cluster-wide (see leader.ts).
// Owns the clock, builds each round's provably-fair shoe, advances phases on a
// drift-corrected absolute-time schedule, and publishes every change to the bus.
// It NEVER touches sockets — gateways relay.
import { randomBytes } from 'crypto';
import {
  Phase, PHASE_ORDER, PHASE_MS, PROTOCOL_VERSION,
  GameStatePayload, sha256Hex, generateShoe, dealBaccarat, crashPointFromHand,
  type DealtHand,
} from '@bg/shared';
import { settleRound, archiveRound, mirrorCrash } from '@bg/persistence';
import { publish } from './bus';
import { CrashController } from './CrashController';
import { aggregateClientSeed, snapshotStats } from './RoundFactory';

interface RoundContext {
  roundId: string; nonce: number;
  serverSeed: string; serverSeedHash: string; clientSeed: string;
  hand: DealtHand; crashPoint: number;
}

export class GameLoop {
  private nonce = 0;
  private current!: RoundContext;
  private crash: CrashController;
  private phaseTimer?: NodeJS.Timeout;
  private crashTimer?: NodeJS.Timeout;
  private running = false;
  private crashTickMs: number;

  constructor(cfg: { crashGrowth?: number; crashTickMs?: number } = {}) {
    this.crash = new CrashController(cfg.crashGrowth);
    this.crashTickMs = cfg.crashTickMs ?? 100;
  }

  start() { if (!this.running) { this.running = true; void this.beginRound(); } }
  stop()  { this.running = false; clearTimeout(this.phaseTimer); clearInterval(this.crashTimer); }

  private async beginRound() {
    if (!this.running) return;
    const serverSeed = randomBytes(32).toString('hex');
    const serverSeedHash = sha256Hex(serverSeed);
    const clientSeed = await aggregateClientSeed();
    this.nonce += 1;

    const shoe = generateShoe(serverSeed, clientSeed, this.nonce);
    const hand = dealBaccarat(shoe);
    const crashPoint = crashPointFromHand(hand);

    this.current = {
      roundId: `r_${String(this.nonce).padStart(9, '0')}`,
      nonce: this.nonce, serverSeed, serverSeedHash, clientSeed, hand, crashPoint,
    };
    this.crash.arm(crashPoint);
    this.enterPhase(0);
  }

  private enterPhase(idx: number) {
    if (!this.running) return;
    const phase = PHASE_ORDER[idx];
    const phaseEndsAt = Date.now() + PHASE_MS[phase];

    switch (phase) {
      case Phase.BETTING:
        this.broadcast(phase, phaseEndsAt);
        break;
      case Phase.DEALING:
        this.broadcast(phase, phaseEndsAt);
        this.startCrashTicks(phaseEndsAt);
        break;
      case Phase.PAYOUT:
        clearInterval(this.crashTimer);
        this.crash.finalize();
        void settleRound(this.current);   // atomic, idempotent by roundId
        void archiveRound(this.current);  // for the public verifier page
        this.broadcast(phase, phaseEndsAt, /*reveal*/ true);
        break;
    }

    const next = idx + 1;
    this.phaseTimer = setTimeout(
      () => (next < PHASE_ORDER.length ? this.enterPhase(next) : this.beginRound()),
      Math.max(0, phaseEndsAt - Date.now()), // absolute target → drift-proof
    );
  }

  private startCrashTicks(phaseEndsAt: number) {
    this.crashTimer = setInterval(() => {
      const elapsed = PHASE_MS[Phase.DEALING] - (phaseEndsAt - Date.now());
      const justCrashed = this.crash.tick(elapsed);
      // Mirror the authoritative multiplier where gateways can read it for
      // cash-out validation, then broadcast the light crash-tick channel.
      void mirrorCrash(this.current.roundId, this.crash.multiplier, this.crash.crashed);
      this.broadcast(Phase.DEALING, phaseEndsAt, false, /*crashTickOnly*/ true);
      if (justCrashed) clearInterval(this.crashTimer);
    }, this.crashTickMs);
  }

  private broadcast(phase: Phase, phaseEndsAt: number, reveal = false, crashTickOnly = false) {
    const c = this.current;
    const payload: GameStatePayload = {
      v: PROTOCOL_VERSION,
      roundId: c.roundId, phase, phaseEndsAt, serverTimeNow: Date.now(),
      fair: {
        serverSeedHash: c.serverSeedHash, clientSeed: c.clientSeed, nonce: c.nonce,
        ...(reveal ? { serverSeed: c.serverSeed } : {}),
      },
      hand: phase === Phase.BETTING ? undefined : {
        player: c.hand.player, banker: c.hand.banker,
        playerTotal: c.hand.playerTotal, bankerTotal: c.hand.bankerTotal,
        outcome: c.hand.outcome, natural: c.hand.natural,
      },
      crash: {
        multiplier: this.crash.multiplier, crashed: this.crash.crashed,
        ...(this.crash.crashed || reveal ? { crashPoint: c.crashPoint } : {}),
      },
      stats: snapshotStats(c.roundId),
    };
    publish(crashTickOnly ? 'arena:crash' : 'arena:state', payload);
  }
}
