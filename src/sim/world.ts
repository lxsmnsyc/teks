import type { World } from '@dimforge/rapier3d-compat';
import {
  GRAVITY,
  GROUND_HALF_SIZE,
  SOLVER_ITERATIONS,
  TIMESTEP,
} from './constants';
import type { Rapier } from './rapier';

const FLOOR_THICKNESS = 0.2;

/**
 * Builds the arena: open ground, and nothing else.
 *
 * There is deliberately no wall around the playing area. A piece that came
 * back off one would have been turned around by something the launcher never
 * aimed at, and a throw that ends against a barrier reads as cheated even when
 * the physics is honest. A piece thrown too hard simply travels further than
 * its owner meant it to, which is the launcher's problem and a fair one.
 */
export function createArena(rapier: Rapier): World {
  const world = new rapier.World(GRAVITY);
  world.timestep = TIMESTEP;
  world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS;

  const floor = world.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(0, -FLOOR_THICKNESS, 0),
  );
  world.createCollider(
    rapier.ColliderDesc.cuboid(
      GROUND_HALF_SIZE,
      FLOOR_THICKNESS,
      GROUND_HALF_SIZE,
    )
      .setFriction(0.8)
      .setRestitution(0.2),
    floor,
  );

  return world;
}
