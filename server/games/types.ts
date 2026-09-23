/**
 * What the platform needs from a game in order to host it.
 *
 * A room holds one of these and knows nothing else about the game. It seats
 * people, passes their messages on, sends each of them the game's view of the
 * table, and lets the game's bots take their turns. Everything about how the
 * game is played stays behind this interface.
 */

/** What a refused request looks like. */
export interface Refusal {
  refused: string;
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && 'refused' in value;
}

/**
 * Something a game wants sent to everyone in the room, besides the new state
 * of the table. Teks uses it for a throw's replay, which is large and changes
 * once a round, so it is not part of every state message.
 */
export interface GameEvent {
  type: string;
}

export interface GameTable {
  /** Seats a person, or gives them back the seat they had. */
  join(name: string): { playerId: string } | Refusal;
  /** Their connection went away; the seat is kept for them. */
  disconnect(playerId: string): void;
  /** They left on purpose. */
  depart(playerId: string): void;
  /**
   * Acts on a message from a seated player. The message has not been checked
   * yet: the game parses it against its own schema first.
   */
  handle(
    playerId: string,
    message: unknown,
  ): Promise<GameEvent | Refusal | undefined>;
  /** The table as one player may see it. */
  view(playerId: string): unknown;
  /**
   * Plays the next bot move, if one is due, telling the room after each step
   * so the people watching see it happen. Resolves false when no bot had
   * anything to do.
   */
  botTurn(announce: (event?: GameEvent) => void): Promise<boolean>;
  /** Whether anyone is here in person, so the room is worth keeping. */
  hasPresentHuman(): boolean;
  /** How the room reads in the list of open lobbies. */
  lobby(): {
    open: boolean;
    seated: number;
    capacity: number;
    hostName: string;
  };
}

export interface GameServer {
  createTable(): GameTable;
}
