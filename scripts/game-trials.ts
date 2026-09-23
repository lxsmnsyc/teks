/**
 * Plays whole games headlessly and checks the rules hold up.
 *
 * A round can be reasoned about on its own, but a game is a loop, and loops
 * are where the interesting failures live: chips appearing or vanishing in a
 * payout, a table that can never eliminate anybody, a pair of players who
 * throw forever without settling anything.
 *
 * Run it with `pnpm game:trials`.
 */
import { getPamato } from '~/games/teks/data/pamatos';
import {
  createPlayers,
  livePlayers,
  pickLauncher,
  roundPieces,
} from '~/games/teks/rules/game';
import type { Player } from '~/games/teks/rules/round';
import {
  STARTING_TEKS,
  findGameWinner,
  judgeRound,
  maxWager,
  needsPanabla,
  settleRound,
} from '~/games/teks/rules/round';
import { createRng } from '~/games/teks/sim/rng';
import { runThrow } from '~/games/teks/sim/run';
import {
  ARENA_HALF_SIZE,
  STACK_ORIGIN,
  TILT_MAX,
  TILT_MIN,
} from '~/games/teks/sim/constants';
import type { SimPiece } from '~/games/teks/sim/types';

const GAMES = Number(process.env.GAMES ?? 12);
/** A game that runs this long is not going to finish. */
const ROUND_CEILING = 400;

async function playGame(seats: number, rng: () => number) {
  let players: Player[] = createPlayers(seats);
  const bank = players.length * STARTING_TEKS;
  let launcher = pickLauncher(players, undefined, rng);
  let rounds = 0;
  let rethrows = 0;
  let panablaRounds = 0;

  while (!findGameWinner(players) && rounds < ROUND_CEILING) {
    rounds++;
    if (needsPanabla(players)) panablaRounds++;

    // Everyone stakes something they can cover.
    const alive = livePlayers(players);
    const wagers: Record<string, number> = {};
    for (const player of alive) {
      const most = maxWager(player);
      wagers[player.id] = Math.max(1, Math.ceil(rng() * Math.min(most, 25)));
    }

    const pieces = roundPieces(players);
    const simPieces: SimPiece[] = pieces.map(piece => ({
      id: piece.pieceId,
      ownerId: piece.ownerId ?? piece.pieceId,
      spec: getPamato(piece.pamatoId),
    }));

    const result = await runThrow({
      pieces: simPieces,
      launch: {
        stack: simPieces.map(piece => ({
          pieceId: piece.id,
          flipped: rng() < 0.5,
        })),
        tilt: TILT_MIN + rng() * (TILT_MAX - TILT_MIN),
        target: {
          x: (rng() - 0.5) * 2 * ARENA_HALF_SIZE,
          z:
            STACK_ORIGIN.z +
            (0.35 + rng() * 0.65) * (ARENA_HALF_SIZE - STACK_ORIGIN.z),
        },
        seed: (rng() * 0xffffffff) >>> 0,
      },
    });

    const outcome = judgeRound(
      pieces.map((piece, index) => ({
        pieceId: piece.pieceId,
        ownerId: piece.ownerId,
        face: result.faces[index],
      })),
    );

    if (outcome.kind === 'rethrow') {
      rethrows++;
      continue;
    }

    const settlement = settleRound(
      players,
      outcome.winners.map(winner => winner.playerId),
      wagers,
    );
    players = settlement.players;
    launcher = pickLauncher(players, outcome.winners[0].playerId, rng);

    const held = players.reduce((sum, player) => sum + player.teks, 0);
    if (held !== bank) {
      throw new Error(
        `round ${rounds}: ${held} teks in play but the game started with ${bank}`,
      );
    }
  }

  const winner = findGameWinner(players);
  const pamatos = players.reduce((n, p) => n + p.pamatoIds.length, 0);
  return { rounds, rethrows, panablaRounds, winner, launcher, pamatos };
}

const rng = createRng(0x7e5);
for (const seats of [3, 4, 5, 6]) {
  let finished = 0;
  let totalRounds = 0;
  let totalRethrows = 0;
  let totalPanabla = 0;
  let worst = 0;

  for (let game = 0; game < GAMES; game++) {
    const played = await playGame(seats, rng);
    if (played.winner) finished++;
    totalRounds += played.rounds;
    totalRethrows += played.rethrows;
    totalPanabla += played.panablaRounds;
    worst = Math.max(worst, played.rounds);
    if (played.pamatos !== seats) {
      throw new Error(
        `${seats} seats started with ${seats} pamatos but ended with ${played.pamatos}`,
      );
    }
  }

  console.log(
    `${seats} players: ${finished}/${GAMES} games reached a winner, ` +
      `rounds mean ${(totalRounds / GAMES).toFixed(0)} worst ${worst}, ` +
      `re-throws ${((totalRethrows / totalRounds) * 100).toFixed(0)}%, ` +
      `panabla rounds ${((totalPanabla / totalRounds) * 100).toFixed(0)}%`,
  );
}
