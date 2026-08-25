// ═══════════════════════════════════════════════════════════════════
//  useFishmonger — socket hook for the Weekly Fishmonger board.
//  Same conventions as useLiveLeaderboardSocket: connect to /arena/ws,
//  request on connect, heal by re-requesting a snapshot. No delta
//  stream — the board is weekly and low-churn, FT_GET is the refresh.
// ═══════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  SocialClientEvent, SocialServerEvent,
  type FishTossRunTokenPayload, type FishTossSnapshotPayload, type FishTossSubmitResultPayload,
} from '@bg/shared';

export function useFishmonger(opts: {
  meId: string;
  handle: string;
  avatarKey?: string;
  /** ws endpoint origin; defaults to same-origin (CloudFront routes /arena/ws) */
  url?: string;
  /** Demo mode: skip the socket entirely (the caller supplies canned data). */
  disabled?: boolean;
}) {
  const { meId, handle, avatarKey = 'gladiator-01', url, disabled } = opts;
  const [snap, setSnap] = useState<FishTossSnapshotPayload | null>(null);
  const [lastResult, setLastResult] = useState<FishTossSubmitResultPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const runIdRef = useRef<string | null>(null); // latest unconsumed run proof

  useEffect(() => {
    if (disabled) return;
    const socket = io(url ?? '/', { path: '/arena/ws', transports: ['websocket'] });
    socketRef.current = socket;
    const request = () => socket.emit(SocialClientEvent.FT_GET, { meId });

    socket.on('connect', () => { setConnected(true); request(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on(SocialServerEvent.FT_SNAPSHOT, (s: FishTossSnapshotPayload) => setSnap(s));
    socket.on(SocialServerEvent.FT_SUBMIT_RESULT, (r: FishTossSubmitResultPayload) => setLastResult(r));
    socket.on(SocialServerEvent.FT_RUN_TOKEN, (t: FishTossRunTokenPayload) => { runIdRef.current = t.runId; });

    return () => { socket.close(); socketRef.current = null; };
  }, [meId, url, disabled]);

  /** Call the moment a run begins — the server issues the single-use
   *  proof that ft:submit requires (wire it to FishTossChallenge's
   *  onRunStart). */
  const startRun = useCallback(() => {
    socketRef.current?.emit(SocialClientEvent.FT_RUN_START, { meId });
  }, [meId]);

  /** Report a finished run; the server replies with FT_SUBMIT_RESULT + a fresh snapshot. */
  const submit = useCallback((score: number) => {
    const runId = runIdRef.current ?? undefined;
    runIdRef.current = null; // single-use — a second submit needs a new run
    socketRef.current?.emit(SocialClientEvent.FT_SUBMIT, { score, runId, meId, handle, avatarKey });
  }, [meId, handle, avatarKey]);

  const refresh = useCallback(() => {
    socketRef.current?.emit(SocialClientEvent.FT_GET, { meId });
  }, [meId]);

  return { snap, lastResult, connected, startRun, submit, refresh };
}
