import { createSignal } from 'solid-js';
import type {
  ClientMessage,
  GameId,
  RoomInfo,
  RoomSummary,
  ServerMessage,
} from './protocol';

export type Status = 'connecting' | 'open' | 'closed';

/** A game's own message, as it arrives inside the platform's envelope. */
export interface GameMessage {
  type: string;
}

export interface Connection {
  status: () => Status;
  /** The room this client is sitting in, if any. */
  room: () => RoomInfo | null;
  /** The seat this client plays in that room. */
  you: () => string | null;
  /** The open lobbies last reported for a game. */
  rooms: () => RoomSummary[];
  /** The last thing the server refused to do, for showing to the player. */
  refusal: () => string | null;
  clearRefusal: () => void;
  /**
   * The latest message of a given type from the game in this room. A game
   * describes its table in full each time, so the latest is all it needs.
   */
  gameMessage: (type: string) => () => GameMessage | null;
  host: (game: GameId, name: string, listed: boolean) => void;
  join: (code: string, name: string) => void;
  leave: () => void;
  requestRooms: (game: GameId) => void;
  /** Sends something to the game in this room. */
  sendGame: (message: GameMessage) => void;
}

/**
 * The seat to take back after a reload or a dropped connection.
 *
 * Kept for the tab only. It is not an account: it is the code and the name
 * this tab last sat down with, so that coming back puts the player in the same
 * seat rather than on the menu.
 */
const SEAT_KEY = 'laro.seat';

interface SeatMemo {
  code: string;
  name: string;
}

function readSeat(): SeatMemo | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    return raw ? (JSON.parse(raw) as SeatMemo) : null;
  } catch {
    return null;
  }
}

function writeSeat(seat: SeatMemo | null): void {
  try {
    if (seat) sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    else sessionStorage.removeItem(SEAT_KEY);
  } catch {
    // Storage can be unavailable; the only cost is not rejoining on reload.
  }
}

/** The seat this tab last had, if it was in the given room. */
export function rememberedSeat(code: string): SeatMemo | null {
  const seat = readSeat();
  return seat?.code === code ? seat : null;
}

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

/**
 * The client's end of the connection.
 *
 * It holds no game state of its own. Everything shown comes from what the
 * server sends, and every action is a message describing what the player did,
 * never what the result was.
 */
export function createConnection(): Connection {
  const [status, setStatus] = createSignal<Status>('connecting');
  const [room, setRoom] = createSignal<RoomInfo | null>(null);
  const [you, setYou] = createSignal<string | null>(null);
  const [rooms, setRooms] = createSignal<RoomSummary[]>([]);
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const [latest, setLatest] = createSignal<Record<string, GameMessage>>({});

  let socket: WebSocket | undefined;
  const queued: ClientMessage[] = [];
  /** The name behind the host or join request that is on its way. */
  let pendingName = '';

  const send = (message: ClientMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      queued.push(message);
    }
  };

  const clearRoom = (): void => {
    setRoom(null);
    setYou(null);
    setLatest({});
  };

  const connect = (): void => {
    socket = new WebSocket(socketUrl());

    socket.addEventListener('open', () => {
      setStatus('open');
      // Back after a dropped connection: sit down in the same seat again.
      // The server kept it, and knows it by the name.
      const seat = readSeat();
      if (seat && room()?.code === seat.code) {
        socket?.send(
          JSON.stringify({ type: 'join', code: seat.code, name: seat.name }),
        );
      }
      for (const message of queued.splice(0)) {
        socket?.send(JSON.stringify(message));
      }
    });

    socket.addEventListener('close', () => {
      setStatus('closed');
      // The server may simply have restarted; keep trying rather than
      // stranding everyone on a dead page.
      setTimeout(connect, 1500);
    });

    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      switch (message.type) {
        case 'rooms':
          setRooms(message.rooms);
          break;
        case 'joined':
          if (room()?.code !== message.room.code) setLatest({});
          setRoom(message.room);
          setYou(message.you);
          setRefusal(null);
          if (pendingName) {
            writeSeat({ code: message.room.code, name: pendingName });
          }
          break;
        case 'left':
          writeSeat(null);
          clearRoom();
          break;
        case 'game':
          setLatest(current => ({
            ...current,
            [message.message.type]: message.message,
          }));
          break;
        case 'refused':
          setRefusal(message.reason);
          break;
      }
    });
  };

  connect();

  const cache = new Map<string, () => GameMessage | null>();

  return {
    status,
    room,
    you,
    rooms,
    refusal,
    clearRefusal: () => setRefusal(null),
    gameMessage: type => {
      let accessor = cache.get(type);
      if (!accessor) {
        accessor = () => latest()[type] ?? null;
        cache.set(type, accessor);
      }
      return accessor;
    },
    host: (game, name, listed) => {
      pendingName = name;
      setRefusal(null);
      send({ type: 'host', game, name, listed });
    },
    join: (code, name) => {
      pendingName = name;
      setRefusal(null);
      send({ type: 'join', code, name });
    },
    leave: () => {
      writeSeat(null);
      send({ type: 'leave' });
      clearRoom();
    },
    requestRooms: game => send({ type: 'rooms', game }),
    sendGame: message => send({ type: 'game', message }),
  };
}
