// ═══════════════════════════════════════════════════════════════════
//  HOTDOG DROP — share helper.
//  One deep link, shareable from anywhere: the native share sheet on
//  phones (navigator.share), clipboard fallback on desktop. The link
//  lands recipients straight on the game intro via the `?game=hotdog`
//  param that DemoHub and HotdogDemo both honor.
// ═══════════════════════════════════════════════════════════════════

// /arena/hotdog is the dedicated share page (public/hotdog.html): it
// carries the game's own OG preview image, then redirects humans into
// /arena/?game=hotdog. Share THAT url so chat apps unfurl the poster.
export const hotdogShareUrl = (): string => `${window.location.origin}/arena/hotdog`;

export type ShareResult = 'shared' | 'copied' | 'failed';

/** Share the game (with a score brag when one is passed). */
export async function shareHotdog(score?: number): Promise<ShareResult> {
  const url = hotdogShareUrl();
  const text =
    score != null && score > 0
      ? `I caught ${score.toLocaleString()} chips in the Hotdog Parachute Drop! 🌭 Think you can beat me?`
      : `Catch falling hotdogs, pretzels and beer with Gretchen in the Hotdog Parachute Drop! 🌭`;

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Hotdog Parachute Drop', text, url });
      return 'shared';
    } catch (e) {
      // AbortError = user closed the sheet; treat as done, don't also copy.
      if ((e as DOMException)?.name === 'AbortError') return 'failed';
      // Anything else (e.g. NotAllowedError in odd contexts) → clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
