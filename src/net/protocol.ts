import * as v from 'valibot';
import { TILT_MAX, TILT_MIN } from '~/sim/constants';

/**
 * What the two sides of the tunnel say to each other.
 *
 * Everything arriving from a client is parsed against these schemas before it
 * is looked at. A client is someone on the far end of a public URL, so its
 * messages are input, not instructions: a wager has to be a whole number a
 * player can cover, a tilt has to be within the range the dial allows, and a
 * message from someone whose turn it is not gets refused whatever it says.
 */

const finite = v.pipe(v.number(), v.finite());

export const JoinCodeSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toUpperCase(),
  v.length(6),
  v.regex(/^[A-Z0-9]{6}$/, 'a join code is six letters and digits'),
);

export const NameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'a name cannot be empty'),
  v.maxLength(16, 'a name is at most sixteen characters'),
);

export const TargetSchema = v.object({
  x: v.pipe(finite, v.minValue(-50), v.maxValue(50)),
  z: v.pipe(finite, v.minValue(-50), v.maxValue(50)),
});

export const StackEntrySchema = v.object({
  pieceId: v.pipe(v.string(), v.maxLength(64)),
  flipped: v.boolean(),
});

export const ClientMessageSchema = v.variant('type', [
  v.object({
    type: v.literal('join'),
    code: JoinCodeSchema,
    name: NameSchema,
  }),
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

export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

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
