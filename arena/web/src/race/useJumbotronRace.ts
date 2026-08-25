// ═══════════════════════════════════════════════════════════════════
//  DAILY JUMBOTRON RACE — state machine + race choreography.
//
//  The race is *pre-decided*: the winner is rolled the instant the
//  player picks a champion, then a 10-second broadcast is authored
//  around that outcome. Each racer gets a keyframe timeline of track
//  percentages (one sample every 0.5s, evenly spaced so Framer Motion
//  needs no `times` array). Per-segment speeds come from a random-phase
//  sine "form wave" + jitter — clamped positive so nobody reverses —
//  and the whole curve is scaled so the winner lands exactly on 100
//  while the losers cap short of the line. Random phases make racers
//  trade the lead; a drama check regenerates any wire-to-wire snoozer.
//
//  RNG is client-side because this is a cosmetic login bonus, not a
//  wagered outcome. If chips ever become withdrawable-adjacent, move
//  the roll behind the gateway like everything else in the arena.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';

export type RaceStatus = 'selection' | 'racing' | 'finished';

export interface Racer {
  id: string;
  name: string;
  icon: string;    // emoji stand-in — swap for sprite asset keys later
  color: string;   // neon accent for card borders, glows, exhaust trails
  tagline: string;
}

export const RACERS: Racer[] = [
  { id: 'cyber-bike',    name: 'The Cyber-Bike',    icon: '🏍️', color: '#2ee6ff', tagline: 'Neon-cooled. Zero mercy.' },
  { id: 'roman-chariot', name: 'The Roman Chariot', icon: '🐎',  color: '#ffd24a', tagline: 'Four horsepower. Literally.' },
  { id: 'texas-muscle',  name: 'The Texas Muscle',  icon: '🏎️', color: '#ff2e88', tagline: 'Big block. Bigger hat.' },
];

export const RACE_DURATION_MS = 10_000;
export const WIN_CHIPS = 5_000;
export const PARTICIPATION_CHIPS = 1_000;

const KEYFRAMES = 21;                       // 0.5s sampling over 10s
const CLAIM_KEY = 'bg:daily-race:last-claim';

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function readClaimedToday(): boolean {
  try { return localStorage.getItem(CLAIM_KEY) === todayStamp(); } catch { return false; }
}

/** One racer's cumulative track-% curve, ending exactly on finishPct. */
function speedCurve(finishPct: number): number[] {
  const phase = Math.random() * Math.PI * 2;
  const waves = 1.5 + Math.random() * 1.5;  // how many surge/fade cycles this racer gets
  const speeds: number[] = [];
  for (let k = 0; k < KEYFRAMES - 1; k++) {
    const t = k / (KEYFRAMES - 2);
    speeds.push(Math.max(0.15, 1 + 0.55 * Math.sin(phase + t * waves * Math.PI * 2) + (Math.random() - 0.5) * 0.4));
  }
  const pts = [0];
  let sum = 0;
  for (const s of speeds) { sum += s; pts.push(sum); }
  const scale = finishPct / sum;
  return pts.map(p => Math.round(p * scale * 100) / 100);
}

/** Wire-to-wire wins are legal but boring — demand the winner trails
 *  somewhere in the mid-race window so the broadcast gets a comeback. */
function hasLeadChange(timelines: Record<string, number[]>, winnerId: string): boolean {
  const from = Math.floor(KEYFRAMES * 0.2);
  const to = Math.ceil(KEYFRAMES * 0.8);
  for (let k = from; k < to; k++) {
    const w = timelines[winnerId][k];
    for (const id of Object.keys(timelines)) {
      if (id !== winnerId && timelines[id][k] > w + 1) return true;
    }
  }
  return false;
}

