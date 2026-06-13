"""
Server-side baccarat engine for tournament anti-cheat.

Mirrors the JavaScript engine in `road-to-macau.html` exactly, so the
server can replay a tournament submission deterministically from the
seed + the player's bet history and verify the claimed final balance.

Bit-perfect parity is verified by `tests/test_parity.py` and was
validated against a real JS shoe before this module shipped.

Public API:
    hash_string_to_seed(str) -> int      # FNV-1a 32-bit hash, matches JS
    mulberry32(seed) -> Callable[[], float]
    new_shoe(seed) -> List[str]          # 416 cards (8 decks shuffled)
    replay_tournament(seed, bets, opts) -> dict
        seed:  int (from hash_string_to_seed)
        bets:  list of per-hand bet dicts:
            { banker, player, tie, dragon7, panda8, pair_p, pair_b }
        opts:  { starting_balance: int, max_bet_per_circle: int }
        returns:
            { final_balance, hands_played, dragon7, panda8,
              ko_at_hand: Optional[int], invalid_at_hand: Optional[int] }
"""

from typing import Callable, List, Dict, Any

SUITS = ('♠', '♥', '♦', '♣')
RANKS = ('A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K')

# Bet circles allowed per hand. Server validates only these keys.
BET_KEYS = ('banker', 'player', 'tie', 'dragon7', 'panda8', 'pair_p', 'pair_b')


