import type { World } from '@dimforge/rapier3d-compat';
import {
  DISC_SPIN_RATE,
  EDGE_KICK,
  EDGE_SETTLE_STEPS,
  ESCAPE_Y,
  FRAMES_PER_RECORD,
  LAND_HEIGHT,
  MAGNUS_LIFT,
  MAX_EDGE_RESOLUTIONS,
  MAX_STEPS,
  SETTLE_ASSIST_AFTER,
  SETTLE_ASSIST_MAX,
  SETTLE_ASSIST_RATE,
  SETTLE_ASSIST_STEP,
  TIMESTEP,
} from './constants';
import { isOnEdge, readFace } from './faces';
import { spinAxis } from './flight';
import { applyLaunch } from './launch';
import type { Vec3 } from './quat';
import type { PieceBody } from './pieces';
import { spawnStack } from './pieces';
import { loadRapier } from './rapier';
import { createRng, signed } from './rng';
import { createArena } from './world';
import { FRAME_STRIDE } from './types';
import type { Face, SimRequest, SimResult } from './types';

const MAX_RECORDED_STEPS = MAX_STEPS + MAX_EDGE_RESOLUTIONS * EDGE_SETTLE_STEPS;

/**
 * Switches a piece over to its post-landing stats the first time it comes
 * down. This is where a pamato's "what it does once it lands" behaviour lives:
 * grippy pieces stop dead, slick ones keep sliding, springy ones keep hopping.
 */
function applyLandingStats(entry: PieceBody): void {
  if (entry.landed || entry.body.translation().y > LAND_HEIGHT) return;

  entry.landed = true;
  const { spec } = entry.piece;
  const collider = entry.body.collider(0);
  collider.setFriction(spec.friction * spec.postLandFriction);
  collider.setRestitution(spec.restitution * spec.postLandRestitution);
  entry.body.setAngularDamping(
    spec.angularDamping + spec.postLandAngularDamping,
  );
}

/**
 * Ramps damping up on every piece once a throw has run long past the point
 * where it should have settled. Without it a bouncy pamato can hop and a pog
 * can roll for longer than the step ceiling allows, and the round ends on a
 * timeout instead of on a resting face.
 */
function createSettleAssist(bodies: PieceBody[]): (steps: number) => void {
  let applied = 0;

  return steps => {
    if (steps < SETTLE_ASSIST_AFTER) return;

    const extra = Math.min(
      (steps - SETTLE_ASSIST_AFTER) * SETTLE_ASSIST_RATE,
      SETTLE_ASSIST_MAX,
    );
    // Writing damping every step keeps resetting Rapier's sleep timer, which
    // is the opposite of what we want here, so only write when the value has
    // actually moved.
    if (extra - applied < SETTLE_ASSIST_STEP) return;
    applied = extra;

    for (const entry of bodies) {
      const { spec } = entry.piece;
      entry.body.setLinearDamping(spec.linearDamping + extra);
      entry.body.setAngularDamping(
        spec.angularDamping + spec.postLandAngularDamping + extra,
      );
    }
  };
}

/**
 * Catches a piece that has left the arena through the floor and puts it back.
 * Thin fast-spinning plates are the classic case a physics engine can miss,
 * and a piece falling forever would hang the round rather than fail loudly.
 */
