// ═══════════════════════════════════════════════════════════════════
//  MADRONA WOOD LABYRINTH — marble inventory overlay.
//
//  A Framer Motion sheet that sits above the canvas: three selector
//  cards (one per marbleData entry), each with a CSS-lit marble
//  swatch, 3D-tilt hover, and SPEED / CONTROL / POWER stat bars fed
//  straight from spec.stats. Selecting a marble reports up through
//  onSelect and closes the sheet — the wrapper owns the activeMarble
//  state and the game loop reads it from there.
//
//  Opened from the intro (loadout pick) AND mid-run via the HUD SWAP
//  button — the wrapper pauses the sim while this is up, so browsing
//  marbles never burns clock.
// ═══════════════════════════════════════════════════════════════════
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MARBLES, type MarbleId, type MarbleSpec } from './marbleData';

export interface MarbleInventoryUIProps {
  open: boolean;
  activeId: MarbleId;
  /** Equip: update the wrapper's activeMarble state. The sheet closes itself. */
  onSelect: (id: MarbleId) => void;
  onClose: () => void;
  /** Header line — defaults to the loadout prompt. */
  title?: string;
}

const STAT_ROWS: { key: keyof MarbleSpec['stats']; label: string }[] = [
  { key: 'speed', label: 'SPEED' },
  { key: 'control', label: 'CONTROL' },
  { key: 'power', label: 'DESTRUCTION' },
];

/** The marble as pure CSS: body gradient + specular + glass ring. */
function MarbleSwatch({ spec }: { spec: MarbleSpec }) {
  const [hot, mid, edge] = spec.render.body;
  return (
    <div
      aria-hidden
      className="relative h-14 w-14 shrink-0 rounded-full"
      style={{
        background: `radial-gradient(circle at 32% 28%, ${hot} 0%, ${mid} 52%, ${edge} 100%)`,
        opacity: spec.render.alpha,
        boxShadow: `0 6px 10px rgba(0,0,0,0.45), inset -3px -4px 8px rgba(0,0,0,0.35)`,
      }}
    >
      {spec.render.innerGlow && (
        <div
          className="absolute inset-[18%] rounded-full"
          style={{
            border: `2px solid ${spec.render.innerGlow.color}`,
            opacity: spec.render.innerGlow.alpha,
            filter: 'blur(0.5px)',
          }}
        />
      )}
      <div
        className="absolute h-3 w-3 rounded-full bg-white"
        style={{ left: '22%', top: '18%', opacity: spec.render.specular.alpha, filter: 'blur(1px)' }}
      />
      {spec.render.pitted && (
        <div
          className="absolute inset-0 rounded-full"
          style={{
            backgroundImage:
              'radial-gradient(circle 2px at 30% 62%, rgba(0,0,0,0.5) 0 2px, transparent 2px), radial-gradient(circle 1.5px at 62% 40%, rgba(0,0,0,0.45) 0 1.5px, transparent 1.5px), radial-gradient(circle 2px at 55% 72%, rgba(0,0,0,0.4) 0 2px, transparent 2px)',
          }}
        />
      )}
    </div>
  );
}

export function MarbleInventoryUI({
  open,
  activeId,
  onSelect,
  onClose,
  title = 'Choose Your Marble',
}: MarbleInventoryUIProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-30 flex items-center justify-center bg-stone-950/80 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          data-testid="marble-inventory"
        >
          <motion.div
            className="w-full max-w-[340px] rounded-2xl border border-orange-200/20 bg-gradient-to-b from-stone-800 to-stone-900 p-4 shadow-2xl"
            initial={reduceMotion ? { opacity: 0 } : { y: 40, scale: 0.92, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 30, scale: 0.95, opacity: 0 }}
            transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.35, duration: 0.5 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-orange-200">{title}</h3>
              <button
                onClick={onClose}
                aria-label="Close inventory"
                data-testid="inventory-close"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-xs font-bold text-white/80"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5" style={{ perspective: 700 }}>
              {MARBLES.map((spec, i) => {
                const selected = spec.id === activeId;
                return (
                  <motion.button
                    key={spec.id}
                    data-testid={`marble-card-${spec.id}`}
                    data-selected={selected ? 'true' : 'false'}
                    onClick={() => {
                      onSelect(spec.id);
                      onClose();
                    }}
                    className="relative block w-full rounded-xl border p-3 text-left"
                    style={{
                      borderColor: selected ? spec.accent : 'rgba(255,255,255,0.12)',
                      background: selected
                        ? `linear-gradient(135deg, ${spec.accent}26, rgba(0,0,0,0.35))`
                        : 'rgba(0,0,0,0.3)',
                      boxShadow: selected ? `0 0 14px ${spec.accent}55` : undefined,
                      transformStyle: 'preserve-3d',
                    }}
                    initial={reduceMotion ? undefined : { x: -24, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: reduceMotion ? 0 : 0.06 * i }}
                    whileHover={reduceMotion ? undefined : { rotateX: 5, rotateY: -7, scale: 1.03, z: 12 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    {selected && (
                      <span
                        className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-black tracking-wider text-stone-900"
                        style={{ background: spec.accent }}
                      >
                        EQUIPPED
                      </span>
                    )}
                    <div className="flex items-center gap-3">
                      <MarbleSwatch spec={spec} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-black uppercase tracking-wide text-white">{spec.name}</div>
                        <div className="mt-0.5 text-[10px] leading-tight text-white/60">{spec.tagline}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 space-y-1">
                      {STAT_ROWS.map((row) => (
                        <div key={row.key} className="flex items-center gap-2">
                          <span className="w-[76px] text-[9px] font-bold tracking-widest text-white/50">
                            {row.label}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: spec.accent }}
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.round(spec.stats[row.key] * 100)}%` }}
                              transition={
                                reduceMotion
                                  ? { duration: 0.01 }
                                  : { delay: 0.15 + 0.06 * i, duration: 0.45, ease: 'easeOut' }
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {spec.breakPower > 0 && (
                      <div className="mt-2 text-[9px] font-bold tracking-wide text-orange-300">
                        💥 Crushes cracked barriers at speed
                      </div>
                    )}
                    {spec.id === 'glass' && (
                      <div className="mt-2 text-[9px] font-bold tracking-wide text-cyan-300/80">
                        ⚡ +30% top speed — but every wall is a ricochet
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
