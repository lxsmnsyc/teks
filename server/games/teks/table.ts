import { PAMATOS, getPamato } from '~/games/teks/data/pamatos';
import type { TeksMessage } from '~/games/teks/protocol';
import type { TableView, ThrowResult } from '~/games/teks/view';
import {
  COLOUR_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TEKS_RANGE,
  encodeFrames,
} from '~/games/teks/view';
import { BOT_NAMES } from './bot';
import type { Phase, RoundPiece } from '~/games/teks/rules/game';
import {
  defaultWager,
  livePlayers,
  pickLauncher,
  roundPieces,
} from '~/games/teks/rules/game';
import type {
  Player,
  RoundOutcome,
  Settlement,
} from '~/games/teks/rules/round';
import {
  PANABLA_ID,
  STARTING_TEKS,
  findGameWinner,
  judgeRound,
  maxWager,
  settleRound,
} from '~/games/teks/rules/round';
import {
  ARENA_HALF_SIZE,
  STACK_ORIGIN,
  TILT_MAX,
  TILT_MIN,
} from '~/games/teks/sim/constants';
import { runThrow } from '~/games/teks/sim/run';
import type { SimPiece, StackEntry } from '~/games/teks/sim/types';

/**
 * How long a decided round stays on screen once its replay has finished, in
 * milliseconds: the payout, the pieces going back into the hand, and a moment
 * to read who won before the next wager is asked for.
 */
const AFTER_ROUND_PAUSE = 5500;

const DEFAULT_TARGET = {
  x: 0,
  z: STACK_ORIGIN.z + (ARENA_HALF_SIZE - STACK_ORIGIN.z) * 0.6,
};

/** What a refused message looks like to the caller. */
export interface Refusal {
  refused: string;
}

function isRefusal(value: unknown): value is Refusal {
  return typeof value === 'object' && value !== null && 'refused' in value;
}

/**
 * One game of Teks, in one room.
 *
 * The table owns the game. Clients send what a person did, never what the
 * result was: the wager they typed, the stack they arranged, where they aimed.
 * The throw is simulated here and the outcome is told to everyone, so no
 * client is ever in a position to report its own result.
 */
export class Table {
  private players: Player[] = [];
  /** How many seats have ever been handed out, for naming the next one. */
  private seatsIssued = 0;
  private names = new Map<string, string>();
  private present = new Set<string>();
  /** Seats played by the machine rather than by someone on a socket. */
  private bots = new Set<string>();
  /**
   * Seats a person walked away from mid-game, which a bot is minding. The
   * person gets the seat back if they return.
   */
  private minded = new Set<string>();
  /** The seat that opened the table. It decides when the game starts. */
  private hostId = '';
  /** What everyone starts the game holding, which the host may change. */
  private startingTeks = STARTING_TEKS;
  /** Each player's chosen colour, as an index into the palette. */
  private colours = new Map<string, number>();
  private launcherId = '';
  private round = 1;
  private phase: Phase | 'waiting' = 'waiting';
  private wagers: Record<string, number> = {};
  private locked = new Set<string>();
  private stack: StackEntry[] = [];
  private tilt = Math.PI / 2;
  private target = { ...DEFAULT_TARGET };
  private outcome: RoundOutcome | null = null;
  private settlement: Settlement | null = null;
  private pending: Player[] | null = null;
  /** How long the last throw's replay runs, in seconds. */
  private replaySeconds = 0;

  /**
   * Takes a seat for a name, whether a person or a bot is going to play it.
   * Returns nothing if there is no room.
   */
  private seat(name: string): string | undefined {
    if (this.players.length >= MAX_PLAYERS) return undefined;

    const index = this.players.length;
    // Counted, never derived from how many are seated: people leave the
    // lobby, and an id worked out from the count would be handed out again
    // to whoever sat down next, leaving two players answering to one seat.
    this.seatsIssued += 1;
    const playerId = `seat-${this.seatsIssued}`;
    const pamatoId = PAMATOS[index % PAMATOS.length].id;
    this.players.push({
      id: playerId,
      name,
      teks: this.startingTeks,
      pamatoIds: [pamatoId],
      activePamatoId: pamatoId,
      eliminated: false,
    });
    this.names.set(playerId, name);
    this.colours.set(playerId, this.freeColour());
    return playerId;
  }

