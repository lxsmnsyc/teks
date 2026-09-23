import type { WebSocket } from 'ws';
import type {
  GameId,
  RoomInfo,
  RoomSummary,
  ServerMessage,
} from '~/platform/protocol';
import { GAMES } from './games';
import type { GameEvent, GameTable } from './games/types';
import { isRefusal } from './games/types';

/**
 * How long a room with nobody in it is kept, in milliseconds.
 *
 * Long enough to reload the page, lose the connection on a train, or have the
 * host restart their router, and come back to the same seat. Not so long that
 * abandoned rooms pile up.
 */
const EMPTY_ROOM_GRACE = 2 * 60 * 1000;

/** Most rooms the server will hold at once, so it cannot be filled up. */
const MOST_ROOMS = 500;

/** Six characters, no vowels, so a code can be read aloud without spelling. */
function makeCode(taken: (code: string) => boolean): string {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!taken(code)) return code;
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/**
 * One game being played, or waiting to be.
 *
 * A room knows who is connected and which seat each connection plays. It
 * passes their messages to the game, sends everyone the game's view of the
 * table after every change, and gives the game's bots their turns. It knows
 * nothing about how the game is played.
 */
export class Room {
  readonly table: GameTable;
  /** Each connection in the room, and the seat it plays. */
  readonly members = new Map<WebSocket, string>();
  private pumping = false;
  private emptySince: number | null = null;

  constructor(
    readonly code: string,
    readonly game: GameId,
    readonly listed: boolean,
  ) {
    this.table = GAMES[game].createTable();
  }

  info(): RoomInfo {
    return { code: this.code, game: this.game, listed: this.listed };
  }

  summary(): RoomSummary {
    const lobby = this.table.lobby();
    return {
      code: this.code,
      game: this.game,
      hostName: lobby.hostName,
      seated: lobby.seated,
      capacity: lobby.capacity,
    };
  }

  /** Whether it should appear in the list of open lobbies. */
  isOpen(): boolean {
    return (
      this.listed && this.table.lobby().open && this.table.hasPresentHuman()
    );
  }

  /** Seats a connection under a name. */
  admit(socket: WebSocket, name: string): string | undefined {
    const seat = this.table.join(name);
    if (isRefusal(seat)) {
      send(socket, { type: 'refused', reason: seat.refused });
      return undefined;
    }
    this.members.set(socket, seat.playerId);
    this.emptySince = null;
    send(socket, { type: 'joined', room: this.info(), you: seat.playerId });
    this.broadcast();
    void this.pumpBots();
    return seat.playerId;
  }

  /** A connection dropped. Its seat waits for it. */
  disconnect(socket: WebSocket): void {
    const seat = this.members.get(socket);
    if (!seat) return;
    this.members.delete(socket);
    this.table.disconnect(seat);
    this.afterDeparture();
  }

  /** Someone left on purpose. */
  depart(socket: WebSocket): void {
    const seat = this.members.get(socket);
    if (!seat) return;
    this.members.delete(socket);
    this.table.depart(seat);
    this.afterDeparture();
  }

  private afterDeparture(): void {
    if (!this.table.hasPresentHuman()) this.emptySince ??= Date.now();
    this.broadcast();
    void this.pumpBots();
  }

  /** Whether the room has been empty long enough to close. */
  isAbandoned(now: number): boolean {
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_GRACE;
  }

  async handle(socket: WebSocket, message: unknown): Promise<void> {
    const seat = this.members.get(socket);
    if (!seat) return;
    const outcome = await this.table.handle(seat, message);
    if (isRefusal(outcome)) {
      send(socket, { type: 'refused', reason: outcome.refused });
      return;
    }
    this.announce(outcome);
    // What a person just did is usually what a bot has been waiting for: the
    // last wager of the round, or the host starting the game. Without this the
    // bots sit still and the round never moves.
    void this.pumpBots();
  }

  /** Sends an event, if there is one, then everyone's view of the table. */
  private announce(event?: GameEvent): void {
    if (event) {
      for (const [socket] of this.members) {
        send(socket, { type: 'game', message: event });
      }
    }
    this.broadcast();
  }

  private broadcast(): void {
    for (const [socket, seat] of this.members) {
      send(socket, {
        type: 'game',
        message: { type: 'state', view: this.table.view(seat) } as GameEvent,
      });
    }
  }

  /**
   * Lets the bots take their turns.
   *
   * Only one of these runs at a time. A bot's move changes the table, which
   * would otherwise call back in here, and without the guard the same turn
   * would be played several times over.
   */
  private async pumpBots(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let guard = 0; guard < 64; guard++) {
        // A room nobody is watching does not play itself to the end.
        if (!this.table.hasPresentHuman()) break;
        const acted = await this.table.botTurn(event => this.announce(event));
        if (!acted) break;
      }
    } catch (error) {
      console.error(`room ${this.code}: a bot turn failed`, error);
    } finally {
      this.pumping = false;
    }
  }
}

/** Every room on the server, by code. */
export class Rooms {
  private rooms = new Map<string, Room>();
  /** Which room each connection is in, if any. */
  private where = new Map<WebSocket, Room>();

  constructor() {
    // Closing abandoned rooms is not urgent, so a slow sweep is enough.
    setInterval(() => this.sweep(), 30 * 1000).unref();
  }

  roomOf(socket: WebSocket): Room | undefined {
    return this.where.get(socket);
  }

  list(game: GameId): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(room => room.game === game && room.isOpen())
      .map(room => room.summary());
  }

  host(socket: WebSocket, game: GameId, name: string, listed: boolean): void {
    this.leave(socket);
    if (this.rooms.size >= MOST_ROOMS) {
      send(socket, {
        type: 'refused',
        reason: 'the server is full right now, try again in a bit',
      });
      return;
    }
    const code = makeCode(taken => this.rooms.has(taken));
    const room = new Room(code, game, listed);
    this.rooms.set(code, room);
    if (room.admit(socket, name)) this.where.set(socket, room);
    else this.rooms.delete(code);
  }

  join(socket: WebSocket, code: string, name: string): void {
    const room = this.rooms.get(code);
    if (!room) {
      send(socket, {
        type: 'refused',
        reason: 'there is no room with that code',
      });
      return;
    }
    if (this.where.get(socket) === room) return;
    this.leave(socket);
    if (room.admit(socket, name)) this.where.set(socket, room);
  }

  /** Leaves on purpose: the seat is given up, or handed to a bot. */
  leave(socket: WebSocket): void {
    const room = this.where.get(socket);
    if (!room) return;
    this.where.delete(socket);
    room.depart(socket);
  }

  /** The connection is gone; the seat waits for whoever comes back to it. */
  disconnect(socket: WebSocket): void {
    const room = this.where.get(socket);
    if (!room) return;
    this.where.delete(socket);
    room.disconnect(socket);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isAbandoned(now) && room.members.size === 0) {
        this.rooms.delete(code);
      }
    }
  }
}
