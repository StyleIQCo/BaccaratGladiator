// Engine entrypoint: load config, win the leader lock, run the loop.
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { GameLoop } from './GameLoop';
import { runAsLeader } from './leader';

const cfg = JSON.parse(readFileSync(`${process.env.CONFIG_DIR ?? './config'}/round.json`, 'utf8'));
const instanceId = randomBytes(8).toString('hex');
const loop = new GameLoop({ crashGrowth: cfg.crash.growth, crashTickMs: cfg.crash.tickMs });

void runAsLeader(
  instanceId,
  () => { console.log(`[engine ${instanceId}] became LEADER — starting loop`); loop.start(); },
  () => { console.log(`[engine ${instanceId}] lost leadership — stopping loop`); loop.stop(); },
);
