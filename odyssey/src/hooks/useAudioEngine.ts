'use client';

/**
 * useAudioEngine — shared BGM/SFX engine for The Odyssey.
 *
 * Design notes:
 * - Module-level singleton: CampaignSelector, the map, cutscenes, and
 *   overlays all drive ONE engine, so a BGM crossfade started on the
 *   selector survives route/component changes.
 * - HTMLAudioElement (not WebAudio) for maximum mobile compatibility;
 *   crossfades are volume ramps driven by requestAnimationFrame.
 * - iOS/Android autoplay policy: playback silently queues until the first
 *   user gesture. The hook installs one-time gesture listeners that unlock
 *   the engine and flush any pending BGM.
 */

import { useEffect, useMemo } from 'react';

export type BgmKey =
  | 'mystic_chords'
  | 'boss_drums'
  | 'ocean_ambient'
  | 'orchestral_overture'
  | 'aegean_guitar';

export type SfxKey =
  | 'card_slide'
  | 'gong'
  | 'stone_drag'
  | 'typewriter_clack'
  | 'jackpot_chime'
  | 'metal_clank'
  | 'thunderclap'
  | 'ocean_waves'
  | 'triumph_chime'
  | 'sword_unsheathe';

const AUDIO_BASE = '/audio/odyssey';

export const AUDIO_MANIFEST: {
  bgm: Record<BgmKey, string>;
  sfx: Record<SfxKey, string>;
} = {
  bgm: {
    mystic_chords: `${AUDIO_BASE}/bgm/mystic_chords.mp3`,
    boss_drums: `${AUDIO_BASE}/bgm/boss_drums.mp3`,
    ocean_ambient: `${AUDIO_BASE}/bgm/ocean_ambient.mp3`,
    orchestral_overture: `${AUDIO_BASE}/bgm/orchestral_overture.mp3`,
    aegean_guitar: `${AUDIO_BASE}/bgm/aegean_guitar.mp3`,
  },
  sfx: {
    card_slide: `${AUDIO_BASE}/sfx/card_slide.mp3`,
    gong: `${AUDIO_BASE}/sfx/gong.mp3`,
    stone_drag: `${AUDIO_BASE}/sfx/stone_drag.mp3`,
    typewriter_clack: `${AUDIO_BASE}/sfx/typewriter_clack.mp3`,
    jackpot_chime: `${AUDIO_BASE}/sfx/jackpot_chime.mp3`,
    metal_clank: `${AUDIO_BASE}/sfx/metal_clank.mp3`,
    thunderclap: `${AUDIO_BASE}/sfx/thunderclap.mp3`,
    ocean_waves: `${AUDIO_BASE}/sfx/ocean_waves.mp3`,
    triumph_chime: `${AUDIO_BASE}/sfx/triumph_chime.mp3`,
    sword_unsheathe: `${AUDIO_BASE}/sfx/sword_unsheathe.mp3`,
  },
};

export interface PlayBgmOptions {
  crossfadeMs?: number;
  volume?: number;
}

export interface PlaySfxOptions {
  volume?: number;
  /** Drop the call if the same key played less than this many ms ago. */
  throttleMs?: number;
  loop?: boolean;
}

export interface SfxHandle {
  stop: (fadeMs?: number) => void;
}

export interface AudioEngineApi {
  playBGM: (key: BgmKey, opts?: PlayBgmOptions) => void;
  stopBGM: (fadeMs?: number) => void;
  playSFX: (key: SfxKey, opts?: PlaySfxOptions) => SfxHandle;
  stopAll: (opts?: { fadeMs?: number }) => void;
  preload: (keys?: { bgm?: BgmKey[]; sfx?: SfxKey[] }) => void;
  setMuted: (muted: boolean) => void;
  unlock: () => void;
  getCurrentBGM: () => BgmKey | null;
}

const NOOP_HANDLE: SfxHandle = { stop: () => {} };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const SFX_POOL_CAP = 8;

