// Capture pipeline: ONE canvas draw function → poster PNG and a real
// 4.5s WebM recorded via captureStream + MediaRecorder. Sharing prefers
// the OS share sheet with files (that's where TikTok/Reels/IG live);
// falls back to a download + caption copy on desktop browsers.
import { renderShareFrame, shareCaption, type ClutchMoment } from './clutch';

const VIDEO_W = 720, VIDEO_H = 1280, DURATION_MS = 4_500, FPS = 30;

export async function renderPosterBlob(m: ClutchMoment): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d')!;
  renderShareFrame(ctx, canvas.width, canvas.height, 1, m);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** Replay the whole share-card timeline onto a canvas while recording it. */
export async function recordClutchVideo(m: ClutchMoment): Promise<Blob | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W; canvas.height = VIDEO_H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(FPS);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) return null;

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  return new Promise(resolve => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.start(250);
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / DURATION_MS;
      renderShareFrame(ctx, VIDEO_W, VIDEO_H, Math.min(1, t), m);
      if (t < 1.08) requestAnimationFrame(tick);   // hold the final frame a beat
      else rec.stop();
    };
    requestAnimationFrame(tick);
  });
}

export type ShareOutcome = 'shared' | 'downloaded' | 'copied' | 'failed';

/** Share ladder: OS sheet with video → OS sheet with poster → download + caption copy. */
export async function shareClutch(m: ClutchMoment, video: Blob | null): Promise<ShareOutcome> {
  const caption = shareCaption(m);
  const files: File[] = [];
  if (video) files.push(new File([video], 'clutch-moment.webm', { type: video.type }));
  else files.push(new File([await renderPosterBlob(m)], 'clutch-moment.png', { type: 'image/png' }));

  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, text: caption });
      return 'shared';
    } catch { /* dismissed — fall through */ }
  }
  try {
    const url = URL.createObjectURL(files[0]);
    const a = document.createElement('a');
    a.href = url; a.download = files[0].name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    await navigator.clipboard.writeText(caption).catch(() => {});
    return 'downloaded';
  } catch {
    try { await navigator.clipboard.writeText(caption); return 'copied'; }
    catch { return 'failed'; }
  }
}
