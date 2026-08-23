// Leader election so EXACTLY ONE engine runs the loop cluster-wide. Uses a
// Redis lock with a TTL the leader renews; if the leader dies, the lock expires
// and a standby acquires it. Run N engine replicas for HA — only the leader ticks.
import { data } from '@bg/persistence';

const LOCK_KEY = 'arena:engine:leader';
const TTL_MS = 5_000;
const RENEW_MS = 2_000;

export async function runAsLeader(
  instanceId: string,
  onAcquire: () => void,
  onLose: () => void,
): Promise<void> {
  let isLeader = false;

  const tryAcquire = async () => {
    // SET key val NX PX ttl — atomic acquire-or-renew.
    const ok = await data.set(LOCK_KEY, instanceId, 'PX', TTL_MS, 'NX');
    if (ok === 'OK' && !isLeader) { isLeader = true; onAcquire(); return; }
    if (isLeader) {
      // Renew only if we still hold it (compare-and-extend via Lua).
      const held = await data.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
        1, LOCK_KEY, instanceId, String(TTL_MS),
      );
      if (held !== 1) { isLeader = false; onLose(); }
    }
  };

  await tryAcquire();
  setInterval(tryAcquire, RENEW_MS);
}
