import { WebSocketServer, WebSocket } from 'ws';
import { db, canAccessTrip } from './db/database';
import { consumeEphemeralToken } from './services/ephemeralTokens';
import { User } from './types';
import http from 'node:http';

interface NomadWebSocket extends WebSocket {
  isAlive: boolean;
}

// Room management: tripId -> Set<WebSocket>
const rooms = new Map<number, Set<NomadWebSocket>>();

// Track which rooms each socket is in
const socketRooms = new WeakMap<NomadWebSocket, Set<number>>();

/**
 * Who has a Studio book open, per journey — presence and pointers for
 * real-time co-editing. Separate from the trip rooms above: a book's
 * cursors are only of interest to whoever has that book open, not to every
 * contributor's other tabs.
 */
const bookRooms = new Map<number, Set<NomadWebSocket>>();
const socketBooks = new WeakMap<NomadWebSocket, Set<number>>();

// Track user info per socket
const socketUser = new WeakMap<NomadWebSocket, User>();

// Track unique socket ID
const socketId = new WeakMap<NomadWebSocket, number>();
let nextSocketId = 1;

let wss: WebSocketServer | null = null;

// Per-connection message rate limiting
const WS_MSG_LIMIT = 30;        // max messages
const WS_MSG_WINDOW = 10_000;   // per 10 seconds
const socketMsgCounts = new WeakMap<NomadWebSocket, { count: number; windowStart: number }>();

/**
 * A pointer ping arrives roughly 10 times a second while someone drags
 * inside a book — the general limit above would throttle editing solid
 * within 3 seconds. It gets its own, more generous budget and never touches
 * the shared one.
 */
const CURSOR_MSG_LIMIT = 20;    // max cursor pings
const CURSOR_MSG_WINDOW = 1_000; // per second
const socketCursorCounts = new WeakMap<NomadWebSocket, { count: number; windowStart: number }>();

