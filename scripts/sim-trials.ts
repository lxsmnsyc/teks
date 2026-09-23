/**
 * Runs a lot of throws headlessly and reports what came out.
 *
 * This is the cheapest way to catch the failure modes that are invisible in a
 * single throw in the browser: pieces that never settle, pieces that tunnel
 * out of the arena, a resting face that is not close to an even split, and a
 * stack position that quietly confers an advantage.
 *
 * Run it with `pnpm sim:trials`.
 */
import { PAMATOS } from '~/games/teks/data/pamatos';
import { judgeRound } from '~/games/teks/rules/round';
import {
  ARENA_HALF_SIZE,
  STACK_ORIGIN,
  TILT_MAX,
  TILT_MIN,
} from '~/games/teks/sim/constants';
import { runThrow } from '~/games/teks/sim/run';
import type { SimPiece, StackEntry } from '~/games/teks/sim/types';

const RUNS = Number(process.env.RUNS ?? 300);

function spec(id: string) {
  const found = PAMATOS.find(pamato => pamato.id === id);
  if (!found) throw new Error(`unknown pamato "${id}"`);
  return found;
}

async function trial(
  ids: string[],
  options: { flipped?: boolean[]; label?: string; tilt?: number } = {},
): Promise<void> {
  const pieces: SimPiece[] = ids.map((id, index) => ({
    id: `p${index}`,
    ownerId: `p${index}`,
    spec: spec(id),
  }));
  const stack: StackEntry[] = pieces.map((piece, index) => ({
    pieceId: piece.id,
    flipped: options.flipped?.[index] ?? false,
  }));

  const wins = ids.map(() => 0);
  let unique = 0;
  let minority = 0;
  let edgeNudges = 0;
  let recoveries = 0;
  let timeouts = 0;
  let steps = 0;
  const upCounts = ids.map(() => 0);
  const started = Date.now();

  for (let run = 0; run < RUNS; run++) {
    const result = await runThrow({
      pieces,
      launch: {
        stack,
        tilt: options.tilt ?? TILT_MIN + Math.random() * (TILT_MAX - TILT_MIN),
        target: {
          x: (Math.random() - 0.5) * ARENA_HALF_SIZE,
          z:
            STACK_ORIGIN.z +
            (0.35 + Math.random() * 0.6) * (ARENA_HALF_SIZE - STACK_ORIGIN.z),
        },
        seed: (Math.random() * 0xffffffff) >>> 0,
      },
    });

    result.faces.forEach((face, index) => {
      if (face === 'up') upCounts[index]++;
    });
    edgeNudges += result.edgeResolutions;
    recoveries += result.recoveries;
    steps += result.steps;
    if (result.timedOut) timeouts++;

    const outcome = judgeRound(
      pieces.map((piece, index) => ({
        pieceId: piece.id,
        ownerId: piece.ownerId,
        face: result.faces[index],
      })),
    );
    if (outcome.kind === 'winner') {
      if (outcome.by === 'unique') unique++;
      else minority++;
      for (const winner of outcome.winners) {
        wins[pieces.findIndex(piece => piece.id === winner.playerId)]++;
      }
    }
  }

  const percent = (value: number) => Math.round((value / RUNS) * 100);
  console.log(
    [
      (options.label ?? `[${ids.join(',')}]`).padEnd(42),
      `oddOneOut=${percent(unique)}%`,
      `split=${percent(minority)}%`,
      `rethrow=${percent(RUNS - unique - minority)}%`,
      `edgeNudges=${edgeNudges}`,
      `escapes=${recoveries}`,
      `timeouts=${timeouts}`,
      `avgSteps=${Math.round(steps / RUNS)}`,
      `avgMs=${(Date.now() - started) / RUNS}`,
      `up%=${upCounts.map(percent).join('/')}`,
      `winsBySeat%=${wins.map(percent).join('/')}`,
    ].join(' '),
  );
}

const B = 'baraha';

await trial([B, B, B]);
await trial([B, B, B, B]);
await trial([B, B, B, B, B]);
await trial([B, B, B, B, B, B]);
await trial([B, B, 'tabingi']);
await trial(['bato', 'alon', 'ipo-ipo']);
await trial(['bato', 'alon', 'ipo-ipo', 'dahon']);

// A launcher may turn pieces over while building the stack, so it is worth
// watching what that does to the result.
console.log('--- does flipping the stack change the result? ---');
await trial([B, B, B], {
  label: 'all face up',
  flipped: [false, false, false],
});
await trial([B, B, B], { label: 'all face down', flipped: [true, true, true] });
await trial([B, B, B], {
  label: 'bottom flipped',
  flipped: [true, false, false],
});

// Tilt biases which way every piece lands, but every piece in a throw shares
// the tilt, so the bias is common to all of them. What it moves is how often a
// throw decides anything, not who wins: watch winsBySeat stay even here while
// the decisive rate swings.
console.log('--- does the tilt the launcher picks favour a seat? ---');
for (const deg of [45, 70, 90, 110, 135]) {
  const tilt = (deg * Math.PI) / 180;
  await trial([B, B, B], { label: `tilt ${deg} degrees`, tilt });
}
