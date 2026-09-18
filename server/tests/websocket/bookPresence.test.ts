/**
 * TREK Studio book presence tests (Phase 5 — real-time co-editing).
 * Covers WSBOOK-001 to WSBOOK-009.
 *
 * Same harness as tests/websocket/connection.test.ts: a real HTTP server on
 * a random port, connected to via the `ws` library.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: (placeId: number) => {
      const place: any = db.prepare(`SELECT p.*, c.name as category_name, c.color as category_color, c.icon as category_icon FROM places p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`).get(placeId);
      if (!place) return null;
      const tags = db.prepare(`SELECT t.* FROM tags t JOIN place_tags pt ON t.id = pt.tag_id WHERE pt.place_id = ?`).all(placeId);
      return { ...place, category: place.category_id ? { id: place.category_id, name: place.category_name, color: place.category_color, icon: place.category_icon } : null, tags };
    },
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`SELECT t.id, t.user_id FROM trips t LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)`).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../src/db/database', () => dbMock);
vi.mock('../../src/config', () => ({
  JWT_SECRET: 'test-jwt-secret-for-trek-testing-only',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));

import { createApp } from '../../src/app';
import { createTables } from '../../src/db/schema';
import { runMigrations } from '../../src/db/migrations';
import { resetTestDb } from '../helpers/test-db';
import { createUser, createJourney } from '../helpers/factories';
import { loginAttempts, mfaAttempts } from '../../src/routes/auth';
import { setupWebSocket } from '../../src/websocket';
import { createEphemeralToken } from '../../src/services/ephemeralTokens';

let server: http.Server;
let wsUrl: string;

beforeAll(async () => {
  createTables(testDb);
  runMigrations(testDb);

  const app = createApp();
  server = http.createServer(app);
  setupWebSocket(server);

  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => err ? reject(err) : resolve())
  );
  testDb.close();
});

beforeEach(() => {
  resetTestDb(testDb);
  loginAttempts.clear();
  mfaAttempts.clear();
});

/** Buffered WebSocket wrapper that never drops messages — same shape as connection.test.ts. */
class WsClient {
  private ws: WebSocket;
  private buffer: any[] = [];
  private waiters: Array<(msg: any) => void> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(msg);
      } else {
        this.buffer.push(msg);
      }
    });
  }

  next(timeoutMs = 3000): Promise<any> {
    if (this.buffer.length > 0) return Promise.resolve(this.buffer.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(resolve);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error('Message timeout'));
      }, timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  send(msg: object) { this.ws.send(JSON.stringify(msg)); }
  close() { this.ws.close(); }

  waitFor(predicate: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
    const idx = this.buffer.findIndex(predicate);
    if (idx !== -1) return Promise.resolve(this.buffer.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      const handler = (msg: any) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        } else {
          this.buffer.push(msg);
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
    });
  }

  collectFor(ms: number): Promise<any[]> {
    return new Promise(resolve => {
      const msgs: any[] = [...this.buffer.splice(0)];
      const handleMsg = (msg: any) => msgs.push(msg);
      this.ws.on('message', (data) => handleMsg(JSON.parse(data.toString())));
      setTimeout(() => resolve(msgs), ms);
    });
  }
}

/**
 * book:join fires both `book:joined` (the direct reply) and
 * `journey:book:peers` (the room-wide announce) from inside the same
 * handler — same as upstream's gateway — so which one the socket sees
 * first is not a contract worth pinning down. Collect both and pick by type.
 */
async function collectN(client: WsClient, n: number): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < n; i++) out.push(await client.next());
  return out;
}

function connectWs(token?: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const url = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
    const ws = new WebSocket(url);
    const client = new WsClient(ws);
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
    ws.once('close', (code) => {
      if (code === 4001) reject(new Error(`WS closed with 4001`));
    });
  });
}

