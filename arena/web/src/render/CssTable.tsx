// Lightweight 2D/CSS fallback when bandwidth is low. Renders the same hand the
// server broadcast — no video — so dropping video never desyncs the game loop.
import { useTheme } from '../context/ThemeContext';
import type { GameStatePayload } from '@bg/shared';

const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export function CssTable({ state }: { state: GameStatePayload | null }) {
  const { theme } = useTheme();
  if (!state?.hand) return <div className="css-table css-table--idle">Placing bets…</div>;
  const { player, banker, playerTotal, bankerTotal, outcome } = state.hand;
  const Card = ({ r, s }: { r: number; s: number }) => (
    <span className={`pip-card ${s === 1 || s === 2 ? 'red' : 'black'}`}>{RANKS[r]}{SUITS[s]}</span>
  );
  return (
    <div className="css-table" style={{ background: `linear-gradient(135deg,var(--bg1),var(--bg2))` }}>
      <img className="brand" src={theme?.logo} alt="" />
      <div className="hand player"><b>Player {playerTotal}</b>{player.map((c, i) => <Card key={i} {...c} />)}</div>
      <div className="hand banker"><b>Banker {bankerTotal}</b>{banker.map((c, i) => <Card key={i} {...c} />)}</div>
      <div className={`outcome ${outcome}`}>{outcome.toUpperCase()}</div>
    </div>
  );
}
