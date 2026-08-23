// GenAI dealer-video render path (your existing .mp4 assets). Falls back to the
// poster while buffering; CssTable handles the no-bandwidth case upstream.
import { useTheme } from '../context/ThemeContext';
import type { GameStatePayload } from '@bg/shared';

export function VideoTable({ state }: { state: GameStatePayload | null }) {
  const { theme, stage } = useTheme();
  const cfg = theme?.stages[stage];
  return (
    <div className="video-table">
      <video
        src={cfg?.video}
        poster={cfg?.videoPoster}
        autoPlay muted loop playsInline
        // muted+playsInline so iOS Safari autoplays without a tap.
      />
      {state?.hand && <div className="video-overlay">{state.hand.outcome.toUpperCase()} · {state.hand.playerTotal}/{state.hand.bankerTotal}</div>}
    </div>
  );
}