/** Attaches a WebSocket server with JWT auth, room-based trip channels, and heartbeat keep-alive. */
function setupWebSocket(server: http.Server): void {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null;

  wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024, // 64 KB max message size
    verifyClient: allowedOrigins
      ? ({ origin }, cb) => {
          if (!origin || allowedOrigins.includes(origin)) cb(true);
          else cb(false, 403, 'Origin not allowed');
        }
      : undefined,
  });

  const HEARTBEAT_INTERVAL = 30000; // 30 seconds
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const nws = ws as NomadWebSocket;
      if (nws.isAlive === false) return nws.terminate();
      nws.isAlive = false;
      nws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const nws = ws as NomadWebSocket;
    // Extract token from query param
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      nws.close(4001, 'Authentication required');
      return;
    }

    const userId = consumeEphemeralToken(token, 'ws');
    if (!userId) {
      nws.close(4001, 'Invalid or expired token');
      return;
    }

    let user: User | undefined;
    user = db.prepare(
      'SELECT id, username, email, role, mfa_enabled FROM users WHERE id = ?'
    ).get(userId) as User | undefined;
    if (!user) {
      nws.close(4001, 'User not found');
      return;
    }
    const requireMfa = (db.prepare("SELECT value FROM app_settings WHERE key = 'require_mfa'").get() as { value: string } | undefined)?.value === 'true';
    const mfaOk = user.mfa_enabled === 1 || user.mfa_enabled === true;
    if (requireMfa && !mfaOk) {
      nws.close(4403, 'MFA required');
      return;
    }

    nws.isAlive = true;
    const sid = nextSocketId++;
    socketId.set(nws, sid);
    socketUser.set(nws, user);
    socketRooms.set(nws, new Set());
    nws.send(JSON.stringify({ type: 'welcome', socketId: sid }));

    nws.on('pong', () => { nws.isAlive = true; });

    socketMsgCounts.set(nws, { count: 0, windowStart: Date.now() });
    socketCursorCounts.set(nws, { count: 0, windowStart: Date.now() });

    nws.on('message', (data) => {
      let msg: {
        type: string;
        tripId?: number | string;
        journeyId?: number | string;
        spreadIndex?: number;
        x?: number | null;
        y?: number | null;
      };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // Malformed JSON, ignore
      }

      // Basic validation
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

      // Cursor pings get their own, tighter-windowed but higher-frequency
      // budget and skip the general counter entirely — see socketCursorCounts.
      if (msg.type === 'book:cursor') {
        const cursorRate = socketCursorCounts.get(nws);
        const cursorNow = Date.now();
        if (cursorNow - cursorRate.windowStart > CURSOR_MSG_WINDOW) {
          cursorRate.count = 1;
          cursorRate.windowStart = cursorNow;
        } else {
          cursorRate.count++;
          if (cursorRate.count > CURSOR_MSG_LIMIT) return; // drop silently, another ping is a beat away
        }

        if (!msg.journeyId) return;
        const journeyId = Number(msg.journeyId);
        const sid = socketId.get(nws);
        if (sid == null || !bookPeers(journeyId).some((p) => p.socketId === sid)) return;

        broadcastToBook(
          journeyId,
          {
            type: 'journey:book:cursor',
            socketId: sid,
            userId: user.id,
            spreadIndex: Math.max(0, Math.trunc(Number(msg.spreadIndex) || 0)),
            x: finiteOrNull(msg.x),
            y: finiteOrNull(msg.y),
          },
          sid,
        );
        return;
      }

      // Rate limiting (everything but book:cursor, which has its own budget above)
      const rate = socketMsgCounts.get(nws);
      const now = Date.now();
      if (now - rate.windowStart > WS_MSG_WINDOW) {
        rate.count = 1;
        rate.windowStart = now;
      } else {
        rate.count++;
        if (rate.count > WS_MSG_LIMIT) {
          nws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
          return;
        }
      }

      if (msg.type === 'join' && msg.tripId) {
        const tripId = Number(msg.tripId);
        // Verify the user has access to this trip
        if (!canAccessTrip(tripId, user.id)) {
          nws.send(JSON.stringify({ type: 'error', message: 'Access denied' }));
          return;
        }
        // Add to room
        if (!rooms.has(tripId)) rooms.set(tripId, new Set());
        rooms.get(tripId).add(nws);
        socketRooms.get(nws).add(tripId);
        nws.send(JSON.stringify({ type: 'joined', tripId }));
      }

      if (msg.type === 'leave' && msg.tripId) {
        const tripId = Number(msg.tripId);
        leaveRoom(nws, tripId);
        nws.send(JSON.stringify({ type: 'left', tripId }));
      }

      if (msg.type === 'book:join' && msg.journeyId) {
        const journeyId = Number(msg.journeyId);
        if (!Number.isFinite(journeyId) || !canAccessJourneyForWs(journeyId, user.id)) {
          nws.send(JSON.stringify({ type: 'error', message: 'Access denied' }));
          return;
        }
        joinBook(nws, journeyId);
        announceBookPeers(journeyId);
        nws.send(JSON.stringify({ type: 'book:joined', journeyId }));
      }

      if (msg.type === 'book:leave' && msg.journeyId) {
        const journeyId = Number(msg.journeyId);
        leaveBookRoom(nws, journeyId);
        announceBookPeers(journeyId);
        nws.send(JSON.stringify({ type: 'book:left', journeyId }));
      }
    });

    nws.on('close', () => {
      // Clean up all rooms this socket was in
      const myRooms = socketRooms.get(nws);
      if (myRooms) {
        for (const tripId of myRooms) {
          leaveRoom(nws, tripId);
        }
      }
      // A pointer left in a book it no longer has open belongs to nobody.
      for (const journeyId of leaveAllBooks(nws)) announceBookPeers(journeyId);
    });
  });

  console.log('WebSocket server attached at /ws');
}

function leaveRoom(ws: NomadWebSocket, tripId: number): void {
  const room = rooms.get(tripId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(tripId);
  }
  const myRooms = socketRooms.get(ws);
  if (myRooms) myRooms.delete(tripId);
}

// ── Studio books: presence and pointers ─────────────────────────────────
//
// Deliberately not routed through journeyService.ts's canAccessJourney: that
// module imports broadcastToUser from here, and importing it back would be a
// circular dependency. The two access checks are kept in step by hand.

function canAccessJourneyForWs(journeyId: number, userId: number): boolean {
  const own = db.prepare('SELECT 1 FROM journeys WHERE id = ? AND user_id = ?').get(journeyId, userId);
  if (own) return true;
  return !!db.prepare(
    'SELECT 1 FROM journey_contributors WHERE journey_id = ? AND user_id = ?'
  ).get(journeyId, userId);
}

