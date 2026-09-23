import { DISC_SPIN_RATE, LAUNCH_JITTER, SPIN_JITTER } from './constants';
import { spinAxis, solveLaunch } from './flight';
import type { PieceBody } from './pieces';
import { createRng, signed } from './rng';
import type { LaunchInput } from './types';

/**
 * Throws the stack.
 *
 * Launch is expressed as velocity rather than impulse on purpose. These pieces
 * are thin plates whose moment of inertia is tiny, so a torque large enough to
 * feel meaningful spins them fast enough to tunnel straight through the floor.
 * Setting the spin rate directly keeps the numbers in a range a person can
 * reason about: 55 rad/s is a little under nine turns a second.
 *
 * The stack spins about its own face, the way a thrown disc does, so the
 * rotation the launcher set in the first stage is also the spin axis. That
 * rotation also rolls the plane the stack is thrown along, so the arc leans
 * with the stack: rotating the stack and shaping the throw are one choice.
 *
 * Every piece leaves the hand with the same nominal velocity, so the stack
 * travels together and only comes apart through collisions and the air. The
 * seeded jitter is the only thing the launcher does not control: it is small,
 * but it stops a throw from being perfectly repeatable.
 */
export function applyLaunch(bodies: PieceBody[], launch: LaunchInput): void {
  const rng = createRng(launch.seed);
  const { direction, speed } = solveLaunch(launch.target, launch.tilt);
  const axis = spinAxis(launch.tilt);

  for (const entry of bodies) {
    const { spec } = entry.piece;
    const jitter = () => 1 + signed(rng) * LAUNCH_JITTER;
    const spinJitter = () => 1 + signed(rng) * SPIN_JITTER;

    entry.body.setLinvel(
      {
        x: direction.x * speed * jitter(),
        y: direction.y * speed * spec.launchLift * jitter(),
        z: direction.z * speed * jitter(),
      },
      true,
    );

    const rate = DISC_SPIN_RATE * spec.launchSpin * spinJitter();
    entry.body.setAngvel(
      { x: axis.x * rate, y: axis.y * rate, z: axis.z * rate },
      true,
    );
  }
}
