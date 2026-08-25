'use client';

/**
 * NarrativeCutsceneModal — the theatric story gate shown before entering an
 * Odyssey table (and, in 'victory' mode, after clearing one).
 *
 * Choreography:
 * - Entrance: heavy stone-drag SFX as the slab descends (weighty spring).
 *   In 'intro' mode the BGM crossfades to the stage's audioTheme, so the
 *   table's mood is already playing when the player sits down.
 * - Pages: the stage `narrative` first, then each dialogue line. Text is
 *   streamed by a typewriter driven by framer-motion's animate() — its
 *   onUpdate writes directly to a DOM node (no per-frame React state) and
 *   fires a throttled typewriter-clack per printed character.
 * - Tap: finishes the current page instantly, then advances. The final page
 *   reveals the objective seal (sword-unsheathe on boss stages) and the
 *   ENTER THE TABLE button.
 * - Dismissing without entering restores whatever BGM was playing before.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  animate,
  AnimatePresence,
  motion,
  type AnimationPlaybackControls,
} from 'framer-motion';
import { useAudioEngine, type BgmKey } from '../hooks/useAudioEngine';
import type { OdysseyStage, OdysseyTableModifier } from '../data/odysseyStoryData';

export interface NarrativeCutsceneModalProps {
  stage: OdysseyStage | null;
  open: boolean;
  mode?: 'intro' | 'victory';
  /** "ENTER THE TABLE" pressed — parent mounts the baccarat table. */
  onBegin: () => void;
  /** Dismissed without entering (backdrop X). */
  onClose?: () => void;
  charsPerSecond?: number;
  /** Intro CTA label (the campaign flow passes "SET SAIL"). */
  ctaLabel?: string;
}

const GOLD = '#f5c542';
const GOLD_DIM = 'rgba(245, 197, 66, 0.45)';
const EMBER = '#e8703a';

const MODIFIER_LABELS: Record<OdysseyTableModifier, string> = {
  SHIFTING_MULTIPLIERS: 'TABLE LAW — Multipliers gust with the winds',
  NO_TIE_BETS: 'TABLE LAW — The Tie bet is sealed',
  NO_SIDE_BETS: 'TABLE LAW — Side bets are forbidden',
  HIGH_ROLLER: 'TABLE LAW — High-roller stakes',
};

interface CutscenePage {
  speaker?: string;
  text: string;
}