class OdysseyAudioEngine {
  private bgmEl: HTMLAudioElement | null = null;
  private bgmKey: BgmKey | null = null;
  private pendingBgm: { key: BgmKey; opts: PlayBgmOptions } | null = null;

  private fadeJobs = new Map<HTMLAudioElement, number>();
  private sfxPool = new Map<SfxKey, HTMLAudioElement[]>();
  private sfxLastAt = new Map<SfxKey, number>();
  private liveLoops = new Set<HTMLAudioElement>();
  private preloaded = new Set<string>();

  private muted = false;
  private bgmVolume = 0.8;
  private sfxVolume = 1.0;
  unlocked = false;

  // ---- volume ramps ------------------------------------------------------

  private cancelFade(el: HTMLAudioElement) {
    const raf = this.fadeJobs.get(el);
    if (raf !== undefined) cancelAnimationFrame(raf);
    this.fadeJobs.delete(el);
  }

  private fadeTo(el: HTMLAudioElement, target: number, ms: number, onDone?: () => void) {
    this.cancelFade(el);
    if (ms <= 0) {
      el.volume = clamp01(target);
      onDone?.();
      return;
    }
    const from = el.volume;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - t0) / ms, 1);
      const eased = p * (2 - p); // easeOutQuad
      el.volume = clamp01(from + (target - from) * eased);
      if (p < 1) {
        this.fadeJobs.set(el, requestAnimationFrame(step));
      } else {
        this.fadeJobs.delete(el);
        onDone?.();
      }
    };
    this.fadeJobs.set(el, requestAnimationFrame(step));
  }

  private releaseEl(el: HTMLAudioElement) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }

  // ---- BGM ---------------------------------------------------------------

  playBGM(key: BgmKey, opts: PlayBgmOptions = {}) {
    const { crossfadeMs = 1600, volume = 1 } = opts;
    const target = clamp01(volume * this.bgmVolume);

    if (this.bgmKey === key && this.bgmEl && !this.bgmEl.paused) {
      this.fadeTo(this.bgmEl, target, 300);
      return;
    }

    const prev = this.bgmEl;
    if (prev) {
      this.fadeTo(prev, 0, crossfadeMs, () => this.releaseEl(prev));
    }

    const el = new Audio(AUDIO_MANIFEST.bgm[key]);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    el.muted = this.muted;
    this.bgmEl = el;
    this.bgmKey = key;

    el.play().catch(() => {
      // Autoplay refused — retried on the next unlock gesture.
      this.pendingBgm = { key, opts };
    });
    this.fadeTo(el, target, crossfadeMs);
  }

  stopBGM(fadeMs = 600) {
    this.pendingBgm = null;
    const el = this.bgmEl;
    if (!el) return;
    this.bgmEl = null;
    this.bgmKey = null;
    this.fadeTo(el, 0, fadeMs, () => this.releaseEl(el));
  }

  getCurrentBGM(): BgmKey | null {
    return this.bgmKey;
  }

  // ---- SFX ---------------------------------------------------------------

  private acquireSfx(key: SfxKey): HTMLAudioElement {
    let pool = this.sfxPool.get(key);
    if (!pool) {
      pool = [];
      this.sfxPool.set(key, pool);
    }
    const idle = pool.find((a) => a.paused || a.ended);
    if (idle) return idle;
    const el = new Audio(AUDIO_MANIFEST.sfx[key]);
    el.preload = 'auto';
    if (pool.length < SFX_POOL_CAP) pool.push(el);
    return el;
  }

  playSFX(key: SfxKey, opts: PlaySfxOptions = {}): SfxHandle {
    const { volume = 1, throttleMs = 0, loop = false } = opts;

    if (throttleMs > 0) {
      const last = this.sfxLastAt.get(key) ?? -Infinity;
      if (performance.now() - last < throttleMs) return NOOP_HANDLE;
    }
    this.sfxLastAt.set(key, performance.now());

    const el = this.acquireSfx(key);
    this.cancelFade(el);
    el.loop = loop;
    el.muted = this.muted;
    el.volume = clamp01(volume * this.sfxVolume);
    try {
      el.currentTime = 0;
    } catch {
      // Not seekable yet (still loading) — play from wherever it is.
    }
    el.play().catch(() => {});
    if (loop) this.liveLoops.add(el);

    return {
      stop: (fadeMs = 250) => {
        this.fadeTo(el, 0, fadeMs, () => {
          el.pause();
          el.loop = false;
          this.liveLoops.delete(el);
        });
      },
    };
  }

  // ---- global ------------------------------------------------------------

  stopAll(opts: { fadeMs?: number } = {}) {
    const { fadeMs = 400 } = opts;
    this.stopBGM(fadeMs);
    for (const el of this.liveLoops) {
      this.fadeTo(el, 0, fadeMs, () => {
        el.pause();
        el.loop = false;
      });
    }
    this.liveLoops.clear();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.bgmEl) this.bgmEl.muted = muted;
    for (const pool of this.sfxPool.values()) {
      for (const el of pool) el.muted = muted;
    }
    for (const el of this.liveLoops) el.muted = muted;
  }

  preload(keys?: { bgm?: BgmKey[]; sfx?: SfxKey[] }) {
    const bgm = keys?.bgm ?? (Object.keys(AUDIO_MANIFEST.bgm) as BgmKey[]);
    const sfx = keys?.sfx ?? (Object.keys(AUDIO_MANIFEST.sfx) as SfxKey[]);
    for (const key of bgm) {
      const url = AUDIO_MANIFEST.bgm[key];
      if (this.preloaded.has(url)) continue;
      this.preloaded.add(url);
      const el = new Audio(url);
      el.preload = 'auto';
    }
    for (const key of sfx) {
      const url = AUDIO_MANIFEST.sfx[key];
      if (this.preloaded.has(url)) continue;
      this.preloaded.add(url);
      this.acquireSfx(key);
    }
  }

  unlock() {
    this.unlocked = true;
    const pending = this.pendingBgm;
    if (!pending) return;
    this.pendingBgm = null;
    if (this.bgmEl) {
      this.cancelFade(this.bgmEl);
      this.releaseEl(this.bgmEl);
      this.bgmEl = null;
    }
    this.bgmKey = null;
    this.playBGM(pending.key, pending.opts);
  }
}