function buildTimelines(ids: string[], winnerId: string): Record<string, number[]> {
  let result: Record<string, number[]> = {};
  for (let attempt = 0; attempt < 8; attempt++) {
    // Losers finish in distinct bands so 2nd and 3rd read clearly on screen.
    const loserFinishes = [91 + Math.random() * 5, 84 + Math.random() * 5];
    if (Math.random() < 0.5) loserFinishes.reverse();
    let li = 0;
    result = {};
    for (const id of ids) {
      result[id] = speedCurve(id === winnerId ? 100 : loserFinishes[li++]);
    }
    if (hasLeadChange(result, winnerId)) return result;
  }
  return result; // 8 dull draws in a row — ship the last one rather than loop forever
}

/** Interpolated track-% for a timeline at a wall-clock offset — used by
 *  the live leader ticker, cheap enough to poll a few times a second. */
export function progressAt(timeline: number[], elapsedMs: number): number {
  const segs = timeline.length - 1;
  const t = Math.min(Math.max(elapsedMs / RACE_DURATION_MS, 0), 1) * segs;
  const i = Math.min(Math.floor(t), segs - 1);
  return timeline[i] + (timeline[i + 1] - timeline[i]) * (t - i);
}

export interface JumbotronRaceView {
  raceStatus: RaceStatus;
  racers: Racer[];
  selectedRacerId: string | null;
  winnerId: string | null;
  /** Track-% keyframes per racer id, evenly spaced across the race. */
  timelines: Record<string, number[]>;
  didWin: boolean;
  /** Chips this race pays out (win vs participation). */
  reward: number;
  claimedToday: boolean;
  startRace: (racerId: string) => void;
  /** Idempotent — wired to the winner's onAnimationComplete so the state
   *  machine lands in sync with the visuals; a fallback timer covers a
   *  backgrounded tab where the animation callback never fires. */
  finishRace: () => void;
  /** Stamps today's claim and returns the chips to grant. */
  claimReward: () => number;
  reset: () => void;
}

export function useJumbotronRace(): JumbotronRaceView {
  const [raceStatus, setRaceStatus] = useState<RaceStatus>('selection');
  const [selectedRacerId, setSelectedRacerId] = useState<string | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, number[]>>({});
  const [claimedToday, setClaimedToday] = useState(readClaimedToday);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(raceStatus);
  statusRef.current = raceStatus;

  const clearFallback = () => {
    if (fallbackTimer.current) { clearTimeout(fallbackTimer.current); fallbackTimer.current = null; }
  };

  const finishRace = useCallback(() => {
    clearFallback();
    setRaceStatus(s => (s === 'racing' ? 'finished' : s));
  }, []);

  const startRace = useCallback((racerId: string) => {
    if (statusRef.current === 'racing') return;
    const winner = RACERS[Math.floor(Math.random() * RACERS.length)];
    setSelectedRacerId(racerId);
    setWinnerId(winner.id);
    setTimelines(buildTimelines(RACERS.map(r => r.id), winner.id));
    setRaceStatus('racing');
    clearFallback();
    fallbackTimer.current = setTimeout(finishRace, RACE_DURATION_MS + 1_500);
  }, [finishRace]);

  const reset = useCallback(() => {
    clearFallback();
    setRaceStatus('selection');
    setSelectedRacerId(null);
    setWinnerId(null);
    setTimelines({});
    setClaimedToday(readClaimedToday());
  }, []);

  const didWin = raceStatus === 'finished' && selectedRacerId !== null && selectedRacerId === winnerId;
  const reward = didWin ? WIN_CHIPS : PARTICIPATION_CHIPS;

  const claimReward = useCallback((): number => {
    const chips = selectedRacerId !== null && selectedRacerId === winnerId ? WIN_CHIPS : PARTICIPATION_CHIPS;
    try { localStorage.setItem(CLAIM_KEY, todayStamp()); } catch { /* private mode: bonus stays re-claimable */ }
    setClaimedToday(true);
    return chips;
  }, [selectedRacerId, winnerId]);

  useEffect(() => clearFallback, []);

  return {
    raceStatus, racers: RACERS, selectedRacerId, winnerId, timelines,
    didWin, reward, claimedToday, startRace, finishRace, claimReward, reset,
  };
}
