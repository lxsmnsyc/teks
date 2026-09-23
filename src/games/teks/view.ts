import type { Phase, RoundPiece } from '~/games/teks/rules/game';
import type {
  Player,
  RoundOutcome,
  Settlement,
} from '~/games/teks/rules/round';
import type { Face, StackEntry } from '~/games/teks/sim/types';

/** How many players a game needs before it can start. */
export const MIN_PLAYERS = 3;
/** How many seats there are at most. */
export const MAX_PLAYERS = 6;

/** How many colours there are to choose between. */
export const COLOUR_COUNT = 6;

/** The range the host may set the starting bankroll to. */
export const TEKS_RANGE = { min: 10, max: 1000 };

/** Everything a client is told about the table. */
export interface TableView {
  /** Which seat this client is sitting in. */
  you: string;
  /** The seat that opened the table and decides when it starts. */
  hostId: string;
  /** What each player will start the game holding. */
  startingTeks: number;
  /** Colour chosen by each player, as an index into the palette. */
  colours: Record<string, number>;
  /** Whose turn it is to throw. */
  launcherId: string;
  round: number;
  phase: Phase | 'waiting';
  players: Player[];
  /** Player ids with a live connection. */
  present: string[];
  /** Player ids played by the machine. */
  bots: string[];
  wagers: Record<string, number>;
  /** Players who have said their wager is final. */
  locked: string[];
  stack: StackEntry[];
  tilt: number;
  target: { x: number; z: number };
  pieces: RoundPiece[];
  outcome: RoundOutcome | null;
  /**
   * How long the last throw takes to play back, in seconds. Anything that
   * moves the table on after a throw has to wait at least this long, or it
   * cuts the replay off while people are still watching it.
   */
  replaySeconds: number;
  settlement: Settlement | null;
}

export interface ThrowResult {
  faces: Face[];
  frameCount: number;
  /** The replay buffer, base64 of the underlying Float32Array bytes. */
  frames: string;
}

/** What the table tells its players, inside the platform's `game` envelope. */
export type TeksServerMessage =
  | { type: 'state'; view: TableView }
  | { type: 'result'; result: ThrowResult };

export function encodeFrames(frames: Float32Array): string {
  const bytes = new Uint8Array(
    frames.buffer,
    frames.byteOffset,
    frames.byteLength,
  );
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeFrames(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
