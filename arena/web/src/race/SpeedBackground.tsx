// ═══════════════════════════════════════════════════════════════════
//  SPEED BACKGROUND — the "camera is chasing them" illusion.
//
//  Three parallax layers of horizontal streaks fly right-to-left on a
//  raw canvas while the racers themselves (Framer Motion divs above)
//  crawl across a static frame. Budget rules that keep 60fps on phones:
//    • pools are allocated once per resize — the rAF loop never news
//      an object, only mutates x and recycles lines off the left edge,
//    • one fillStyle per layer, per-line variation via globalAlpha only,
//    • plain fillRect strokes (no paths, no gradients, no shadowBlur),
//    • DPR capped at 2 — a 3x panel quadruples pixels for zero gain.
//  `active` throttles a global speed scalar (idle drift on the selection
//  screen, full scream during the race) with an eased ramp so ignition
//  feels like a throttle, not a light switch. Reduced-motion users get
//  a single static frame and no loop at all.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';

interface Line {
  x: number;
  y: number;
  len: number;
  w: number;
  speed: number;  // per-line multiplier on the layer velocity
  alpha: number;
}

interface Layer {
  parallax: number;
  color: string;
  lines: Line[];
}

const LAYER_SPECS = [
  // far: dim violet slivers, slow — reads as distant stadium wall
  { parallax: 0.35, color: '#4a3d85', w: [1, 2] as const,  lenFrac: [0.04, 0.10] as const, alpha: [0.25, 0.5] as const, per: 9000 },
  // mid: brighter violet-blue
  { parallax: 0.65, color: '#8f7bff', w: [1, 3] as const,  lenFrac: [0.08, 0.18] as const, alpha: [0.3, 0.6] as const,  per: 12000 },
  // near: hot cyan-white streaks whipping past the lens
  { parallax: 1.0,  color: '#d9f9ff', w: [2, 4] as const,  lenFrac: [0.14, 0.32] as const, alpha: [0.5, 0.9] as const,  per: 16000 },
];

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export interface SpeedBackgroundProps {
  /** Full-speed when true; slow ambient drift when false. */
  active: boolean;
  className?: string;
}

export function SpeedBackground({ active, className = '' }: SpeedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let layers: Layer[] = [];

    const buildLayers = () => {
      layers = LAYER_SPECS.map(spec => ({
        parallax: spec.parallax,
        color: spec.color,
        lines: Array.from(
          { length: Math.min(60, Math.max(12, Math.round((width * height) / spec.per))) },
          (): Line => ({
            x: rand(0, width * 1.5),
            y: rand(0, height),
            len: rand(spec.lenFrac[0], spec.lenFrac[1]) * width,
            w: rand(spec.w[0], spec.w[1]),
            speed: rand(0.8, 1.6),
            alpha: rand(spec.alpha[0], spec.alpha[1]),
          }),
        ),
      }));
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildLayers(); // pool sizes track the visible area; resizes are rare
    };
    resize();

    const drawFrame = (throttle: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const layer of layers) {
        ctx.fillStyle = layer.color;
        for (const ln of layer.lines) {
          // streaks intensify with speed so the idle state stays subtle
          ctx.globalAlpha = ln.alpha * (0.35 + 0.65 * throttle);
          ctx.fillRect(ln.x, ln.y, ln.len, ln.w);
        }
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      drawFrame(0.4); // one calm static frame — no loop, no motion
      const ro = new ResizeObserver(() => { resize(); drawFrame(0.4); });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    let raf = 0;
    let last = performance.now();
    let throttle = 0; // eased 0→1 speed scalar

    const frame = (now: number) => {
      // clamp dt so a backgrounded tab doesn't teleport every line on resume
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const target = activeRef.current ? 1 : 0.12;
      throttle += (target - throttle) * Math.min(1, dt * 2.5);

      for (const layer of layers) {
        const v = width * 1.45 * layer.parallax * throttle; // px/s at this depth
        for (const ln of layer.lines) {
          ln.x -= v * ln.speed * dt;
          if (ln.x + ln.len < 0) {
            // recycle off-screen lines back past the right edge
            ln.x = width + rand(0, width * 0.5);
            ln.y = rand(0, height);
            ln.speed = rand(0.8, 1.6);
          }
        }
      }
      drawFrame(throttle);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