# ────────────────────────────────────────────────────────────────
# RNG — bit-perfect parity with the JS engine.
# ────────────────────────────────────────────────────────────────
def hash_string_to_seed(s: str) -> int:
    """FNV-1a 32-bit hash. Matches JS hashStringToSeed."""
    h = 2166136261
    for c in s:
        h ^= ord(c)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def mulberry32(seed: int) -> Callable[[], float]:
    """JS-compatible Mulberry32 PRNG. Returns a callable producing
    floats in [0, 1)."""
    state = [seed & 0xFFFFFFFF]

    def rng() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        z = state[0]
        z = ((z ^ (z >> 15)) * (z | 1)) & 0xFFFFFFFF
        z = (z ^ ((z + ((z ^ (z >> 7)) * (z | 61))) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((z ^ (z >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


def new_shoe(seed: int) -> List[str]:
    """Deterministic 8-deck shuffled shoe. Cards encoded as 'rank+suit'
    (e.g. 'A♠', 'T♥')."""
    rng = mulberry32(seed)
    cards = [r + s for _ in range(8) for s in SUITS for r in RANKS]
    # Fisher-Yates from end to start, matching JS Math.floor(rng() * (i+1))
    for i in range(len(cards) - 1, 0, -1):
        j = int(rng() * (i + 1))
        cards[i], cards[j] = cards[j], cards[i]
    return cards


# ────────────────────────────────────────────────────────────────
# Card utilities.
# ────────────────────────────────────────────────────────────────
def _rank_of(card: str) -> str:
    return card[0]


def _suit_of(card: str) -> str:
    return card[1]


def _card_value(card: str) -> int:
    r = card[0]
    if r == 'A':
        return 1
    if r in ('T', 'J', 'Q', 'K'):
        return 0
    return int(r)


def _hand_total(cards: List[str]) -> int:
    return sum(_card_value(c) for c in cards) % 10


def _banker_draws(b_total: int, p_third: str | None) -> bool:
    """EZ Baccarat / Punto Banco third-card rule for the banker."""
    if b_total >= 7:
        return False
    if b_total <= 2:
        return True
    if p_third is None:
        return b_total <= 5
    v = _card_value(p_third)
    if b_total == 3:
        return v != 8
    if b_total == 4:
        return 2 <= v <= 7
    if b_total == 5:
        return 4 <= v <= 7
    if b_total == 6:
        return v in (6, 7)
    return False


# ────────────────────────────────────────────────────────────────
# Single-hand resolver. Pulls cards off the front of `shoe` and
# returns the resolved hand outcome.
# ────────────────────────────────────────────────────────────────
def _deal_hand(shoe: List[str]) -> Dict[str, Any]:
    """Deal one full baccarat hand from the front of the shoe.
    Mutates shoe (cards consumed).

    Standard P, B, P, B alternating order — matches dealController.dealInitial()
    in road-to-macau.html. Getting this order right is critical for parity:
    if you deal P, P, B, B the cards are correctly counted toward each side
    but the SHOE is consumed in a different order, so all subsequent hands
    diverge from the JS engine."""
    if len(shoe) < 6:
        # Defensive — the tournament cap (80 hands × ~6 cards) leaves
        # generous margin in an 8-deck (416-card) shoe.
        raise ValueError('Shoe too thin to deal a hand')

    p1 = shoe.pop(0)
    b1 = shoe.pop(0)
    p2 = shoe.pop(0)
    b2 = shoe.pop(0)
    player = [p1, p2]
    banker = [b1, b2]
    p_total = _hand_total(player)
    b_total = _hand_total(banker)

    natural = p_total >= 8 or b_total >= 8
    if not natural:
        # Player draws on 0-5
        p_third = None
        if p_total <= 5:
            p_third = shoe.pop(0)
            player.append(p_third)
            p_total = _hand_total(player)
        # Banker draws per third-card rule
        if _banker_draws(b_total, p_third):
            banker.append(shoe.pop(0))
            b_total = _hand_total(banker)

    if p_total > b_total:
        winner = 'P'
    elif b_total > p_total:
        winner = 'B'
    else:
        winner = 'T'

    is_dragon7 = winner == 'B' and len(banker) == 3 and b_total == 7
    is_panda8  = winner == 'P' and len(player) == 3 and p_total == 8
    is_pair_p  = _rank_of(player[0]) == _rank_of(player[1])
    is_pair_b  = _rank_of(banker[0]) == _rank_of(banker[1])

    return {
        'player_cards': player,
        'banker_cards': banker,
        'p_total':      p_total,
        'b_total':      b_total,
        'winner':       winner,
        'is_dragon7':   is_dragon7,
        'is_panda8':    is_panda8,
        'is_pair_p':    is_pair_p,
        'is_pair_b':    is_pair_b,
    }


# ────────────────────────────────────────────────────────────────
# Bet validation + scoring. Mirrors the JS resolver in road-to-macau.html.
# ────────────────────────────────────────────────────────────────
def _normalize_bets(raw: Any) -> Dict[str, int]:
    """Coerce + validate a per-hand bet dict. Unknown keys are ignored,
    missing keys default to 0, and all values must be non-negative integers."""
    if not isinstance(raw, dict):
        raise ValueError('bet must be an object')
    out: Dict[str, int] = {}
    for k in BET_KEYS:
        v = raw.get(k, 0)
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            raise ValueError(f'bet.{k} must be a number')
        if n < 0:
            raise ValueError(f'bet.{k} cannot be negative')
        out[k] = n
    return out


def _score_hand(bets: Dict[str, int], outcome: Dict[str, Any]) -> int:
    """Return the cash returned to the bankroll for this hand
    (stake + winnings on a win, stake only on a push, 0 on a loss).
    EZ Baccarat: Banker 3-card 7 (Dragon 7) pushes the main banker bet."""
    winner    = outcome['winner']
    is_d7     = outcome['is_dragon7']
    is_p8     = outcome['is_panda8']
    is_pair_p = outcome['is_pair_p']
    is_pair_b = outcome['is_pair_b']

    returned = 0

    # Main bets
    if winner == 'T':
        returned += bets['tie'] * 9        # 8:1 + stake
        returned += bets['player']         # push
        returned += bets['banker']         # push
    elif winner == 'B':
        if is_d7:
            returned += bets['banker']     # EZ push on Dragon 7
        else:
            returned += bets['banker'] * 2 # 1:1 + stake
    elif winner == 'P':
        returned += bets['player'] * 2     # 1:1 + stake

    # EZ side bets
    if is_d7:
        returned += bets['dragon7'] * 41   # 40:1 + stake
    elif winner == 'T':
        returned += bets['dragon7']        # push (matches JS: dragon7Mult on tie = 1)
    if is_p8:
        returned += bets['panda8'] * 26    # 25:1 + stake
    elif winner == 'T':
        returned += bets['panda8']         # push

    # Pair side bets
    if is_pair_p:
        returned += bets['pair_p'] * 12    # 11:1 + stake
    if is_pair_b:
        returned += bets['pair_b'] * 12    # 11:1 + stake

    return returned


# ────────────────────────────────────────────────────────────────
# Full tournament replay.
# ────────────────────────────────────────────────────────────────
def replay_tournament(
    seed: int,
    bet_history: List[Dict[str, Any]],
    starting_balance: int = 10_000,
    max_bet_per_circle: int = 5_000,
) -> Dict[str, Any]:
    """Replay a tournament deterministically.

    Returns a dict with `valid` (bool), `final_balance`, per-hand counters,
    and (on failure) `error` + `invalid_at_hand` fields. The caller is
    responsible for trusting only `final_balance` from this function — the
    score in the player's submission is treated as untrusted input.
    """
    if not isinstance(bet_history, list) or not bet_history:
        return {
            'valid': False,
            'error': 'bet_history must be a non-empty list',
            'final_balance': starting_balance,
            'hands_played': 0,
            'dragon7': 0,
            'panda8': 0,
        }

    shoe = new_shoe(seed)
    balance = int(starting_balance)
    dragon7_hits = 0
    panda8_hits = 0

    for idx, raw_bets in enumerate(bet_history):
        try:
            bets = _normalize_bets(raw_bets)
        except ValueError as e:
            return {
                'valid': False,
                'error': str(e),
                'invalid_at_hand': idx + 1,
                'final_balance': balance,
                'hands_played': idx,
                'dragon7': dragon7_hits,
                'panda8': panda8_hits,
            }

        # Per-circle max bet (matches client cap; protects against runaway sizes)
        for k, v in bets.items():
            if v > max_bet_per_circle:
                return {
                    'valid': False,
                    'error': f'bet.{k} exceeds max ({max_bet_per_circle})',
                    'invalid_at_hand': idx + 1,
                    'final_balance': balance,
                    'hands_played': idx,
                    'dragon7': dragon7_hits,
                    'panda8': panda8_hits,
                }

        # Banker + player simultaneous bets are disallowed by client UX
        if bets['banker'] > 0 and bets['player'] > 0:
            return {
                'valid': False,
                'error': 'cannot bet banker and player simultaneously',
                'invalid_at_hand': idx + 1,
                'final_balance': balance,
                'hands_played': idx,
                'dragon7': dragon7_hits,
                'panda8': panda8_hits,
            }

        total_staked = sum(bets.values())
        if total_staked > balance:
            return {
                'valid': False,
                'error': f'bet exceeds balance (${total_staked} > ${balance})',
                'invalid_at_hand': idx + 1,
                'final_balance': balance,
                'hands_played': idx,
                'dragon7': dragon7_hits,
                'panda8': panda8_hits,
            }

        # Resolve the hand from the deterministic shoe
        outcome = _deal_hand(shoe)

        # Apply: stake leaves bankroll, winnings come back
        balance -= total_staked
        balance += _score_hand(bets, outcome)

        if outcome['is_dragon7']:
            dragon7_hits += 1
        if outcome['is_panda8']:
            panda8_hits += 1

    return {
        'valid': True,
        'final_balance': balance,
        'hands_played': len(bet_history),
        'dragon7': dragon7_hits,
        'panda8': panda8_hits,
    }
