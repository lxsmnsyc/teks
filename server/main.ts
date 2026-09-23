import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { JoinCodeSchema, readClientMessage } from '~/net/protocol';
import type { ServerMessage } from '~/net/view';
import { decide } from './bot';
import { Table, isRefusal } from './table';
import * as v from 'valibot';

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIR = resolve(process.cwd(), 'dist', 'client');
/** In development the client is built on demand instead of being served from disk. */
const DEV = process.env.DEV === '1';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/** Six characters, no vowels, so a code can be read aloud without spelling. */
function makeJoinCode(): string {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/**
 * Makes a code given on the command line usable, or refuses it.
 *
 * Everything a player sends is uppercased and has to be six of A-Z and 0-9
 * before it is even compared, so a code the server holds in any other shape
 * can never be matched: `JOIN_CODE=alexis` reads correctly in the banner and
 * is refused every time it is typed, with nothing to say why. Case is
 * forgiven, since a code is read aloud rather than spelled. Anything else is
 * rejected out loud at startup instead of failing silently later on.
 */
function joinCodeFrom(given: string): string {
  const code = given.trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(code)) return code;

  const made = makeJoinCode();
  console.warn(
    `\n  JOIN_CODE=${given} cannot be used: a join code is six letters or digits.` +
      `\n  Using ${made} instead.\n`,
  );
  return made;
}

const table = new Table(
  process.env.JOIN_CODE === undefined
    ? makeJoinCode()
    : joinCodeFrom(process.env.JOIN_CODE),
);

// Handy for playing alone: BOTS=2 seats two of them before anyone joins.
for (let i = 0; i < Number(process.env.BOTS ?? 0); i++) table.addBot();

/** Serves the built client, if it has been built. */
function serveBuilt(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  // Normalising first, then checking the prefix, keeps `..` out of the path.
  const wanted = normalize(join(CLIENT_DIR, decodeURIComponent(url.pathname)));
  const path =
    wanted.startsWith(CLIENT_DIR) &&
    existsSync(wanted) &&
    statSync(wanted).isFile()
      ? wanted
      : join(CLIENT_DIR, 'index.html');

  if (!existsSync(path)) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('The client has not been built yet. Run: pnpm build\n');
    return;
  }

  // The shell is never cached. Its own name never changes, so a browser that
  // holds on to it keeps serving an old build's script long after the server
  // has been rebuilt, and the player sees bugs that no longer exist. The
  // assets beside it carry a content hash in their names and may be kept for
  // as long as the browser likes.
  const html = extname(path) === '.html';
  response.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': html ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  createReadStream(path).pipe(response);
}

const http: Server = createServer();

const sockets = new Map<WebSocket, string>();

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcastState(): void {
  for (const [socket, playerId] of sockets) {
    send(socket, { type: 'state', view: table.view(playerId) });
  }
}

/**
 * Lets the bots take their turns.
 *
 * Bots are seats with nobody on a socket, so nothing would ever prompt them to
 * act. After every change to the table this looks for a bot whose move it is
 * and plays it out, pausing between steps so the people watching can follow
 * what happened rather than seeing a round resolve in one frame.
 *
 * Only one of these runs at a time. A bot's move changes the table, which
 * calls back in here, and without the guard the same turn would be played
 * several times over.
 */
let pumping = false;

async function pumpBots(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let guard = 0; guard < 64; guard++) {
      const acted = await playOneBotTurn();
      if (!acted) break;
    }
  } finally {
    pumping = false;
  }
}

