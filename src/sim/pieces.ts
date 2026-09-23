import type { ColliderDesc, RigidBody, World } from '@dimforge/rapier3d-compat';
import { STACK_GAP, STACK_ORIGIN } from './constants';
import type { Rapier } from './rapier';
import type { Quat, Vec3 } from './quat';
import { FLIP, IDENTITY, multiply, stackAxis, stackOrientation } from './quat';
import { APEX_HEIGHT, pieceCollisionMesh } from './shape';
import type { PamatoSpec, SimPiece, StackEntry } from './types';

/** Any density works: the mass properties are rescaled to the pamato's mass. */
const REFERENCE_DENSITY = 1000;

function colliderFor(rapier: Rapier): ColliderDesc {
  const { vertices, indices } = pieceCollisionMesh();
  const shape = rapier.ColliderDesc.convexMesh(vertices, indices);
  if (!shape) throw new Error(`could not build the piece collider`);
  return shape;
}

/** A live piece in the world, paired with the stats that created it. */
export interface PieceBody {
  piece: SimPiece;
  body: RigidBody;
  /** Set once the piece has come down, so post-landing stats can kick in. */
  landed: boolean;
}

function spawn(
  rapier: Rapier,
  world: World,
  piece: SimPiece,
  at: Vec3,
  rotation: Quat,
): PieceBody {
  const spec: PamatoSpec = piece.spec;
  const body = world.createRigidBody(
    rapier.RigidBodyDesc.dynamic()
      .setTranslation(at.x, at.y, at.z)
      .setRotation(rotation)
      .setLinearDamping(spec.linearDamping)
      .setAngularDamping(spec.angularDamping)
      .setCcdEnabled(true)
      .setSoftCcdPrediction(0.05),
  );

  // Build the collider at a reference density so Rapier works out the inertia
  // of the real hull for us, rather than deriving a tensor by hand that would
  // only approximate the shape actually being simulated. Setting a mass
  // directly is no good here: it replaces the shape's mass properties outright
  // and leaves the piece with no rotational inertia at all.
  const collider = world.createCollider(
    colliderFor(rapier)
      .setFriction(spec.friction)
      .setRestitution(spec.restitution)
      .setDensity(REFERENCE_DENSITY),
    body,
  );
  body.recomputeMassPropertiesFromColliders();

  // Inertia scales with mass for a fixed shape, so rescale to the mass this
  // pamato is supposed to have and shift the centre of mass while we are here.
  const reference = body.mass();
  const inertia = body.principalInertia();
  // The engine reports inertia as sorted eigenvalues paired with the frame
  // they are measured in, not as components along the piece's own axes, so the
  // frame has to travel with them. Dropping it hands the card its smallest
  // inertia about its longest axis, and it tumbles quite wrongly.
  const frame = body.principalInertiaLocalFrame();
  const scale = reference > 0 ? spec.mass / reference : 0;
  collider.setMassProperties(
    spec.mass,
    { x: 0, y: spec.comOffset, z: 0 },
    { x: inertia.x * scale, y: inertia.y * scale, z: inertia.z * scale },
    frame,
  );
  body.recomputeMassPropertiesFromColliders();

  return { piece, body, landed: false };
}

/**
 * Spawns the stack the launcher arranged, bottom first and each piece the way
 * up the launcher placed it. The returned array keeps the caller's original
 * piece order so results line up with `SimRequest.pieces`.
 */
export function spawnStack(
  rapier: Rapier,
  world: World,
  pieces: SimPiece[],
  stack: StackEntry[],
  tilt: number,
): PieceBody[] {
  const byId = new Map(pieces.map(piece => [piece.id, piece]));
  const halfHeight = APEX_HEIGHT;
  const spawned = new Map<string, PieceBody>();

  // The stack is held at the tilt the launcher chose, so it grows along its
  // own axis rather than straight up. At a quarter turn that axis is
  // horizontal and the pieces sit side by side, thrown edge on.
  const orientation = stackOrientation(tilt);
  const axis = stackAxis(tilt);
  const pitch = halfHeight * 2 + STACK_GAP;
  // The stack is centred on the mark rather than grown from it, so that a
  // rotated stack leans evenly either side instead of burying itself.
  const middle = ((stack.length - 1) * pitch) / 2;

  stack.forEach((entry, index) => {
    const piece = byId.get(entry.pieceId);
    if (!piece) {
      throw new Error(`stack references unknown piece "${entry.pieceId}"`);
    }
    const offset = index * pitch - middle;
    spawned.set(
      entry.pieceId,
      spawn(
        rapier,
        world,
        piece,
        {
          x: STACK_ORIGIN.x + axis.x * offset,
          y: STACK_ORIGIN.y + axis.y * offset,
          z: STACK_ORIGIN.z + axis.z * offset,
        },
        multiply(orientation, entry.flipped ? FLIP : IDENTITY),
      ),
    );
  });

  return pieces.map(piece => {
    const found = spawned.get(piece.id);
    if (!found) {
      throw new Error(`piece "${piece.id}" is missing from the stack`);
    }
    return found;
  });
}
