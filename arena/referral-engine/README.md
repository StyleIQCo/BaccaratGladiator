# Referral Engine — Double-Sided Viral Loop

Rewards both sides of an invite, weighted hard toward the referrer:

| Side     | Reward            | When                                            |
| -------- | ----------------- | ----------------------------------------------- |
| Referee  | **+10,000 chips** | Instantly at signup with a valid code           |
| Referrer | **+50,000 chips** | When the referee clears Stage 1 (anti-fraud bar) |

Amounts live in one place: `lib/referral.ts` (`WELCOME_GIFT_CHIPS`, `REFERRER_BOUNTY_CHIPS`).

## Layout

```
referral-engine/
  app/api/auth/register/route.ts       POST — create account, apply code, pay welcome gift
  app/api/referrals/validate/route.ts  POST — Stage-1 check, complete referral, pay bounty
  lib/db.ts                            Prisma singleton (hot-reload safe)
  lib/auth.ts                          session bridge (Cognito TODO + dev header escape hatch)
  lib/referral.ts                      economics, code gen, creditChips primitive
```

This folder is a **drop-in for a Next.js App Router app** — copy `app/` and `lib/`
into the Next project root (routes use the `@/lib/*` path alias). The Prisma schema
it targets is the arena's real one: `packages/persistence/prisma/schema.prisma`.

The frontend halves live with the rest of the Juicy-UI social layer:
`web/src/social/NewUserWelcomeModal.tsx` and `web/src/social/ReferrerBountyModal.tsx`
(both carry `'use client'` so they port to Next unchanged).

## Wiring checklist

1. **Migrate** — from `packages/persistence`:
   `npx prisma migrate dev --name referral-engine && npx prisma generate`
   (adds `User.referralCode`, `ChipTransaction` ledger, `ReferralStatus.COMPLETED`,
   makes `Referral.passId` optional, adds `Referral.codeUsed`).
2. **Auth** — implement `lib/auth.ts` against Cognito (`aws-jwt-verify`,
   map `sub` → `User.cognitoSub`). Until then, non-prod accepts an
   `x-dev-user-id` header so the flow is testable.
3. **Trigger** — call `POST /api/referrals/validate` from the server-side
   stage-settle path (or client fire-and-forget after Stage 1; the route is
   idempotent and verifies against `StageClear` regardless).
4. **Live push** — on `rewarded: true`, emit the gateway's
   `referral:qualified` socket event to the referrer so `ReferrerBountyModal`
   pops in real time; otherwise surface it on next session bootstrap.
5. **Redis mirror** — the arena's hot balance path reads Redis
   (`ledger.ts creditChips`). When these routes run alongside the live arena,
   mirror each credit into Redis with the same idemKey so the table HUD
   agrees with Postgres.
6. **Rate limit** — put an IP/device limiter in front of `/api/auth/register`.

## Integrity model (why this doesn't double-pay)

- Every credit = balance increment **+ ledger row in the same transaction**;
  `ChipTransaction.idemKey` is unique, so a replay throws and rolls back all of it.
- The bounty is claimed via conditional `updateMany(PENDING → COMPLETED)` —
  racing requests see `count === 0` and pay nothing.
- `Referral.refereeId` is `@unique` — one referral credit per account, ever,
  enforced by the database.
- The referee's identity comes from the session; Stage-1 completion is checked
  against the server-authoritative `StageClear` table, never a client claim.
- An invalid or expired code never fails signup — it just skips the gift
  (`referralApplied: false`).

## Follow-up

`BuddyPassModal` copy still advertises the old "5,000 chips + 5 gems both ways"
deal — update it (and `INVITE_TEXT`) to the 10k/50k economics before launch.