describe('WS Studio book presence', () => {
  it('WSBOOK-001 — joining a book you can access receives book:joined and the peer list', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const token = createEphemeralToken(user.id, 'ws')!;

    const client = await connectWs(token);
    try {
      await client.next(); // welcome

      client.send({ type: 'book:join', journeyId: journey.id });
      const msgs = await collectN(client, 2);
      const joined = msgs.find(m => m.type === 'book:joined');
      const peers = msgs.find(m => m.type === 'journey:book:peers');
      expect(joined?.journeyId).toBe(journey.id);
      expect(peers?.peers).toHaveLength(1);
      expect(peers?.peers[0].userId).toBe(user.id);
    } finally {
      client.close();
    }
  });

  it('WSBOOK-002 — joining a book without access receives an error and no peers message', async () => {
    const { user: owner } = createUser(testDb);
    const { user: outsider } = createUser(testDb);
    const journey = createJourney(testDb, owner.id);
    const token = createEphemeralToken(outsider.id, 'ws')!;

    const client = await connectWs(token);
    try {
      await client.next(); // welcome

      client.send({ type: 'book:join', journeyId: journey.id });
      const msg = await client.next();
      expect(msg.type).toBe('error');
      expect(msg.message).toMatch(/access denied/i);
    } finally {
      client.close();
    }
  });

  it('WSBOOK-003 — leaving a book updates the remaining peer\'s list', async () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    const journey = createJourney(testDb, a.id);
    testDb.prepare("INSERT INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, 'editor', ?)")
      .run(journey.id, b.id, Date.now());

    const tokenA = createEphemeralToken(a.id, 'ws')!;
    const tokenB = createEphemeralToken(b.id, 'ws')!;
    const clientA = await connectWs(tokenA);
    const clientB = await connectWs(tokenB);
    try {
      await clientA.next(); // welcome
      await clientB.next(); // welcome

      clientA.send({ type: 'book:join', journeyId: journey.id });
      await clientA.next(); // book:joined
      await clientA.next(); // peers (just A)

      clientB.send({ type: 'book:join', journeyId: journey.id });
      await clientB.next(); // book:joined
      await clientB.next(); // peers (A + B)

      // A gets an updated peers list too, now that B joined.
      const peersAfterBJoins = await clientA.next();
      expect(peersAfterBJoins.type).toBe('journey:book:peers');
      expect(peersAfterBJoins.peers).toHaveLength(2);

      clientB.send({ type: 'book:leave', journeyId: journey.id });
      const left = await clientB.next();
      expect(left.type).toBe('book:left');

      const peersAfterBLeaves = await clientA.next();
      expect(peersAfterBLeaves.type).toBe('journey:book:peers');
      expect(peersAfterBLeaves.peers).toHaveLength(1);
      expect(peersAfterBLeaves.peers[0].userId).toBe(a.id);
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it('WSBOOK-004 — a cursor ping is forwarded to other peers, excluding the sender', async () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    const journey = createJourney(testDb, a.id);
    testDb.prepare("INSERT INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, 'editor', ?)")
      .run(journey.id, b.id, Date.now());

    const tokenA = createEphemeralToken(a.id, 'ws')!;
    const tokenB = createEphemeralToken(b.id, 'ws')!;
    const clientA = await connectWs(tokenA);
    const clientB = await connectWs(tokenB);
    try {
      await clientA.next(); // welcome
      await clientB.next(); // welcome

      clientA.send({ type: 'book:join', journeyId: journey.id });
      await clientA.next(); // book:joined
      await clientA.next(); // peers

      clientB.send({ type: 'book:join', journeyId: journey.id });
      await clientB.next(); // book:joined
      await clientB.next(); // peers
      await clientA.next(); // peers (updated for A now that B joined)

      clientA.send({ type: 'book:cursor', journeyId: journey.id, spreadIndex: 1, x: 12.5, y: 40.25 });

      const cursor = await clientB.waitFor((m: any) => m.type === 'journey:book:cursor');
      expect(cursor.userId).toBe(a.id);
      expect(cursor.spreadIndex).toBe(1);
      expect(cursor.x).toBe(12.5);
      expect(cursor.y).toBe(40.25);

      // The sender itself must not get its own pointer echoed back.
      const selfEcho = await clientA.collectFor(300);
      expect(selfEcho.find((m: any) => m.type === 'journey:book:cursor')).toBeUndefined();
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it('WSBOOK-005 — a cursor ping from a socket that never joined the book is dropped', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const token = createEphemeralToken(user.id, 'ws')!;

    const client = await connectWs(token);
    try {
      await client.next(); // welcome
      // No book:join — send a cursor straight away.
      client.send({ type: 'book:cursor', journeyId: journey.id, spreadIndex: 0, x: 1, y: 1 });

      const msgs = await client.collectFor(300);
      expect(msgs.find((m: any) => m.type === 'journey:book:cursor')).toBeUndefined();
    } finally {
      client.close();
    }
  });

  it('WSBOOK-006 — disconnecting removes the peer from the room and announces the new list', async () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    const journey = createJourney(testDb, a.id);
    testDb.prepare("INSERT INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, 'editor', ?)")
      .run(journey.id, b.id, Date.now());

    const tokenA = createEphemeralToken(a.id, 'ws')!;
    const tokenB = createEphemeralToken(b.id, 'ws')!;
    const clientA = await connectWs(tokenA);
    const clientB = await connectWs(tokenB);
    try {
      await clientA.next(); // welcome
      await clientB.next(); // welcome

      clientA.send({ type: 'book:join', journeyId: journey.id });
      await clientA.next(); // book:joined
      await clientA.next(); // peers

      clientB.send({ type: 'book:join', journeyId: journey.id });
      await clientB.next(); // book:joined
      await clientB.next(); // peers
      await clientA.next(); // peers (A + B)

      clientB.close();

      const peersAfterDisconnect = await clientA.waitFor((m: any) => m.type === 'journey:book:peers' && m.peers.length === 1);
      expect(peersAfterDisconnect.peers[0].userId).toBe(a.id);
    } finally {
      clientA.close();
    }
  });

  it('WSBOOK-007 — the same user with two tabs open counts as two peers, keyed by socket', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const token1 = createEphemeralToken(user.id, 'ws')!;
    const token2 = createEphemeralToken(user.id, 'ws')!;

    const client1 = await connectWs(token1);
    const client2 = await connectWs(token2);
    try {
      await client1.next(); // welcome
      await client2.next(); // welcome

      client1.send({ type: 'book:join', journeyId: journey.id });
      await client1.next(); // book:joined
      await client1.next(); // peers (1)

      client2.send({ type: 'book:join', journeyId: journey.id });
      const msgs = await collectN(client2, 2);
      const peers = msgs.find(m => m.type === 'journey:book:peers');
      expect(peers?.peers).toHaveLength(2);
      expect(peers.peers.map((p: any) => p.socketId).length).toBe(new Set(peers.peers.map((p: any) => p.socketId)).size);
    } finally {
      client1.close();
      client2.close();
    }
  });

  it('WSBOOK-008 — a cursor leaving the page (null x/y) is forwarded as null, not coerced to 0', async () => {
    const { user: a } = createUser(testDb);
    const { user: b } = createUser(testDb);
    const journey = createJourney(testDb, a.id);
    testDb.prepare("INSERT INTO journey_contributors (journey_id, user_id, role, added_at) VALUES (?, ?, 'editor', ?)")
      .run(journey.id, b.id, Date.now());

    const tokenA = createEphemeralToken(a.id, 'ws')!;
    const tokenB = createEphemeralToken(b.id, 'ws')!;
    const clientA = await connectWs(tokenA);
    const clientB = await connectWs(tokenB);
    try {
      await clientA.next(); // welcome
      await clientB.next(); // welcome

      clientA.send({ type: 'book:join', journeyId: journey.id });
      await clientA.next(); // book:joined
      await clientA.next(); // peers

      clientB.send({ type: 'book:join', journeyId: journey.id });
      await clientB.next(); // book:joined
      await clientB.next(); // peers
      await clientA.next(); // peers

      clientA.send({ type: 'book:cursor', journeyId: journey.id, spreadIndex: 0, x: null, y: null });
      const cursor = await clientB.waitFor((m: any) => m.type === 'journey:book:cursor');
      expect(cursor.x).toBeNull();
      expect(cursor.y).toBeNull();
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it('WSBOOK-009 — cursor pings never count against the general 30/10s rate limit', async () => {
    const { user } = createUser(testDb);
    const journey = createJourney(testDb, user.id);
    const token = createEphemeralToken(user.id, 'ws')!;

    const client = await connectWs(token);
    try {
      await client.next(); // welcome
      client.send({ type: 'book:join', journeyId: journey.id });
      await client.next(); // book:joined
      await client.next(); // peers

      // Far more than WS_MSG_LIMIT (30) — would trip the general limiter if
      // cursor pings shared its counter.
      for (let i = 0; i < 40; i++) {
        client.send({ type: 'book:cursor', journeyId: journey.id, spreadIndex: 0, x: i, y: i });
      }

      const msgs = await client.collectFor(800);
      expect(msgs.find((m: any) => m.type === 'error' && m.message?.includes('Rate limit'))).toBeUndefined();
    } finally {
      client.close();
    }
  });
});
