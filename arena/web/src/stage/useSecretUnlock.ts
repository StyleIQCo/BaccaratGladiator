// ═══════════════════════════════════════════════════════════════════
//  useSecretUnlock — rapid-tap Easter-egg detector.
//  Feed it taps from a hidden target; when `taps` land inside a
//  rolling `windowMs`, it flips to unlocked and fires onUnlock once.
//  Stale taps age out of the window on a timer, so a casual click a
//  minute ago never counts toward the combo — only a deliberate
//  triple-tap triggers the secret.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SecretUnlockOptions {
  /** Taps required inside the window. Default 3. */
  taps?: number;
  /** Rolling window (ms) the taps must land within. Default 2000. */
  windowMs?: number;
  /** Once unlocked, ignore further taps. Default true. */
  once?: boolean;
  /** Fired exactly once per unlock. */
  onUnlock?: () => void;
}

export interface SecretUnlockState {
  unlocked: boolean;
  /** Taps currently alive inside the window — decays as taps expire. */
  tapCount: number;
  /** tapCount / taps, clamped 0..1 — drive subtle glows/pulses off this. */
  progress: number;
  /** Attach to onPointerDown (beats onClick by ~300ms on mobile Safari). */
  registerTap: () => void;
  /** Re-arm the secret (used by demos/tests). */
  reset: () => void;
}

export function useSecretUnlock(options: SecretUnlockOptions = {}): SecretUnlockState {
  const { taps = 3, windowMs = 2000, once = true, onUnlock } = options;

  const [unlocked, setUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const stamps = useRef<number[]>([]);
  const decayTimer = useRef<ReturnType<typeof setTimeout>>();
  const unlockedRef = useRef(false);
  // Ref'd so a stale closure never fires an old callback.
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  useEffect(() => () => clearTimeout(decayTimer.current), []);

  // Wake up when the oldest tap falls out of the window so the visible
  // tapCount (and any progress glow) decays instead of sticking at 2/3.
  const scheduleDecay = useCallback(() => {
    clearTimeout(decayTimer.current);
    const oldest = stamps.current[0];
    if (oldest === undefined) return;
    decayTimer.current = setTimeout(() => {
      const now = performance.now();
      stamps.current = stamps.current.filter(t => now - t < windowMs);
      setTapCount(stamps.current.length);
      scheduleDecay();
    }, Math.max(16, oldest + windowMs - performance.now()));
  }, [windowMs]);

  const registerTap = useCallback(() => {
    if (unlockedRef.current && once) return;
    const now = performance.now();
    stamps.current = [...stamps.current.filter(t => now - t < windowMs), now];

    if (stamps.current.length >= taps) {
      stamps.current = [];
      clearTimeout(decayTimer.current);
      setTapCount(0);
      unlockedRef.current = true;
      setUnlocked(true);
      onUnlockRef.current?.();
      return;
    }
    setTapCount(stamps.current.length);
    scheduleDecay();
  }, [once, taps, windowMs, scheduleDecay]);

  const reset = useCallback(() => {
    clearTimeout(decayTimer.current);
    stamps.current = [];
    unlockedRef.current = false;
    setUnlocked(false);
    setTapCount(0);
  }, []);

  return {
    unlocked,
    tapCount,
    progress: Math.min(1, tapCount / taps),
    registerTap,
    reset,
  };
}
