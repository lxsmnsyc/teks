import * as v from 'valibot';

/**
 * What a client and the server say to each other about rooms.
 *
 * The platform knows about games, rooms and seats, and nothing about how any
 * game is played. Everything a game says travels inside a `game` envelope:
 * the platform checks who sent it and which room it belongs to, and the game
 * itself checks what it says. Adding a game adds a schema for its own
 * messages, not a change here.
 *
 * Everything arriving from a client is parsed before it is looked at. A client
 * is someone on the far end of a public URL, so its messages are input, not
 * instructions.
 */

/** The games the platform can host. */
export const GAME_IDS = ['teks'] as const;
export type GameId = (typeof GAME_IDS)[number];

export const RoomCodeSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toUpperCase(),
  v.length(6, 'a room code is six characters'),
  v.regex(/^[A-Z0-9]{6}$/, 'a room code is six letters and digits'),
);

export const NameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'a name cannot be empty'),
  v.maxLength(16, 'a name is at most sixteen characters'),
);

export const ClientMessageSchema = v.variant('type', [
  /** Asks for the public rooms that are still taking players. */
  v.object({
    type: v.literal('rooms'),
    game: v.picklist(GAME_IDS),
  }),
  /** Opens a new room and takes the first seat in it. */
  v.object({
    type: v.literal('host'),
    game: v.picklist(GAME_IDS),
    name: NameSchema,
    /** Whether the room is listed for anyone to find, or code only. */
    listed: v.boolean(),
  }),
  v.object({
    type: v.literal('join'),
    code: RoomCodeSchema,
    name: NameSchema,
  }),
  v.object({ type: v.literal('leave') }),
  /** Anything the game itself is told. The game checks the inside. */
  v.object({
    type: v.literal('game'),
    message: v.unknown(),
  }),
]);

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

/** A room as it appears in the list of open lobbies. */
export interface RoomSummary {
  code: string;
  game: GameId;
  hostName: string;
  seated: number;
  capacity: number;
}

/** The room a client is sitting in. */
export interface RoomInfo {
  code: string;
  game: GameId;
  listed: boolean;
}

export type ServerMessage =
  | { type: 'rooms'; game: GameId; rooms: RoomSummary[] }
  | { type: 'joined'; room: RoomInfo; you: string }
  | { type: 'left' }
  | { type: 'game'; message: { type: string } }
  | { type: 'refused'; reason: string };

/** Parses a raw frame from a client, or explains why it will not be acted on. */
export function readClientMessage(
  raw: string,
): { ok: true; message: ClientMessage } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'that was not valid JSON' };
  }

  const result = v.safeParse(ClientMessageSchema, parsed);
  if (!result.success) {
    return { ok: false, reason: result.issues[0]?.message ?? 'unusable' };
  }
  return { ok: true, message: result.output };
}
