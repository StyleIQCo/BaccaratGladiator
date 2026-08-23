// Subscribes to authoritative server state and exposes a LOCAL view that:
//  • corrects client/server clock drift (accurate countdowns),
//  • derives phase + seconds-remaining from server timestamps,
//  • NEVER advances phase on its own — the server is the only authority,
//  • re-verifies the provably-fair hand client-side on the PAYOUT reveal.
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Phase, ServerEvent, ClientEvent, PROTOCOL_VERSION, verifyRound,
  type GameStatePayload,
} from '@bg/shared';

export interface GameSyncView {
  connected: boolean;
  state: GameStatePayload | null;
  phase: Phase | null;
  secondsLeft: number;
  multiplier: number;
  crashed: boolean;
  verified: boolean | null;
  placeBet: (p: object) => void;
  cashOut: () => void;
}

export function useGameSync(url: string, clientSeed: string, identity: { userId?: string; name?: string } = {}): GameSyncView {
  const socketRef = useRef<Socket | null>(null);
  const driftRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameStatePayload | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    const socket = io(url, { path: '/arena/ws', transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(ClientEvent.HELLO, { clientSeed, protocolVersion: PROTOCOL_VERSION, ...identity });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(ServerEvent.STATE, (s: GameStatePayload) => {
      // Smooth drift with an EMA so countdowns don't jitter per packet.
      const instant = s.serverTimeNow - Date.now();
      driftRef.current = driftRef.current === 0 ? instant : driftRef.current * 0.8 + instant * 0.2;
      setState(s);

      if (s.phase === Phase.PAYOUT && s.fair.serverSeed && s.hand) {
        const res = verifyRound({
          serverSeed: s.fair.serverSeed, serverSeedHash: s.fair.serverSeedHash,
          clientSeed: s.fair.clientSeed, nonce: s.fair.nonce,
          expectedHand: {
            player: s.hand.player, banker: s.hand.banker,
            playerTotal: s.hand.playerTotal, bankerTotal: s.hand.bankerTotal,
            outcome: s.hand.outcome, natural: s.hand.natural,
          },
        });
        setVerified(res.ok);
      } else if (s.phase === Phase.BETTING) {
        setVerified(null);
      }
    });

    // Light high-freq crash channel — merge multiplier into existing state.
    socket.on(ServerEvent.CRASH_TICK, (s: GameStatePayload) => {
      setState(prev => (prev && prev.roundId === s.roundId ? { ...prev, crash: s.crash } : prev));
    });

    return () => { socket.close(); socketRef.current = null; };
  }, [url, clientSeed]);

  // Display-only countdown ticker; server remains authoritative.
  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => {
      const serverNow = Date.now() + driftRef.current;
      setSecondsLeft(Math.max(0, (state.phaseEndsAt - serverNow) / 1000));
    }, 100);
    return () => clearInterval(id);
  }, [state]);

  const placeBet = useCallback((p: object) => {
    socketRef.current?.emit(ClientEvent.PLACE_BET, { roundId: state?.roundId, ...p });
  }, [state?.roundId]);

  const cashOut = useCallback(() => {
    socketRef.current?.emit(ClientEvent.CASH_OUT, { roundId: state?.roundId });
  }, [state?.roundId]);

  return {
    connected, state,
    phase: state?.phase ?? null,
    secondsLeft,
    multiplier: state?.crash.multiplier ?? 1,
    crashed: state?.crash.crashed ?? false,
    verified, placeBet, cashOut,
  };
}