export function NarrativeCutsceneModal({
  stage,
  open,
  mode = 'intro',
  onBegin,
  onClose,
  charsPerSecond = 40,
  ctaLabel = 'ENTER THE TABLE',
}: NarrativeCutsceneModalProps) {
  const audio = useAudioEngine();
  const [pageIndex, setPageIndex] = useState(0);
  const [typingDone, setTypingDone] = useState(false);

  const textRef = useRef<HTMLSpanElement>(null);
  const typerRef = useRef<AnimationPlaybackControls | null>(null);
  const prevBgmRef = useRef<BgmKey | null>(null);

  const pages = useMemo<CutscenePage[]>(() => {
    if (!stage) return [];
    return mode === 'intro'
      ? [{ text: stage.narrative }, ...stage.intro]
      : [...stage.victory];
  }, [stage, mode]);

  const page = pages[pageIndex] as CutscenePage | undefined;
  const isLastPage = pageIndex === pages.length - 1;
  const boss = stage?.isBossStage ?? false;

  // Entrance: reset paging, stone-drag, and (intro only) the stage's theme.
  useEffect(() => {
    if (!open || !stage) return;
    setPageIndex(0);
    setTypingDone(false);
    audio.playSFX('stone_drag', { volume: 0.9 });
    if (mode === 'intro') {
      prevBgmRef.current = audio.getCurrentBGM();
      audio.playBGM(stage.audioTheme, { crossfadeMs: 2200, volume: 0.9 });
    }
    audio.preload({ sfx: ['typewriter_clack', 'card_slide', 'sword_unsheathe'] });
  }, [open, stage, mode, audio]);

  // Typewriter for the current page. framer-motion animate() drives a bare
  // counter; onUpdate mutates textContent directly — zero React renders per
  // character — and clacks (throttled) for every visible glyph.
  useEffect(() => {
    if (!open || !page) return;
    setTypingDone(false);
    const text = page.text;
    if (textRef.current) textRef.current.textContent = '';
    const controls = animate(0, text.length, {
      duration: text.length / charsPerSecond,
      ease: 'linear',
      onUpdate: (latest) => {
        const n = Math.floor(latest);
        const el = textRef.current;
        if (!el || el.textContent?.length === n) return;
        el.textContent = text.slice(0, n);
        const ch = text[n - 1];
        if (ch && ch !== ' ' && ch !== '\n') {
          audio.playSFX('typewriter_clack', { volume: 0.3, throttleMs: 45 });
        }
      },
      onComplete: () => {
        if (textRef.current) textRef.current.textContent = text;
        setTypingDone(true);
      },
    });
    typerRef.current = controls;
    return () => controls.stop();
  }, [open, page, charsPerSecond, audio]);

  // Objective seal reveal on the final page.
  useEffect(() => {
    if (!open || !typingDone || !isLastPage || mode !== 'intro') return;
    audio.playSFX(boss ? 'sword_unsheathe' : 'card_slide', { volume: 0.85 });
  }, [open, typingDone, isLastPage, mode, boss, audio]);

  const advance = useCallback(() => {
    if (!page) return;
    if (!typingDone) {
      typerRef.current?.stop();
      if (textRef.current) textRef.current.textContent = page.text;
      setTypingDone(true);
      return;
    }
    if (pageIndex < pages.length - 1) {
      audio.playSFX('card_slide', { volume: 0.5, throttleMs: 120 });
      setPageIndex((i) => i + 1);
    }
  }, [page, typingDone, pageIndex, pages.length, audio]);

  const handleBegin = useCallback(() => {
    audio.playSFX('card_slide', { volume: 0.8 });
    onBegin();
  }, [audio, onBegin]);

  const handleClose = useCallback(() => {
    if (mode === 'intro' && prevBgmRef.current) {
      audio.playBGM(prevBgmRef.current, { crossfadeMs: 1200 });
    }
    onClose?.();
  }, [audio, mode, onClose]);

  const borderColor = boss ? EMBER : GOLD_DIM;

  return (
    <AnimatePresence>
      {open && stage && page && (
        <motion.div
          key={`cutscene-${stage.id}-${mode}`}
          data-testid="narrative-cutscene"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          style={S.backdrop}
        >
          <style>{KEYFRAMES}</style>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={stage.title}
            initial={{ y: -90, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 26, mass: 1.4 }}
            onClick={advance}
            data-testid="cutscene-advance"
            style={{ ...S.modal, borderColor }}
          >
            {/* Greek meander strips */}
            <span style={{ ...S.meander, top: 0 }} />
            <span style={{ ...S.meander, bottom: 0 }} />

            {onClose && (
              <button
                type="button"
                aria-label="Close"
                data-testid="cutscene-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose();
                }}
                style={S.closeButton}
              >
                ✕
              </button>
            )}

            <p style={{ ...S.kicker, color: boss ? EMBER : GOLD_DIM }}>
              {boss ? '⚔️ BOSS TRIAL' : mode === 'victory' ? 'VICTORY' : `TRIAL ${stage.id} OF 10`}
            </p>
            <h2 style={S.title}>{stage.title}</h2>

            <div style={S.textWell}>
              {page.speaker && <span style={S.speaker}>{page.speaker}</span>}
              <p style={S.storyText} data-testid="cutscene-text">
                <span ref={textRef} />
                {!typingDone && <span style={S.caret}>▍</span>}
              </p>
            </div>

            <div style={S.footer}>
              {isLastPage && typingDone && mode === 'intro' ? (
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  style={S.sealBlock}
                >
                  <div style={{ ...S.objectiveSeal, borderColor }}>
                    <span style={{ ...S.objectiveKicker, color: boss ? EMBER : GOLD }}>
                      OBJECTIVE
                    </span>
                    <span style={S.objectiveText}>{stage.objective}</span>
                    {stage.tableModifier && (
                      <span style={S.modifierChip}>{MODIFIER_LABELS[stage.tableModifier]}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="cutscene-cta"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBegin();
                    }}
                    style={{ ...S.beginButton, borderColor, color: boss ? '#ffd9c4' : GOLD }}
                  >
                    {ctaLabel}
                  </button>
                </motion.div>
              ) : isLastPage && typingDone && mode === 'victory' ? (
                <button
                  type="button"
                  data-testid="cutscene-cta"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleBegin();
                  }}
                  style={{ ...S.beginButton, borderColor, color: GOLD }}
                >
                  CONTINUE ▸
                </button>
              ) : (
                <span style={S.tapHint}>
                  {typingDone ? 'TAP TO CONTINUE ▸' : 'TAP TO SKIP'}
                </span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const KEYFRAMES = `
@keyframes cutsceneCaret {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0; }
}
@keyframes ctaPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 197, 66, 0.35); transform: scale(1); }
  50%      { box-shadow: 0 0 22px 4px rgba(245, 197, 66, 0.25); transform: scale(1.03); }
}
`;

// Meander strip: a stylized Greek fret rendered with layered gradients.
const MEANDER_BG = [
  `repeating-linear-gradient(90deg, ${GOLD} 0 3px, transparent 3px 12px)`,
  `repeating-linear-gradient(90deg, transparent 0 6px, ${GOLD} 6px 9px, transparent 9px 12px)`,
].join(', ');

const S: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.25rem',
    background: 'rgba(6, 8, 14, 0.78)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  },
  modal: {
    position: 'relative',
    width: 'min(560px, 100%)',
    minHeight: '360px',
    display: 'flex',
    flexDirection: 'column',
    padding: '2.4rem 1.75rem 1.75rem',
    borderRadius: '16px',
    border: `2px solid ${GOLD_DIM}`,
    background: 'linear-gradient(170deg, rgba(26, 32, 48, 0.88) 0%, rgba(15, 19, 30, 0.92) 100%)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    boxShadow: '0 30px 80px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(245, 197, 66, 0.08)',
    cursor: 'pointer',
    overflow: 'hidden',
    fontFamily: "'Cinzel', 'Trajan Pro', Georgia, serif",
  },
  meander: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    height: '5px',
    background: MEANDER_BG,
    opacity: 0.55,
  },
  closeButton: {
    position: 'absolute',
    top: '0.9rem',
    right: '0.9rem',
    width: '2rem',
    height: '2rem',
    borderRadius: '50%',
    border: '1px solid rgba(232, 237, 245, 0.25)',
    background: 'transparent',
    color: 'rgba(232, 237, 245, 0.6)',
    cursor: 'pointer',
    fontSize: '0.8rem',
  },
  kicker: {
    margin: 0,
    fontSize: '0.68rem',
    letterSpacing: '0.4em',
    textAlign: 'center',
  },
  title: {
    margin: '0.5rem 0 1.25rem',
    fontSize: 'clamp(1.4rem, 5.5vw, 2rem)',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: '#f2ead8',
    textAlign: 'center',
    textShadow: '0 2px 18px rgba(245, 197, 66, 0.22)',
  },
  textWell: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    justifyContent: 'center',
    padding: '1rem 0.25rem',
  },
  speaker: {
    fontSize: '0.72rem',
    letterSpacing: '0.32em',
    color: GOLD,
  },
  storyText: {
    margin: 0,
    fontFamily: 'Georgia, serif',
    fontStyle: 'italic',
    fontSize: 'clamp(1rem, 4vw, 1.15rem)',
    lineHeight: 1.7,
    color: 'rgba(238, 242, 248, 0.92)',
    minHeight: '5.1em',
  },
  caret: {
    color: GOLD,
    animation: 'cutsceneCaret 0.9s steps(1) infinite',
    fontStyle: 'normal',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minHeight: '3rem',
    justifyContent: 'flex-end',
  },
  tapHint: {
    fontSize: '0.62rem',
    letterSpacing: '0.35em',
    color: 'rgba(232, 237, 245, 0.4)',
    padding: '0.75rem 0 0.25rem',
  },
  sealBlock: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.9rem',
  },
  objectiveSeal: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.85rem 1rem',
    borderRadius: '12px',
    border: `1px solid ${GOLD_DIM}`,
    background: 'rgba(245, 197, 66, 0.06)',
  },
  objectiveKicker: {
    fontSize: '0.6rem',
    letterSpacing: '0.42em',
  },
  objectiveText: {
    fontSize: '0.95rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    color: '#f2ead8',
    textAlign: 'center',
  },
  modifierChip: {
    marginTop: '0.25rem',
    padding: '0.28rem 0.75rem',
    borderRadius: '999px',
    border: `1px solid ${EMBER}`,
    fontSize: '0.58rem',
    letterSpacing: '0.18em',
    color: '#ffd9c4',
  },
  beginButton: {
    padding: '0.85rem 2.4rem',
    borderRadius: '10px',
    border: `2px solid ${GOLD_DIM}`,
    background: 'rgba(245, 197, 66, 0.08)',
    fontFamily: 'inherit',
    fontSize: '0.82rem',
    fontWeight: 700,
    letterSpacing: '0.3em',
    cursor: 'pointer',
  },
};
