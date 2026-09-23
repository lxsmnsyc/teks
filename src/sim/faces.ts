import type { Rotation } from '@dimforge/rapier3d-compat';
import { FACE_THRESHOLD } from './constants';
import type { Face } from './types';

/**
 * How far the piece's printed side is tilted towards the sky, as a value in
 * [-1, 1]. This is the world-up component of the piece's local +Y axis, which
 * for a quaternion reduces to a single term.
 */
export function faceDot(rotation: Rotation): number {
  return 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
}

/** True when the piece came to rest on its edge and cannot be read. */
export function isOnEdge(rotation: Rotation): boolean {
  return Math.abs(faceDot(rotation)) < FACE_THRESHOLD;
}

/**
 * Reads the resting face. Callers should resolve edge cases before asking, but
 * a forced read falls back to whichever side is closer to up.
 */
export function readFace(rotation: Rotation): Face {
  return faceDot(rotation) >= 0 ? 'up' : 'down';
}