  /** The first colour nobody has taken. */
  private freeColour(): number {
    const taken = new Set(this.colours.values());
    for (let colour = 0; colour < COLOUR_COUNT; colour++) {
      if (!taken.has(colour)) return colour;
    }
    return 0;
  }

  /** Whether a seat is played by the machine. */
  isBot(playerId: string): boolean {
    return this.bots.has(playerId);
  }

  botSeats(): string[] {
    return [...this.bots];
  }

  /** Whether anybody still in the game is a person with a live connection. */
  hasLiveHuman(): boolean {
    return livePlayers(this.players).some(
      player => !this.bots.has(player.id) && this.present.has(player.id),
    );
  }

  /** Sits a bot down in a free seat. */
  addBot(): { playerId: string } | Refusal {
    if (this.phase !== 'waiting') {
      return { refused: 'bots can only be added before the game starts' };
    }
    const taken = new Set(this.names.values());
    const name = BOT_NAMES.find(candidate => !taken.has(candidate));
    if (!name) return { refused: 'no spare bot names' };

    const playerId = this.seat(name);
    if (!playerId) return { refused: 'the table is full' };

    this.bots.add(playerId);
    this.present.add(playerId);
    return { playerId };
  }

  /** Sends the most recently seated bot away again. */
  removeBot(): Refusal | undefined {
    if (this.phase !== 'waiting') {
      return { refused: 'bots can only leave before the game starts' };
    }
    const last = [...this.bots].pop();
    if (!last) return { refused: 'there are no bots at the table' };

    this.bots.delete(last);
    this.present.delete(last);
    this.names.delete(last);
    this.colours.delete(last);
    this.players = this.players.filter(player => player.id !== last);
    return undefined;
  }

  /**
   * Opens the game.
   *
   * Nothing starts on its own. An earlier version began the moment a third
   * player sat down, which made a game of four or more impossible to arrange:
   * the third arrival closed the door on everyone still coming. The host says
   * when, and until then people can keep joining, swapping colours and arguing
   * about the stake.
   */
  start(playerId: string): Refusal | undefined {
    if (this.phase !== 'waiting') return { refused: 'the game is under way' };
    if (playerId !== this.hostId) {
      return { refused: 'only the host starts the game' };
    }
    if (this.players.length < MIN_PLAYERS) {
      return { refused: `a game needs ${MIN_PLAYERS} players` };
    }
    if (!this.players.some(player => !this.bots.has(player.id))) {
      return { refused: 'a table of bots has nobody to play it' };
    }

    // Whatever the host settled on is what everyone actually starts with.
    this.players = this.players.map(player => ({
      ...player,
      teks: this.startingTeks,
    }));
    this.startGame();
    return undefined;
  }

  /** Seats a player, or gives them back the seat they had before. */
  join(name: string): { playerId: string } | Refusal {
    const existing = [...this.names.entries()].find(
      ([, taken]) => taken.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      const [playerId] = existing;
      if (this.minded.has(playerId)) {
        this.minded.delete(playerId);
        this.bots.delete(playerId);
        this.present.add(playerId);
        return { playerId };
      }
      if (this.present.has(playerId)) {
        return { refused: `${name} is already at the table` };
      }
      this.present.add(playerId);
      return { playerId };
    }

    if (this.phase !== 'waiting') {
      return { refused: 'the game has already started' };
    }
    const playerId = this.seat(name);
    if (!playerId) return { refused: 'the table is full' };

    this.present.add(playerId);
    // Whoever arrives first runs the table.
    if (!this.hostId || !this.players.some(p => p.id === this.hostId)) {
      this.hostId = playerId;
    }
    return { playerId };
  }

