import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { readClientMessage } from '~/platform/protocol';
import type { ServerMessage } from '~/platform/protocol';
import { Rooms } from './rooms';

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

const rooms = new Rooms();

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

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
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

    switch (message.type) {
      case 'rooms':
        send(socket, {
          type: 'rooms',
          game: message.game,
          rooms: rooms.list(message.game),
        });
        return;
      case 'host':
        rooms.host(socket, message.game, message.name, message.listed);
        return;
      case 'join':
        rooms.join(socket, message.code, message.name);
        return;
      case 'leave':
        rooms.leave(socket);
        send(socket, { type: 'left' });
        return;
      case 'game': {
        const room = rooms.roomOf(socket);
        if (!room) {
          send(socket, { type: 'refused', reason: 'you are not in a room' });
          return;
        }
        await room.handle(socket, message.message);
        return;
      }
    }
  };

  socket.on('message', raw => {
    // The socket API wants a synchronous listener; failures are reported to
    // the client that caused them rather than taking the server down.
    void onMessage(raw).catch((error: unknown) => {
      console.error('failed to handle a message', error);
      send(socket, { type: 'refused', reason: 'that could not be handled' });
    });
  });

  socket.on('close', () => rooms.disconnect(socket));
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
    console.log(
      `\n  Up${DEV ? ' in development' : ''} at http://localhost:${PORT}\n`,
    );
    console.log('  Open it, pick a game, and host a room. Share the room link');
    console.log('  or its code with whoever is playing.\n');
  });
}

await main();
