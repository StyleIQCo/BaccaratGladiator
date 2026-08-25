// ═══════════════════════════════════════════════════════════════════
//  LUCKY NUMEROLOGY — default amounts for bonuses/hongbao.
//  8 (八 ≈ 发, "prosper") is auspicious; 4 (四 ≈ 死, "death") never
//  appears in a player-facing amount. The DB mirrors this with a
//  CHECK constraint on Referral.hongbaoValue — see the
//  20260825000000_hongbao_referrals migration.
// ═══════════════════════════════════════════════════════════════════

export const LUCKY_AMOUNTS = {
  WELCOME_BONUS: 8_888,
  HONGBAO_DEFAULT: 8_888,
  HONGBAO_VIP: 88_888,
  STREAK_TOPUP: 888,
} as const;

/** Positive integer containing no digit 4. */
export const isLuckyAmount = (n: number): boolean =>
  Number.isInteger(n) && n > 0 && !String(n).includes('4');

/** Coerce an arbitrary amount to a lucky one: every digit 4 becomes an 8.
 *  Only ever rounds UP in spirit (4→8), so promos can't shortchange anyone. */
export const toLuckyAmount = (n: number): number =>
  Number(String(Math.max(1, Math.round(n))).replace(/4/g, '8'));

/** Grouped display: 8888 → "8,888" (grouping is shared by en and zh). */
export const formatChips = (n: number, locale = 'en'): string =>
  new Intl.NumberFormat(locale).format(n);

/** Dev-only tripwire for hardcoded unlucky amounts sneaking into UI. */
export function warnIfUnlucky(n: number, where: string): void {
  if (import.meta.env.DEV && !isLuckyAmount(n)) {
    console.warn(`[lucky] ${where}: ${n} contains a 4 — use toLuckyAmount() or a LUCKY_AMOUNTS constant`);
  }
}