function recoverEscapees(bodies: PieceBody[]): number {
  let recovered = 0;
  for (const entry of bodies) {
    if (entry.body.translation().y > ESCAPE_Y) continue;
    recovered++;
    entry.body.setTranslation({ x: 0, y: 0.25, z: 0 }, true);
    entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  return recovered;
}

/**
 * Pushes the pieces sideways the way air pushes a spinning disc.
 *
 * A disc moving through air while spinning is pushed at right angles to both
 * its spin axis and its travel. That is what bends a thrown frisbee, and here
 * it is what ties the stack's rotation to the shape of its arc: the spin axis
 * is the stack's own face, so rotating the stack in the first stage changes
 * which way the throw bends.
 *
 * It only applies while a piece is still in the air. Once something is down,
 * it is sliding, not flying.
 */
function applyMagnus(bodies: PieceBody[], axis: Vec3): void {
  for (const entry of bodies) {
    if (entry.landed || entry.body.translation().y <= LAND_HEIGHT) continue;

    const velocity = entry.body.linvel();
    const spin = entry.body.angvel();
    // The component of the spin still aligned with the launch axis, so the
    // push fades as a piece is knocked out of its spin.
    const aligned =
      (spin.x * axis.x + spin.y * axis.y + spin.z * axis.z) / DISC_SPIN_RATE;
    const scale = MAGNUS_LIFT * TIMESTEP * aligned * entry.piece.spec.mass;

    entry.body.applyImpulse(
      {
        x: (axis.y * velocity.z - axis.z * velocity.y) * scale,
        y: (axis.z * velocity.x - axis.x * velocity.z) * scale,
        z: (axis.x * velocity.y - axis.y * velocity.x) * scale,
      },
      true,
    );
  }
}

function allAsleep(bodies: PieceBody[]): boolean {
  return bodies.every(entry => entry.body.isSleeping());
}

/**
 * Records one frame of every piece into the flat replay buffer. Writing into a
 * preallocated Float32Array keeps the result cheap to hand to the renderer and
 * cheap to send over the wire.
 */
function record(
  frames: Float32Array,
  frameIndex: number,
  bodies: PieceBody[],
): void {
  let offset = frameIndex * bodies.length * FRAME_STRIDE;
  for (const entry of bodies) {
    const position = entry.body.translation();
    const rotation = entry.body.rotation();
    frames[offset++] = position.x;
    frames[offset++] = position.y;
    frames[offset++] = position.z;
    frames[offset++] = rotation.x;
    frames[offset++] = rotation.y;
    frames[offset++] = rotation.z;
    frames[offset++] = rotation.w;
  }
}

/** Topples a piece that came to rest balanced on its edge. */
function kickOffEdge(entry: PieceBody, rng: () => number): void {
  entry.body.applyTorqueImpulse(
    {
      x: signed(rng) * EDGE_KICK,
      y: signed(rng) * EDGE_KICK * 0.25,
      z: signed(rng) * EDGE_KICK,
    },
    true,
  );
  entry.body.applyImpulse(
    { x: 0, y: EDGE_KICK * entry.piece.spec.mass, z: 0 },
    true,
  );
}

/**
 * Runs one throw from start to rest and reports the resting faces plus a
 * replay of how they got there.
 *
 * This is the authoritative result of a round. Clients replay `frames` for the
 * animation; they never decide `faces` for themselves.
 */
export async function runThrow(request: SimRequest): Promise<SimResult> {
  const rapier = await loadRapier();
  const world: World = createArena(rapier);

  try {
    const bodies = spawnStack(
      rapier,
      world,
      request.pieces,
      request.launch.stack,
      request.launch.tilt,
    );
    applyLaunch(bodies, request.launch);

    const frames = new Float32Array(
      Math.ceil(MAX_RECORDED_STEPS / FRAMES_PER_RECORD) *
        bodies.length *
        FRAME_STRIDE,
    );
    let frameCount = 0;
    let steps = 0;
    let timedOut = false;
    let recoveries = 0;
    const settleAssist = createSettleAssist(bodies);
    const axis = spinAxis(request.launch.tilt);

    const step = (): void => {
      for (const entry of bodies) applyLandingStats(entry);
      applyMagnus(bodies, axis);
      settleAssist(steps);
      world.step();
      recoveries += recoverEscapees(bodies);
      steps++;
      if (steps % FRAMES_PER_RECORD === 0) {
        record(frames, frameCount++, bodies);
      }
    };

    // Main flight, until everything has gone to sleep on the floor.
    while (steps < MAX_STEPS && !allAsleep(bodies)) step();
    timedOut = steps >= MAX_STEPS;

    // Anything balanced on its edge has no readable face, so nudge it and let
    // it settle again. Each attempt is recorded so the replay stays continuous.
    const rng = createRng(request.launch.seed ^ 0x9e3779b9);
    let edgeResolutions = 0;
    while (edgeResolutions < MAX_EDGE_RESOLUTIONS) {
      const standing = bodies.filter(entry => isOnEdge(entry.body.rotation()));
      if (standing.length === 0) break;

      edgeResolutions++;
      for (const entry of standing) kickOffEdge(entry, rng);

      const until = steps + EDGE_SETTLE_STEPS;
      while (steps < until && !allAsleep(bodies)) step();
    }

    const faces: Face[] = bodies.map(entry => readFace(entry.body.rotation()));

    return {
      faces,
      frameCount,
      frames: frames.subarray(0, frameCount * bodies.length * FRAME_STRIDE),
      steps,
      edgeResolutions,
      recoveries,
      timedOut,
    };
  } finally {
    world.free();
  }
}
