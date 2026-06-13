# Baccarat Gladiator Cloud Backend

This backend adds:
- Cognito multi-device login
- `POST /hand-event` endpoint (authenticated, server-validated scoring)
- `GET /profile` endpoint (authenticated profile + sequence sync)
- `GET /leaderboard` endpoint (global leaderboard)
- `POST /tournament/score` endpoint (authenticated, monthly tournament submission)
- `GET /tournament/leaderboard` endpoint (public, per-tournament leaderboard)

## 1) Deploy (AWS SAM)

From `aws_s3/backend`:

```bash
sam build
sam deploy --guided
```

Use these key deploy params:
- `CognitoDomainPrefix`: globally unique (for Hosted UI)
- `RedirectUri`: your hosted scoreboard URL (example: `https://your-domain/baccarat-scoreboard.html`)

## 2) Copy Outputs into Frontend

After deploy, grab stack outputs:
- `ApiBaseUrl`
- `CognitoDomain`
- `UserPoolClientId`

Then update `CLOUD_CONFIG` in `aws_s3/baccarat-scoreboard.html`:

```js
const CLOUD_CONFIG = {
  apiBaseUrl: 'https://...execute-api...amazonaws.com',
  cognitoDomain: 'https://<domain-prefix>.auth.<region>.amazoncognito.com',
  userPoolClientId: '<client-id>',
  redirectUri: window.location.origin + window.location.pathname
};
```

## 3) Cognito Username + Email

Template config uses:
- Username login enabled
- Email alias enabled
- Email verification enabled

Players can sign in with username or email on Hosted UI.

## 4) API Contract

### POST `/hand-event` (Auth required)
Body:
```json
{
  "seq": 17,
  "gameMode": "ez",
  "username": "Late Bet Larry",
  "email": "user@example.com",
  "bets": {
    "banker": 25,
    "player": 0,
    "tie": 0,
    "dragon7": 5,
    "panda8": 0,
    "bigTiger": 0,
    "smallTiger": 0,
    "tigerTie": 0
  },
  "playerCards": [{"rank":"4","suit":"♣"},{"rank":"A","suit":"♠"}],
  "bankerCards": [{"rank":"10","suit":"♦"},{"rank":"7","suit":"♥"},{"rank":"Q","suit":"♣"}]
}
```

Server recomputes third-card legality, winner, side-bet outcomes, and score delta.
Client-submitted totals are not trusted.

On sequence mismatch, API returns `409` with `expectedSeq` so the client can re-sync.

### GET `/profile` (Auth required)
Returns:
```json
{
  "username": "Late Bet Larry",
  "email": "user@example.com",
  "score": 1475,
  "topScore": 1600,
  "handCount": 17,
  "wins": 9,
  "ties": 2,
  "naturals": 1
}
```

### GET `/leaderboard?limit=20` (Public)
Returns:
```json
{
  "items": [
    {
      "username": "Player1",
      "topScore": 1750,
      "rounds": 40,
      "wins": 24,
      "ties": 5,
      "updatedAt": "..."
    }
  ]
}
```

### POST `/tournament/score` (Auth required)

Submits a finished monthly-tournament run. The deterministic shoe is
seeded from the tournament ID (`hash("bg-tournament-" + id)`), so every
player gets the same 80-hand sequence — only their bet decisions differ.

Body:
```json
{
  "tournament":   "2026-06",
  "finalBalance": 14750,
  "handsPlayed":  80,
  "dragon7":      2,
  "panda8":       1,
  "submittedAt":  "2026-06-12T19:42:11Z"
}
```

Behavior:
- One row per `(tournamentId, userSub)` — re-submissions only overwrite
  on a personal best.
- Tournament window must currently be open (1st 00:00 UTC → last day
  23:59 UTC); late submissions are rejected.
- Server sanity-checks `finalBalance` (0–5,000,000) and
  `handsPlayed` (1–100). Per-hand replay against the seeded shoe is
  noted as a future hardening step.

Returns:
```json
{
  "ok": true,
  "tournament": "2026-06",
  "finalBalance": 14750,
  "isNewBest": true,
  "priorBest": null,
  "rank": 17,
  "submittedAt": "..."
}
```

### GET `/tournament/leaderboard?id=YYYY-MM&limit=50` (Public)

Returns the leaderboard for a single monthly tournament, sorted by
`finalBalance` descending, with tie-breakers (fewer hands first, earliest
firstAt next).  `id` defaults to the current month if omitted.

```json
{
  "tournament": "2026-06",
  "count": 23,
  "items": [
    {
      "username":     "Late Bet Larry",
      "finalBalance": 47900,
      "handsPlayed":  80,
      "dragon7":      3,
      "panda8":       1,
      "updatedAt":    "..."
    }
  ]
}
```

## Notes
- Hand events validated server-side; tournament scores validated for
  range only in v1. Replay-validation against the seeded shoe is a
  v2 hardening item — gives full anti-cheat for tournaments.
- This version still doesn't validate shoe randomness/deck integrity
  for casual play; move dealing server-side for maximum anti-cheat.
