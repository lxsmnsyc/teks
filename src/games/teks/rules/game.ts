import { PAMATOS } from '~/games/teks/data/pamatos';
import type { Player } from './round';
import {
  PANABLA_ID,
  PANABLA_PAMATO,
  STARTING_TEKS,
  needsPanabla,
} from './round';

/** One piece taking part in a round, before it has been given a pamato spec. */
export interface RoundPiece {
  pieceId: string;
  /** Null for the panabla. */
  ownerId: string | null;
  pamatoId: string;
}

/** How a round is progressing. */
export type Phase =
  | 'wagering'
  | 'stacking'
  | 'aiming'
  | 'throwing'
  | 'replaying'
  | 'settled'
  | 'over';

export function createPlayers(count: number): Player[] {
  return Array.from({ length: count }, (_, index) => {
    const pamatoId = PAMATOS[index % PAMATOS.length].id;
    return {
      id: `seat-${index + 1}`,
      name: `Player ${index + 1}`,
      teks: STARTING_TEKS,
      pamatoIds: [pamatoId],
      activePamatoId: pamatoId,
      eliminated: false,
    };
  });
}

export function livePlayers(players: Player[]): Player[] {
  return players.filter(player => !player.eliminated);
}

/**
 * The pieces thrown this round: one per player still in the game, plus the
 * panabla once the table is down to two.
 *
 * A player who has won pamatos from others still throws only one piece. The
 * rest are theirs to choose from between rounds, not extra chances within a
 * round.
 */
export function roundPieces(players: Player[]): RoundPiece[] {
  const pieces: RoundPiece[] = livePlayers(players).map(player => ({
    pieceId: player.id,
    ownerId: player.id,
    pamatoId: player.activePamatoId,
  }));

  if (needsPanabla(players)) {
    pieces.push({
      pieceId: PANABLA_ID,
      ownerId: null,
      pamatoId: PANABLA_PAMATO,
    });
  }

  return pieces;
}

/**
 * Who throws next.
 *
 * The winner of a round throws the next one. The first launcher of a game, and
 * any launcher who has since been knocked out, is chosen at random from the
 * players still in.
 */
export function pickLauncher(
  players: Player[],
  previous: string | undefined,
  random: () => number,
): string {
  const alive = livePlayers(players);
  if (alive.length === 0) throw new Error('nobody is left to throw');

  if (previous && alive.some(player => player.id === previous)) return previous;
  return alive[Math.floor(random() * alive.length)].id;
}

/** A wager every player still in the game can actually cover. */
export function defaultWager(players: Player[]): number {
  const poorest = livePlayers(players).reduce(
    (least, player) => Math.min(least, player.teks),
    Number.POSITIVE_INFINITY,
  );
  return Math.max(1, Math.min(10, Math.floor(poorest / 4) || 1));
}
