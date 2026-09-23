import { PAMATOS, getPamato } from '~/data/pamatos';
import type { ClientMessage } from '~/net/protocol';
import type { TableView, ThrowResult } from '~/net/view';
import {
  COLOUR_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TEKS_RANGE,
  encodeFrames,
} from '~/net/view';
import { BOT_NAMES } from './bot';
import type { Phase, RoundPiece } from '~/rules/game';
import {
  defaultWager,
  livePlayers,
  pickLauncher,
  roundPieces,
} from '~/rules/game';
import type { Player, RoundOutcome, Settlement } from '~/rules/round';
import {
  PANABLA_ID,
  STARTING_TEKS,
  findGameWinner,
  judgeRound,
  maxWager,
  settleRound,
} from '~/rules/round';
import {
  ARENA_HALF_SIZE,
  STACK_ORIGIN,
  TILT_MAX,
  TILT_MIN,
} from '~/sim/constants';
import { runThrow } from '~/sim/run';
import type { SimPiece, StackEntry } from '~/sim/types';

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
 * The one game this server is hosting.
 *
 * There are no rooms. A host runs this, exposes it through a tunnel, and hands
 * out the link; anyone who opens the link still needs the join code, which is
 * printed where only the host can see it. That is the whole of the access
 * control, and it is deliberately the same shape as passing someone a code
 * across a table.
 *
 * The table owns the game. Clients send what a person did, never what the
 * result was: the wager they typed, the stack they arranged, where they aimed.
 * The throw is simulated here and the outcome is told to everyone, so no
 * client is ever in a position to report its own result.
 */
export class Table {
  readonly joinCode: string;

  private players: Player[] = [];
  private names = new Map<string, string>();
  private present = new Set<string>();
  /** Seats played by the machine rather than by someone on a socket. */
  private bots = new Set<string>();
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

  constructor(joinCode: string) {
    this.joinCode = joinCode;
  }

  /**
   * Takes a seat for a name, whether a person or a bot is going to play it.
   * Returns nothing if there is no room.
   */
  private seat(name: string): string | undefined {
    if (this.players.length >= MAX_PLAYERS) return undefined;

    const index = this.players.length;
    const playerId = `seat-${index + 1}`;
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

  leave(playerId: string): void {
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
    message: ClientMessage,
  ): Promise<ThrowResult | Refusal | undefined> {
    const player = this.player(playerId);
    if (!player) return { refused: 'you are not at this table' };
    if (player.eliminated) return { refused: 'you are out of the game' };

    switch (message.type) {
      case 'join':
        return undefined;

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
      joinCode: this.joinCode,
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
      bots: [...this.bots],
    };
  }

  seats(): string[] {
    return this.players.map(player => player.id);
  }
}

export { isRefusal };
