// Three ioredis connections: pub (engine publishes), sub (gateways subscribe),
// data (commands + Lua). pub/data can share, but a connection in subscribe mode
// can't issue normal commands — so `sub` is dedicated.
import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
export const data = new Redis(url);
export const pub  = new Redis(url);
export const sub  = new Redis(url);

const here = dirname(fileURLToPath(import.meta.url));

/** Load a Lua script and return its SHA for fast EVALSHA. */
export async function loadScript(file: string): Promise<string> {
  const src = readFileSync(join(here, file), 'utf8');
  return data.script('LOAD', src) as Promise<string>;
}

// Pre-load the atomic first-50 rain claim script at boot.
export const RAIN_CLAIM_SHA = await loadScript('claim_rain.lua');