  /**
   * Someone left on purpose, rather than losing their connection.
   *
   * Before the game their seat is simply given up, so the lobby does not fill
   * with people who have gone. Once it is under way the seat stays in the
   * game and a bot plays it from here: pulling a player out would unbalance a
   * round in progress, and leaving the seat empty would stall every round
   * that needed them.
   */
  depart(playerId: string): void {
    if (this.bots.has(playerId)) return;

    if (this.phase === 'waiting') {
      this.disconnect(playerId);
      this.players = this.players.filter(player => player.id !== playerId);
      this.names.delete(playerId);
      this.colours.delete(playerId);
      this.present.delete(playerId);
      return;
    }

    this.bots.add(playerId);
    this.minded.add(playerId);
    this.present.add(playerId);
  }

  /** Whether anyone is here in person, playing or watching. */
  hasPresentHuman(): boolean {
    return this.players.some(
      player => !this.bots.has(player.id) && this.present.has(player.id),
    );
  }

  /** How the room looks from the list of open lobbies. */
  lobby(): {
    open: boolean;
    seated: number;
    capacity: number;
    hostName: string;
  } {
    return {
      open: this.phase === 'waiting' && this.players.length < MAX_PLAYERS,
      seated: this.players.length,
      capacity: MAX_PLAYERS,
      hostName: this.names.get(this.hostId) ?? '',
    };
  }

  /** The connection went away. The seat is kept for them to come back to. */
  disconnect(playerId: string): void {
    // A bot never leaves; its seat has nobody to come back to it.
    if (!this.bots.has(playerId)) this.present.delete(playerId);

    // Somebody has to be able to start the game, so if the host walks away
    // before it does, the job passes to whoever is still here.
    if (this.phase === 'waiting' && playerId === this.hostId) {
      const next = this.players.find(
        player => !this.bots.has(player.id) && this.present.has(player.id),
      );
      this.hostId = next?.id ?? '';
    }
  }

  private startGame(): void {
    this.round = 1;
    this.launcherId = pickLauncher(this.players, undefined, Math.random);
    this.beginRound(this.players);
  }

  private beginRound(next: Player[]): void {
    this.players = next;
    this.wagers = Object.fromEntries(
      livePlayers(next).map(player => [
        player.id,
        Math.min(defaultWager(next), player.teks),
      ]),
    );
    this.locked.clear();
    this.stack = roundPieces(next).map(piece => ({
      pieceId: piece.pieceId,
      flipped: false,
    }));
    this.tilt = Math.PI / 2;
    this.target = { ...DEFAULT_TARGET };
    this.outcome = null;
    this.settlement = null;
    this.pending = null;
    this.phase = findGameWinner(next) ? 'over' : 'wagering';
  }

  private pieces(): RoundPiece[] {
    return roundPieces(this.players);
  }

  private simPieces(): SimPiece[] {
    return this.pieces().map(piece => ({
      id: piece.pieceId,
      ownerId: piece.ownerId ?? PANABLA_ID,
      spec: getPamato(piece.pamatoId),
    }));
  }

  private player(playerId: string): Player | undefined {
    return this.players.find(player => player.id === playerId);
  }

  private isLauncher(playerId: string): boolean {
    return this.launcherId === playerId;
  }

