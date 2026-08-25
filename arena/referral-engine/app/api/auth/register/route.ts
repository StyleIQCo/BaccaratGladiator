// ═══════════════════════════════════════════════════════════════════
//  POST /api/auth/register
//
//  Creates the account and — when a valid referral code rides along —
//  pays the referee's Welcome Gift INSTANTLY and opens a PENDING
//  Referral against the referrer. Everything happens in one Prisma
//  interactive transaction: user row, referral row, balance bump, and
//  ledger row commit together or not at all.
//
//  Policy choices (deliberate):
//  · An invalid/expired code never fails signup — the funnel is sacred.
//    The response just reports referralApplied: false.
//  · The gift is paid at signup (viral hook); the big referrer bounty
//    waits for the Stage-1 anti-fraud bar in /api/referrals/validate.
//  · Referral.refereeId is @unique — one referral credit per account,
//    ever, enforced by the database, not by application code.
// ═══════════════════════════════════════════════════════════════════
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  WELCOME_GIFT_CHIPS,
  creditChips,
  generateReferralCode,
  resolveReferrer,
} from '@/lib/referral';

const HANDLE_RE = /^[a-zA-Z0-9_-]{3,20}$/;

interface RegisterBody {
  handle?: unknown;
  avatarKey?: unknown;
  referralCode?: unknown;
}

export async function POST(req: Request) {
  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const handle = typeof body.handle === 'string' ? body.handle.trim() : '';
  if (!HANDLE_RE.test(handle)) {
    return Response.json(
      { error: 'INVALID_HANDLE', detail: '3–20 chars: letters, digits, _ or -' },
      { status: 400 },
    );
  }
  const avatarKey = typeof body.avatarKey === 'string' ? body.avatarKey : 'gladiator-01';
  const codeInput =
    typeof body.referralCode === 'string' && body.referralCode.trim()
      ? body.referralCode.trim().toUpperCase()
      : null;

  // NOTE: put an IP/device rate limit in front of this route (WAF or
  // middleware). The Stage-1 bar stops bounty farming, but disposable
  // signups still pollute the funnel metrics.

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Mint the new player's own evergreen code. Collisions across the
      // User + BuddyPass namespaces are checked here; the @unique on
      // User.referralCode backstops any race between two signups.
      let ownCode = generateReferralCode();
      for (let i = 0; i < 5; i++) {
        const clash =
          (await tx.user.findUnique({ where: { referralCode: ownCode }, select: { id: true } })) ??
          (await tx.buddyPass.findUnique({ where: { code: ownCode }, select: { id: true } }));
        if (!clash) break;
        ownCode = generateReferralCode();
      }

      const user = await tx.user.create({
        data: { handle, avatarKey, referralCode: ownCode },
        select: { id: true, handle: true, referralCode: true, chips: true },
      });

      if (!codeInput) return { user, referral: null };

      const referrer = await resolveReferrer(tx, codeInput);
      // Self-referral is structurally impossible here (the account is
      // seconds old and owns neither code), but resolveReferrer still
      // guards expiry/exhaustion on passes.
      if (!referrer) return { user, referral: null };

      const referral = await tx.referral.create({
        data: {
          referrerId: referrer.referrerId,
          refereeId: user.id,
          passId: referrer.passId,
          codeUsed: codeInput,
          status: 'PENDING',
          refereeRewardClaimed: true, // gift pays out right now, below
        },
        select: { id: true },
      });

      // The instant Welcome Gift — idemKey makes replays impossible.
      const chipBalance = await creditChips(tx, {
        userId: user.id,
        amount: WELCOME_GIFT_CHIPS,
        reason: 'REFERRAL_WELCOME_GIFT',
        idemKey: `referral:${referral.id}:welcome`,
        meta: { referralId: referral.id, referrerId: referrer.referrerId, codeUsed: codeInput },
      });

      return { user: { ...user, chips: chipBalance }, referral: { id: referral.id } };
    });

    return Response.json(
      {
        userId: result.user.id,
        handle: result.user.handle,
        referralCode: result.user.referralCode, // their own code, for the invite loop
        chipBalance: Number(result.user.chips),
        referralApplied: result.referral !== null,
        welcomeGift: result.referral ? { chips: WELCOME_GIFT_CHIPS } : null,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Unique violation — in practice the handle; a referralCode race
      // lands here too, and the client may simply retry.
      return Response.json({ error: 'HANDLE_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
