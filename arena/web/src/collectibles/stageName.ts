/** 'wild-west' → 'Wild West'. The arena bundle doesn't ship the full
 *  themes-extended registry, so display names are derived from the slug;
 *  swap for a real registry lookup if stage names ever diverge. */
export const stageNameFromSlug = (slug: string): string =>
  slug.split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
