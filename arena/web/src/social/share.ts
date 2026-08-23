// Native share with clipboard fallback — the same ladder the main game
// uses for "Share Your Streak". Returns what actually happened so
// buttons can flash "SHARED" vs "COPIED".
export async function shareOrCopy(text: string, url?: string): Promise<'shared' | 'copied' | 'failed'> {
  if ('share' in navigator) {
    try {
      await navigator.share({ text, url });
      return 'shared';
    } catch {
      /* user dismissed or unsupported payload — fall through to copy */
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
