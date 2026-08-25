// ═══════════════════════════════════════════════════════════════════
//  POST /api/lore/settle
//
//  Fires after a baccarat hand resolves on the world tour. Checks the
//  settled hand against every still-locked collectible on that stage
//  and awards the matches — e.g. the player is on 'wild-west' AND just
//  won a TIE bet AND doesn't own the "Lone Star Sheriff's Badge" →
//  create the UserCollectible row and return the item + lore for the
//  unlock cinematic.
//
//  ANTI-FRAUD, layered (same doctrine as /api/referrals/validate):
//  1. Caller — hand facts (outcome, natural, streak) can't be verified
//     from Postgres, so ONLY the game server may attest them: this
//     route is service-to-service, gated by x-service-key. Browsers
//     never call it — they receive the result over the `lore:unlock`
//     socket push, or pull it from getUnseenLore on session bootstrap.
//     (In-process callers like the arena gateway skip HTTP entirely
//     and call evaluateLoreUnlocks directly at settle.)
//  2. Identity — the player is named by the attesting game server;
//     the row must exist. No session-cookie path exists here at all,
//     so a stolen browser session can't farm lore.
//  3. Exactly-once — the unique (userId, collectibleId) constraint is
//     the lock; a replayed settle awards nothing and returns [].
// ═══════════════════════════════════════════════════════════════════
import { prisma } from '@/lib/db';
import { evaluateLoreUnlocks, type HandSettleEvent, type LoreSide } from '@bg/persistence';

const SIDES: readonly LoreSide[] = ['player', 'banker', 'tie'];
const isSide = (v: unknown): v is LoreSide => SIDES.includes(v as LoreSide);

export async function POST(req: Request) {
  // Layer 1 — only the game server holds the key.
  const key = process.env.LORE_SERVICE_KEY;
  if (!key || req.headers.get('x-service-key') !== key) {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Partial<HandSettleEvent> | null;
  if (
    !body?.userId || !body.roundId || !body.stageSlug ||
    !isSide(body.bet?.side) || !isSide(body.hand?.outcome) ||
    typeof body.hand?.natural !== 'boolean'
  ) {
    return Response.json({ error: 'BAD_EVENT' }, { status: 400 });
  }

  // Layer 2 — the attested player must actually exist.
  const player = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
  if (!player) {
    return Response.json({ error: 'UNKNOWN_USER' }, { status: 404 });
  }

  // Layer 3 lives inside the store: the unique constraint makes
  // replayed settles award nothing.
  const unlocks = await evaluateLoreUnlocks({
    userId: body.userId,
    roundId: body.roundId,
    stageSlug: body.stageSlug,
    bet: { side: body.bet!.side, amount: Number(body.bet!.amount) || 0 },
    hand: { outcome: body.hand!.outcome, natural: body.hand!.natural },
    winStreak: typeof body.winStreak === 'number' ? body.winStreak : undefined,
    stageCleared: body.stageCleared === true,
  });

  // Feed for CollectibleUnlockModal — relay over the gateway's
  // `lore:unlock` socket event; a missed push is recovered by
  // getUnseenLore on the player's next session bootstrap.
  return Response.json({ unlocked: unlocks.length > 0, unlocks });
}