let singleton: OdysseyAudioEngine | null = null;

export function getAudioEngine(): OdysseyAudioEngine {
  if (!singleton) singleton = new OdysseyAudioEngine();
  return singleton;
}

const SSR_API: AudioEngineApi = {
  playBGM: () => {},
  stopBGM: () => {},
  playSFX: () => NOOP_HANDLE,
  stopAll: () => {},
  preload: () => {},
  setMuted: () => {},
  unlock: () => {},
  getCurrentBGM: () => null,
};

export function useAudioEngine(): AudioEngineApi {
  const engine = useMemo(
    () => (typeof window === 'undefined' ? null : getAudioEngine()),
    [],
  );

  useEffect(() => {
    if (!engine) return;
    const unlock = () => engine.unlock();
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'touchstart', 'keydown'];
    events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, [engine]);

  return useMemo<AudioEngineApi>(() => {
    if (!engine) return SSR_API;
    return {
      playBGM: (key, opts) => engine.playBGM(key, opts),
      stopBGM: (fadeMs) => engine.stopBGM(fadeMs),
      playSFX: (key, opts) => engine.playSFX(key, opts),
      stopAll: (opts) => engine.stopAll(opts),
      preload: (keys) => engine.preload(keys),
      setMuted: (muted) => engine.setMuted(muted),
      unlock: () => engine.unlock(),
      getCurrentBGM: () => engine.getCurrentBGM(),
    };
  }, [engine]);
}
