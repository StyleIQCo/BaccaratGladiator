# Baccarat Gladiator Cloud Backend

This backend adds:
- Cognito multi-device login
- `POST /hand-event` endpoint (authenticated, server-validated scoring)
- `GET /profile` endpoint (authenticated profile + sequence sync)
- `GET /leaderboard` endpoint (global leaderboard)

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

## Notes
- This version hardens scoring by validating hand events server-side.
- It still does not validate shoe randomness/deck integrity; move dealing server-side for maximum anti-cheat protection.