  /**
   * Acts on something a player did.
   *
   * Every branch checks the phase and, where it matters, that the sender is
   * the launcher. A client can say anything; this is where it stops mattering
   * what it says.
   */
  async handle(
    playerId: string,
    message: TeksMessage,
  ): Promise<ThrowResult | Refusal | undefined> {
    const player = this.player(playerId);
    if (!player) return { refused: 'you are not at this table' };
    // Someone who is out still watches, and may still move the table on to
    // the next round or into a new game. They just cannot play.
    const spectating = message.type === 'next' || message.type === 'newGame';
    if (player.eliminated && !spectating) {
      return { refused: 'you are out of the game' };
    }

    switch (message.type) {
      case 'wager': {
        if (this.phase !== 'wagering') return { refused: 'not taking wagers' };
        if (this.locked.has(playerId)) {
          return { refused: 'your wager is already in' };
        }
        const most = maxWager(player);
        if (message.teks > most) {
          return { refused: `you only hold ${most} teks` };
        }
        this.wagers[playerId] = message.teks;
        return undefined;
      }

      case 'pamato': {
        if (this.phase !== 'wagering') {
          return { refused: 'pamatos are chosen before the stack is built' };
        }
        if (!player.pamatoIds.includes(message.pamatoId)) {
          return { refused: 'you do not own that pamato' };
        }
        player.activePamatoId = message.pamatoId;
        return undefined;
      }

      case 'wagersIn': {
        if (this.phase !== 'wagering') return { refused: 'not taking wagers' };
        this.locked.add(playerId);
        const waiting = livePlayers(this.players).filter(
          seat => !this.locked.has(seat.id),
        );
        if (waiting.length === 0) {
          this.stack = this.pieces().map(piece => ({
            pieceId: piece.pieceId,
            flipped: false,
          }));
          this.phase = 'stacking';
        }
        return undefined;
      }

      case 'stack': {
        if (this.phase !== 'stacking') return { refused: 'the stack is set' };
        if (!this.isLauncher(playerId)) {
          return { refused: 'only the launcher builds the stack' };
        }
        const wanted = new Set(this.pieces().map(piece => piece.pieceId));
        const given = message.stack.map(entry => entry.pieceId);
        if (
          given.length !== wanted.size ||
          given.some(id => !wanted.has(id)) ||
          new Set(given).size !== given.length
        ) {
          return { refused: 'that is not this round’s stack' };
        }
        this.stack = message.stack;
        return undefined;
      }

      case 'stackSet': {
        if (this.phase !== 'stacking') return { refused: 'the stack is set' };
        if (!this.isLauncher(playerId)) {
          return { refused: 'only the launcher sets the stack' };
        }
        this.phase = 'aiming';
        return undefined;
      }

      case 'stackBack': {
        if (this.phase !== 'aiming')
          return { refused: 'nothing to go back to' };
        if (!this.isLauncher(playerId)) {
          return { refused: 'only the launcher sets the stack' };
        }
        this.phase = 'stacking';
        return undefined;
      }

      case 'aim': {
        if (this.phase !== 'stacking' && this.phase !== 'aiming') {
          return { refused: 'not aiming' };
        }
        if (!this.isLauncher(playerId)) {
          return { refused: 'only the launcher aims' };
        }
        this.tilt = Math.min(Math.max(message.tilt, TILT_MIN), TILT_MAX);
        this.target = message.target;
        return undefined;
      }

      case 'throw': {
        if (this.phase !== 'aiming') return { refused: 'not ready to throw' };
        if (!this.isLauncher(playerId)) {
          return { refused: 'only the launcher throws' };
        }
        return await this.throwStack();
      }

      case 'next': {
        if (this.phase !== 'settled')
          return { refused: 'the round is not over' };
        this.advance();
        return undefined;
      }

      case 'addBot': {
        const seated = this.addBot();
        return isRefusal(seated) ? seated : undefined;
      }

      case 'removeBot':
        return this.removeBot();

      case 'startingTeks': {
        if (this.phase !== 'waiting') {
          return { refused: 'the stake is set before the game starts' };
        }
        if (playerId !== this.hostId) {
          return { refused: 'only the host sets the stake' };
        }
        this.startingTeks = Math.min(
          TEKS_RANGE.max,
          Math.max(TEKS_RANGE.min, message.teks),
        );
        this.players = this.players.map(seat => ({
          ...seat,
          teks: this.startingTeks,
        }));
        return undefined;
      }

      case 'colour': {
        if (this.phase !== 'waiting') {
          return { refused: 'colours are chosen before the game starts' };
        }
        const taken = [...this.colours.entries()].some(
          ([seat, colour]) => seat !== playerId && colour === message.colour,
        );
        if (taken) return { refused: 'somebody already has that colour' };
        this.colours.set(playerId, message.colour);
        return undefined;
      }

      case 'start':
        return this.start(playerId);

      case 'newGame': {
        if (this.phase !== 'over') return { refused: 'the game is still on' };
        this.players = this.players.map((seat, index) => {
          const pamatoId = PAMATOS[index % PAMATOS.length].id;
          return {
            ...seat,
            teks: this.startingTeks,
            pamatoIds: [pamatoId],
            activePamatoId: pamatoId,
            eliminated: false,
          };
        });
        this.startGame();
        return undefined;
      }
    }
  }

