// Per-socket token bucket. Cash-out is high-frequency and panic-tappy; this
// drops floods without dropping the connection. Buckets live in-process (each
// gateway rate-limits its own sockets) — fine, since a socket is pinned to one node.
const buckets = new Map<string, { tokens: number; last: number }>();

export function tryConsume(id: string, max = 5, refillMs = 1000): boolean {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: max, last: now };
  // Refill proportional to elapsed time.
  b.tokens = Math.min(max, b.tokens + ((now - b.last) / refillMs) * max);
  b.last = now;
  if (b.tokens < 1) { buckets.set(id, b); return false; }
  b.tokens -= 1;
  buckets.set(id, b);
  return true;
}

export function dropSocket(id: string): void { buckets.delete(id); }