async function playOneBotTurn(): Promise<boolean> {
  for (const playerId of table.botSeats()) {
    const steps = decide(table.view(playerId), playerId, Math.random);
    if (steps.length === 0) continue;

    for (const step of steps) {
      await wait(step.delay);
      const outcome = await table.handle(playerId, step.message);
      if (isRefusal(outcome)) break;
      if (outcome) {
        for (const [peer] of sockets) {
          send(peer, { type: 'result', result: outcome });
        }
      }
      broadcastState();
    }
    return true;
  }

  // Nobody left to press on with the round but the machine.
  if (!table.hasLiveHuman()) {
    const [first] = table.botSeats();
    if (first) {
      await wait(1400);
      const moved = await table.handle(first, { type: 'next' });
      if (!isRefusal(moved)) {
        broadcastState();
        return true;
      }
    }
  }

  return false;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The socket is attached by hand rather than handed the HTTP server, because
// in development Vite is also listening for upgrades on it for hot reloading.
// Each side takes the upgrades meant for it and leaves the rest alone.
const wss = new WebSocketServer({ noServer: true });

http.on('upgrade', (request, socket: Duplex, head) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname !== '/ws') return;
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', socket => {
  const onMessage = async (raw: unknown): Promise<void> => {
    const read = readClientMessage(
      typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString(),
    );
    if (!read.ok) {
      send(socket, { type: 'refused', reason: read.reason });
      return;
    }
    const message = read.message;
    const seated = sockets.get(socket);

    if (!seated) {
      if (message.type !== 'join') {
        send(socket, { type: 'refused', reason: 'join first' });
        return;
      }
      // The code is the whole of the door. Everything else is behind it.
      if (
        !v.is(JoinCodeSchema, message.code) ||
        message.code !== table.joinCode
      ) {
        // Said here and not to the client: the person at the far end is not in
        // the game yet, so they are told only that it was wrong. Whoever is
        // running the server can see both halves and sort it out.
        console.log(
          `refused a join: was sent ${message.code}, the code is ${table.joinCode}`,
        );
        send(socket, { type: 'refused', reason: 'that join code is wrong' });
        return;
      }

      const seat = table.join(message.name);
      if (isRefusal(seat)) {
        send(socket, { type: 'refused', reason: seat.refused });
        return;
      }

      sockets.set(socket, seat.playerId);
      send(socket, {
        type: 'welcome',
        you: seat.playerId,
        view: table.view(seat.playerId),
      });
      broadcastState();
      void pumpBots();
      return;
    }

    const outcome = await table.handle(seated, message);
    if (isRefusal(outcome)) {
      send(socket, { type: 'refused', reason: outcome.refused });
      return;
    }
    if (outcome) {
      for (const [peer] of sockets)
        send(peer, { type: 'result', result: outcome });
    }
    broadcastState();
    // What a person just did is usually what a bot has been waiting for: the
    // last wager of the round, or the host starting the game. Without this the
    // bots sit still and the round never moves.
    void pumpBots();
  };

  socket.on('message', raw => {
    // The socket API wants a synchronous listener; failures are reported to
    // the client that caused them rather than taking the server down.
    void onMessage(raw).catch((error: unknown) => {
      console.error('failed to handle a message', error);
      send(socket, { type: 'refused', reason: 'that could not be handled' });
    });
  });

  socket.on('close', () => {
    const seated = sockets.get(socket);
    if (seated) {
      table.leave(seated);
      sockets.delete(socket);
      broadcastState();
      void pumpBots();
    }
  });
});

/**
 * Starts the one server.
 *
 * There is a single process and a single port either way. In development the
 * client is compiled on demand by Vite running as middleware inside this
 * server, which keeps hot reloading without a second process and a proxy
 * bridging the two. In production the same server hands out the built files.
 */
async function main(): Promise<void> {
  if (DEV) {
    // Imported here so it is never loaded, or even required, in production.
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      server: { middlewareMode: true, ws: { server: http } },
      // 'custom' keeps Vite from reaching for an index.html that no longer
      // exists: in start mode the Solid plugin's own middleware renders the
      // document shell for HTML requests.
      appType: 'custom',
    });
    http.on('request', vite.middlewares);
  } else {
    http.on('request', serveBuilt);
  }

  http.listen(PORT, () => {
    const local = `http://localhost:${PORT}`;
    console.log(`\n  Teks is up${DEV ? ' in development' : ''}.\n`);
    console.log(`    Join code   ${table.joinCode}`);
    console.log(`    Open        ${local}/?code=${table.joinCode}`);
    console.log(`    Or share    ${local}  and read the code out\n`);
    console.log('  Set your own with JOIN_CODE=TEKS01 when starting.\n');
  });
}

await main();
