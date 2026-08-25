// ═══════════════════════════════════════════════════════════════════
//  REFERRAL ENGINE — economics, code generation, and the one true way
//  chips get credited (balance bump + ledger row in the SAME txn).
// ═══════════════════════════════════════════════════════════════════
import { randomInt } from 'node:crypto';
import type { ChipTxReason, Prisma } from '@prisma/client';

// ── Economics — double-sided, heavily referrer-weighted ─────────────
export const WELCOME_GIFT_CHIPS = 10_000; // referee, instantly at signup
export const REFERRER_BOUNTY_CHIPS = 50_000; // referrer, when referee clears Stage 1

// ── Code generation ─────────────────────────────────────────────────
// Matches the BuddyPass "GLAD-7F3K" look. Alphabet drops 0/O, 1/I/L —
// these codes get read aloud over voice chat and typed from screenshots.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateReferralCode(): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `GLAD-${suffix}`;
}

// ── Referrer resolution ─────────────────────────────────────────────
// Personal codes and BuddyPass tickets share one namespace at the URL /
// signup-form level, so both tables are consulted. Personal code wins;
// pass redemption bumps `uses` and enforces expiry/exhaustion.

export async function resolveReferrer(
  tx: Prisma.TransactionClient,
  code: string,
): Promise<{ referrerId: string; passId: string | null } | null> {
  const owner = await tx.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
  if (owner) return { referrerId: owner.id, passId: null };

  const pass = await tx.buddyPass.findUnique({ where: { code } });
  if (!pass) return null;
  if (pass.expiresAt && pass.expiresAt < new Date()) return null;
  if (pass.uses >= pass.maxUses) return null;

  await tx.buddyPass.update({
    where: { id: pass.id },
    data: { uses: { increment: 1 } },
  });
  return { referrerId: pass.ownerId, passId: pass.id };
}

// ── The single chip-credit primitive ────────────────────────────────
// Balance increment and ledger append happen on the SAME transaction
// client, so they commit or roll back together. The unique idemKey is
// the exactly-once guarantee: a replayed credit throws P2002, which
// aborts the surrounding $transaction — a reward physically cannot pay
// twice, even across racing requests or a retried Lambda.

export async function creditChips(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    amount: number;
    reason: ChipTxReason;
    idemKey: string;
    meta?: Prisma.InputJsonValue;
  },
): Promise<bigint> {
  const { chips } = await tx.user.update({
    where: { id: args.userId },
    data: { chips: { increment: args.amount } },
    select: { chips: true },
  });

  await tx.chipTransaction.create({
    data: {
      userId: args.userId,
      amount: BigInt(args.amount),
      balanceAfter: chips,
      reason: args.reason,
      idemKey: args.idemKey,
      meta: args.meta,
    },
  });

  return chips;
}
