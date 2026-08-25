// Engine entrypoint: load config, win the leader lock, run the loop.
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { GameLoop } from './GameLoop';
import { runAsLeader } from './leader';
import { sweepFishmongerPayout } from '@bg/persistence';

const cfg = JSON.parse(readFileSync(`${process.env.CONFIG_DIR ?? './config'}/round.json`, 'utf8'));
const instanceId = randomBytes(8).toString('hex');
const loop = new GameLoop({ crashGrowth: cfg.crash.growth, crashTickMs: cfg.crash.tickMs });

// Weekly Fishmonger prize sweep rides the leader lock: only the live
// leader ticks it, and the Redis ft:paid:{week} NX lock makes a
// failover double-tick harmless. Minute cadence ⇒ the just-ended week
// pays within a minute of Mon 00:00 UTC (right after Sunday 23:59).
let ftSweep: ReturnType<typeof setInterval> | null = null;
const tickFishmonger = () =>
  sweepFishmongerPayout().catch(e => console.error('[engine] fishmonger sweep failed', e));

void runAsLeader(
  instanceId,
  () => {
    console.log(`[engine ${instanceId}] became LEADER — starting loop`);
    loop.start();
    tickFishmonger();
    ftSweep = setInterval(tickFishmonger, 60_000);
  },
  () => {
    console.log(`[engine ${instanceId}] lost leadership — stopping loop`);
    loop.stop();
    if (ftSweep) { clearInterval(ftSweep); ftSweep = null; }
  },
);