interface BookPeer {
  socketId: number;
  userId: number;
  username: string;
  avatar?: string | null;
}

function joinBook(ws: NomadWebSocket, journeyId: number): void {
  if (!bookRooms.has(journeyId)) bookRooms.set(journeyId, new Set());
  bookRooms.get(journeyId).add(ws);
  if (!socketBooks.has(ws)) socketBooks.set(ws, new Set());
  socketBooks.get(ws).add(journeyId);
}

function leaveBookRoom(ws: NomadWebSocket, journeyId: number): void {
  const room = bookRooms.get(journeyId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) bookRooms.delete(journeyId);
  }
  socketBooks.get(ws)?.delete(journeyId);
}

/** Every book this socket had open — called when the connection goes. */
function leaveAllBooks(ws: NomadWebSocket): number[] {
  const mine = socketBooks.get(ws);
  if (!mine) return [];
  const left = [...mine];
  for (const journeyId of left) leaveBookRoom(ws, journeyId);
  return left;
}

/**
 * Who is in a book, by socket rather than by user — one person with two
 * tabs open is two pointers, and a list keyed by user could not say which
 * one moved.
 */
function bookPeers(journeyId: number): BookPeer[] {
  const room = bookRooms.get(journeyId);
  if (!room) return [];
  const peers: BookPeer[] = [];
  for (const ws of room) {
    if (ws.readyState !== 1) continue;
    const user = socketUser.get(ws);
    const sid = socketId.get(ws);
    if (!user || sid == null) continue;
    peers.push({ socketId: sid, userId: user.id, username: user.username, avatar: user.avatar ?? null });
  }
  return peers;
}

/** Send to everyone looking at a book, optionally excluding a socket. */
function broadcastToBook(journeyId: number, payload: Record<string, unknown>, excludeSid?: number): void {
  const room = bookRooms.get(journeyId);
  if (!room || room.size === 0) return;
  for (const ws of room) {
    if (ws.readyState !== 1) continue;
    if (excludeSid != null && socketId.get(ws) === excludeSid) continue;
    ws.send(JSON.stringify({ journeyId, ...payload }));
  }
}

/** The whole list, to everyone in the book including whoever just changed it. */
function announceBookPeers(journeyId: number): void {
  broadcastToBook(journeyId, { type: 'journey:book:peers', peers: bookPeers(journeyId) });
}

/**
 * A coordinate, or null for a pointer that has left the page. The null check
 * is explicit because `Number(null)` is 0, not NaN — leaving the page would
 * otherwise park everyone's arrow in the top-left corner of the spread.
 */
function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Broadcast an event to all sockets in a trip room, optionally excluding a socket.
 */
function broadcast(tripId: number | string, eventType: string, payload: Record<string, unknown>, excludeSid?: number | string): void {
  tripId = Number(tripId);
  const room = rooms.get(tripId);
  if (!room || room.size === 0) return;

  const excludeNum = excludeSid ? Number(excludeSid) : null;

  for (const ws of room) {
    if (ws.readyState !== 1) continue; // WebSocket.OPEN === 1
    // Exclude the specific socket that triggered the change
    if (excludeNum && socketId.get(ws) === excludeNum) continue;
    ws.send(JSON.stringify({ type: eventType, tripId, ...payload }));
  }
}

/** Send a message to all sockets belonging to a specific user (e.g., for trip invitations). */
function broadcastToUser(userId: number, payload: Record<string, unknown>, excludeSid?: number | string): void {
  if (!wss) return;
  const excludeNum = excludeSid ? Number(excludeSid) : null;
  for (const ws of wss.clients) {
    const nws = ws as NomadWebSocket;
    if (nws.readyState !== 1) continue;
    if (excludeNum && socketId.get(nws) === excludeNum) continue;
    const user = socketUser.get(nws);
    if (user?.id === userId) {
      nws.send(JSON.stringify(payload));
    }
  }
}

function getOnlineUserIds(): Set<number> {
  const ids = new Set<number>();
  if (!wss) return ids;
  for (const ws of wss.clients) {
    const nws = ws as NomadWebSocket;
    if (nws.readyState !== 1) continue;
    const user = socketUser.get(nws);
    if (user) ids.add(user.id);
  }
  return ids;
}

export { setupWebSocket, broadcast, broadcastToUser, getOnlineUserIds };