  private async throwStack(): Promise<ThrowResult> {
    this.phase = 'throwing';
    try {
      return await this.resolveThrow();
    } catch (error) {
      // Put the round back where it was rather than leave it half thrown.
      // Nothing moves on from 'throwing' by itself, so a failure that left
      // the phase there would hang the table for everyone.
      this.phase = 'aiming';
      this.outcome = null;
      this.settlement = null;
      this.pending = null;
      throw error;
    }
  }

  private async resolveThrow(): Promise<ThrowResult> {
    const pieces = this.pieces();
    const result = await runThrow({
      pieces: this.simPieces(),
      launch: {
        stack: this.stack,
        tilt: this.tilt,
        target: this.target,
        // The seed is issued here, never by the client, so a launcher cannot
        // keep throwing until they like what they get.
        seed: (Math.random() * 0xffffffff) >>> 0,
      },
    });
    // Replays are recorded at a steady 60 frames a second.
    this.replaySeconds = result.frameCount / 60;

    this.outcome = judgeRound(
      pieces.map((piece, index) => ({
        pieceId: piece.pieceId,
        ownerId: piece.ownerId,
        face: result.faces[index],
      })),
    );

    if (this.outcome.kind === 'winner') {
      const paid = settleRound(
        this.players,
        this.outcome.winners.map(winner => winner.playerId),
        this.wagers,
      );
      this.settlement = paid;
      this.pending = paid.players;
    }

    this.phase = 'settled';
    return {
      faces: result.faces,
      frameCount: result.frameCount,
      frames: encodeFrames(result.frames),
    };
  }

  /**
   * A decided round waiting to be moved on from, and how long to leave it.
   *
   * Nobody is asked to confirm the next round. The table moves on by itself
   * once everyone has had time to watch the throw land, see the teks change
   * hands and the pieces picked up. A tie is not included: the launcher throws
   * it again, when they are ready.
   */
  roundToMoveOn(): { round: number; waitMs: number } | null {
    if (this.phase !== 'settled' || this.outcome?.kind !== 'winner') {
      return null;
    }
    return {
      round: this.round,
      waitMs: this.replaySeconds * 1000 + AFTER_ROUND_PAUSE,
    };
  }

  /** Moves on from that round, if the table is still sitting on it. */
  moveOn(round: number): boolean {
    if (this.phase !== 'settled' || this.round !== round) return false;
    if (this.outcome?.kind !== 'winner') return false;
    this.advance();
    return true;
  }

  private advance(): void {
    const decided = this.outcome;
    if (!decided) return;

    if (decided.kind === 'rethrow') {
      this.outcome = null;
      this.settlement = null;
      this.stack = this.pieces().map(piece => ({
        pieceId: piece.pieceId,
        flipped: false,
      }));
      this.target = { ...DEFAULT_TARGET };
      this.phase = 'stacking';
      return;
    }

    const next = this.pending ?? this.players;
    this.launcherId = pickLauncher(
      next,
      decided.winners[0].playerId,
      Math.random,
    );
    this.round += 1;
    this.beginRound(next);
  }

  view(you: string): TableView {
    return {
      you,
      hostId: this.hostId,
      startingTeks: this.startingTeks,
      colours: Object.fromEntries(this.colours),
      launcherId: this.launcherId,
      round: this.round,
      phase: this.phase,
      players: this.players,
      present: [...this.present],
      wagers: this.wagers,
      locked: [...this.locked],
      stack: this.stack,
      tilt: this.tilt,
      target: this.target,
      pieces: this.pieces(),
      outcome: this.outcome,
      settlement: this.settlement,
      replaySeconds: this.replaySeconds,
      bots: [...this.bots],
    };
  }

  seats(): string[] {
    return this.players.map(player => player.id);
  }
}

export { isRefusal };
