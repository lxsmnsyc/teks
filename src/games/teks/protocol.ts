import * as v from 'valibot';
import { TILT_MAX, TILT_MIN } from '~/games/teks/sim/constants';

/**
 * What a Teks player can ask of the table.
 *
 * These travel inside the platform's `game` envelope, which has already
 * decided who sent them and which room they are for. What is checked here is
 * what they say: a wager has to be a whole number, a tilt has to be within the
 * range the dial allows. Whether the sender may do it at all, such as whether
 * it is their turn, is the table's call.
 */

const finite = v.pipe(v.number(), v.finite());

export const TargetSchema = v.object({
  x: v.pipe(finite, v.minValue(-50), v.maxValue(50)),
  z: v.pipe(finite, v.minValue(-50), v.maxValue(50)),
});

export const StackEntrySchema = v.object({
  pieceId: v.pipe(v.string(), v.maxLength(64)),
  flipped: v.boolean(),
});

export const TeksMessageSchema = v.variant('type', [
  v.object({
    type: v.literal('wager'),
    teks: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  v.object({
    type: v.literal('pamato'),
    pamatoId: v.pipe(v.string(), v.maxLength(32)),
  }),
  v.object({ type: v.literal('wagersIn') }),
  v.object({
    type: v.literal('stack'),
    stack: v.pipe(v.array(StackEntrySchema), v.maxLength(8)),
  }),
  v.object({ type: v.literal('stackSet') }),
  v.object({ type: v.literal('stackBack') }),
  v.object({
    type: v.literal('aim'),
    tilt: v.pipe(finite, v.minValue(TILT_MIN), v.maxValue(TILT_MAX)),
    target: TargetSchema,
  }),
  v.object({ type: v.literal('throw') }),
  v.object({ type: v.literal('next') }),
  v.object({ type: v.literal('newGame') }),
  v.object({ type: v.literal('addBot') }),
  v.object({ type: v.literal('removeBot') }),
  v.object({
    type: v.literal('startingTeks'),
    teks: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(1000)),
  }),
  v.object({
    type: v.literal('colour'),
    colour: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(5)),
  }),
  v.object({ type: v.literal('start') }),
]);

export type TeksMessage = v.InferOutput<typeof TeksMessageSchema>;

/** Checks a message for the table, or explains why it will not be acted on. */
export function readTeksMessage(
  raw: unknown,
): { ok: true; message: TeksMessage } | { ok: false; reason: string } {
  const result = v.safeParse(TeksMessageSchema, raw);
  if (!result.success) {
    return { ok: false, reason: result.issues[0]?.message ?? 'unusable' };
  }
  return { ok: true, message: result.output };
}
