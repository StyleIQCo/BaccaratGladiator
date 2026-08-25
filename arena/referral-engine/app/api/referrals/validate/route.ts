// ═══════════════════════════════════════════════════════════════════
//  POST /api/referrals/validate
//
//  Fires when the referee finishes Stage 1. Flips their PENDING
//  referral to COMPLETED and pays the referrer the big bounty.
//
//  ANTI-FRAUD, layered:
//  1. Identity — the referee is the SESSION user. The request body is
//     ignored entirely; nobody can complete someone else's referral.
//  2. Qualification — Stage-1 completion is verified against the
//     server-authoritative StageClear table (written by the game
//     engine on settle), never against a client claim.
//  3. Exactly-once — a conditional updateMany(PENDING → COMPLETED)
//     claims the referral atomically; racing duplicates see count 0.
//     The ledger's unique idemKey is the second, independent lock.
// ═══════════════════════════════════════════════════════════════════
import { prisma } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth';
import { REFERRER_BOUNTY_CHIPS, creditChips } from '@/lib/referral';

export async function POST(req: Request) {
  const refereeId = await getSessionUserId(req);
  if (!refereeId) {
    return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  // Layer 2 — has this player ACTUALLY cleared a stage?
  const stageClears = await prisma.stageClear.count({ where: { userId: refereeId } });
  if (stageClears < 1) {
    return Response.json({ error: 'NOT_QUALIFIED', detail: 'Stage 1 not cleared' }, { status: 409 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Layer 3 — atomic claim. Only one request can ever move this row
    // out of PENDING; everyone else gets count === 0 and no payout.
    const claimed = await tx.referral.updateMany({
      where: { refereeId, status: 'PENDING' },
      data: {
        status: 'COMPLETED',
        qualifiedAt: new Date(),
        referrerRewardClaimed: true, // bounty pays out right now, below
      },
    });
    if (claimed.count === 0) return null; // no referral, or already completed

    const referral = await tx.referral.findUnique({
      where: { refereeId },
      select: {
        id: true,
        referrerId: true,
        referee: { select: { handle: true } },
      },
    });
    if (!referral) return null; // unreachable after a successful claim

    const referrerBalance = await creditChips(tx, {
      userId: referral.referrerId,
      amount: REFERRER_BOUNTY_CHIPS,
      reason: 'REFERRAL_BOUNTY',
      idemKey: `referral:${referral.id}:bounty`,
      meta: { referralId: referral.id, refereeId },
    });

    return { referral, referrerBalance };
  });

  if (!result) {
    // Idempotent no-op: fine to call this on every Stage-1 clear.
    return Response.json({ rewarded: false });
  }

  // Feed for the ReferrerBountyModal — push it live over the gateway's
  // referral:qualified socket event, or serve it on the referrer's next
  // session bootstrap.
  return Response.json({
    rewarded: true,
    referralId: result.referral.id,
    referrerId: result.referral.referrerId,
    refereeHandle: result.referral.referee.handle,
    bounty: { chips: REFERRER_BOUNTY_CHIPS },
    referrerBalance: Number(result.referrerBalance),
  });
}
