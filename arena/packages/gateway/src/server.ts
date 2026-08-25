// Stateless WS fan-out. Scale these horizontally to N. Each gateway SUBSCRIBEs
// to the engine's bus channels and relays every message to its connected sockets.
// It holds NO authoritative state — only a mirror of the latest round for bet
// gating. Kill a gateway anytime; clients reconnect to another and resync on the
// next broadcast (each state blob is self-contained).
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import {
  sub, data, creditChips, lbRoom, LB_CHANNEL, LORE_CHANNEL, getUnseenLore,
  type LbBusEnvelope, type LoreBusEnvelope,
} from '@bg/persistence';
import {
  Phase, ServerEvent, ClientEvent, PROTOCOL_VERSION,
  SocialServerEvent, SOCIAL_PROTOCOL_VERSION, type GameStatePayload,
} from '@bg/shared';
import { registerCashOut } from './handlers/cashout';
import { registerRain } from './handlers/rain';
import { registerChat } from './handlers/chat';
import { registerBets } from './handlers/bets';
import { registerLeaderboard } from './handlers/leaderboard';
import { registerLore } from './handlers/lore';
import { dropSocket } from './ratelimit';

const PORT = Number(process.env.PORT ?? 8080);
const http = createServer();
const io = new Server(http, { path: '/arena/ws', cors: { origin: false }, transports: ['websocket'] });

// Local mirror of the latest round — for bet gating only, never authoritative.
let currentRound = { roundId: '', betting: false };
const getRound = () => currentRound;

// ── Bus → clients fan-out ─────────────────────────────────────────────────
sub.subscribe('arena:state', 'arena:crash', 'arena:chat', 'arena:rain', LB_CHANNEL, LORE_CHANNEL);
sub.on('message', (channel, raw) => {
  switch (channel) {
    case 'arena:state': {
      const s = JSON.parse(raw) as GameStatePayload;
      currentRound = { roundId: s.roundId, betting: s.phase === Phase.BETTING };
      io.emit(ServerEvent.STATE, s);
      break;
    }
    case 'arena:crash': io.emit(ServerEvent.CRASH_TICK, JSON.parse(raw)); break;
    case 'arena:chat':  io.emit(ServerEvent.CHAT, JSON.parse(raw)); break;
    case 'arena:rain':  io.emit(ServerEvent.RAIN_START, JSON.parse(raw)); break;
    case LB_CHANNEL: {
      // Room-scoped: only sockets subscribed to this bracket receive it.
      const { kind, payload } = JSON.parse(raw) as LbBusEnvelope;
      const room = lbRoom(payload.seasonKey, payload.tier);
      io.to(room).emit(
        kind === 'rank_change'
          ? SocialServerEvent.LEADERBOARD_RANK_CHANGE
          : SocialServerEvent.LB_SCORE_TICK,
        payload,
      );
      break;
    }
    case LORE_CHANNEL: {
      // User-scoped: only the player who earned the collectible sees it.
      const { userId, payload } = JSON.parse(raw) as LoreBusEnvelope;
      io.to(`u:${userId}`).emit(SocialServerEvent.LORE_UNLOCK, payload);
      break;
    }
  }
});

// ── Per-connection wiring ─────────────────────────────────────────────────
io.on('connection', (socket: Socket) => {
  socket.on(ClientEvent.HELLO, async ({ clientSeed, protocolVersion, userId, name, tier, avatarKey, stageSlug }) => {
    if (protocolVersion !== PROTOCOL_VERSION) {
      return socket.emit(ServerEvent.ERROR, { code: 'PROTOCOL_MISMATCH', expected: PROTOCOL_VERSION });
    }
    // TODO: geo-block + responsible-play gate here (per CLAUDE.md / region-block).
    socket.data.userId = userId ?? socket.id;
    socket.data.name = name;
    // World-tour bracket + avatar for leaderboard attribution, and the
    // current stage for lore triggers (client-claimed for now; once
    // Cognito-verified profiles land, read these server-side).
    socket.data.tier = Math.min(10, Math.max(1, Math.floor(Number(tier)) || 1));
    socket.data.avatarKey = typeof avatarKey === 'string' ? avatarKey.slice(0, 32) : 'gladiator-01';
    socket.data.stageSlug = typeof stageSlug === 'string' ? stageSlug.slice(0, 40) : undefined;
    // Per-user room — user-scoped pushes (lore unlocks) address this, so
    // they reach the player on whichever gateway they're connected to.
    await socket.join(`u:${socket.data.userId}`);
    // Welcome stack: idempotent per userId — seeds new wallets exactly once.
    const balance = await creditChips(socket.data.userId, 1000, `welcome:${socket.data.userId}`);
    socket.emit(ServerEvent.BALANCE, { balance });
    // Replay any unlock cinematic the player never acked (killed app,
    // missed push). Postgres-backed; degrades to nothing without a DB.
    getUnseenLore(socket.data.userId)
      .then(unlocks => {
        if (unlocks.length) {
          socket.emit(SocialServerEvent.LORE_UNLOCK,
            { v: SOCIAL_PROTOCOL_VERSION, ts: Date.now(), unlocks });
        }
      })
      .catch(() => {});
    // Contribute to the pooled client seed for an upcoming round (capped list).
    if (typeof clientSeed === 'string' && clientSeed.length <= 128) {
      await data.lpush('arena:clientseeds:pending', clientSeed);
      await data.ltrim('arena:clientseeds:pending', 0, 49);
    }
  });

  registerBets(socket, getRound);
  registerCashOut(socket);
  registerRain(socket);
  registerChat(socket);
  registerLeaderboard(socket);
  registerLore(socket);

  socket.on('disconnect', () => dropSocket(socket.id));
});

http.listen(PORT, () => console.log(`[gateway] listening on :${PORT} (path /arena/ws)`));
