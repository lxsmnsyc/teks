import { CARD_HALF } from './constants';

/**
 * The shape of a playing piece.
 *
 * A teks is a bipyramid: a rectangular rim with no thickness at all, and a
 * shallow pyramid rising from it to an apex on each side.
 *
 * The shape exists to remove a resting position. A piece with a flat band
 * around its edge can come down on that band and stay there, which leaves a
 * round with no readable face and has to be nudged out of afterwards. A rim is
 * a knife edge: balancing on it is an unstable equilibrium, so a piece that
 * lands on it always falls onto one face or the other by itself.
 *
 * Both the collider and the mesh are built from this, so the thing being
 * simulated and the thing being drawn cannot drift apart.
 */
export interface PieceShape {
  /** Vertex positions, three floats each. */
  positions: Float32Array;
  /** Triangle indices, wound so normals face outward. */
  indices: Uint32Array;
  /** Triangles belonging to the face side, then to the back side. */
  groups: { start: number; count: number }[];
}

/** How far the apex stands off the rim, in metres. */
export const APEX_HEIGHT = CARD_HALF.y;

/** The rim corners, counterclockwise seen from above. */
const RIM = [
  { x: CARD_HALF.x, z: CARD_HALF.z },
  { x: CARD_HALF.x, z: -CARD_HALF.z },
  { x: -CARD_HALF.x, z: -CARD_HALF.z },
  { x: -CARD_HALF.x, z: CARD_HALF.z },
];

/** The drawable form: rim vertices doubled so the crease stays sharp. */
export function pieceShape(): PieceShape {
  const count = RIM.length;
  const positions = new Float32Array((count * 2 + 2) * 3);
  const write = (at: number, x: number, y: number, z: number): void => {
    positions[at * 3] = x;
    positions[at * 3 + 1] = y;
    positions[at * 3 + 2] = z;
  };

  RIM.forEach((point, i) => {
    write(i, point.x, 0, point.z);
    write(count + i, point.x, 0, point.z);
  });
  const topApex = count * 2;
  const bottomApex = topApex + 1;
  write(topApex, 0, APEX_HEIGHT, 0);
  write(bottomApex, 0, -APEX_HEIGHT, 0);

  const indices = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices[i * 3] = i;
    indices[i * 3 + 1] = next;
    indices[i * 3 + 2] = topApex;
    const back = count * 3 + i * 3;
    indices[back] = count + next;
    indices[back + 1] = count + i;
    indices[back + 2] = bottomApex;
  }

  return {
    positions,
    indices,
    groups: [
      { start: 0, count: count * 3 },
      { start: count * 3, count: count * 3 },
    ],
  };
}

/**
 * The collider form: one vertex per corner, with the triangles joining them.
 *
 * The triangles are handed over rather than letting the physics engine find
 * the convex hull itself, because the shape is already known and there is
 * nothing to find. Worth knowing if this shape is ever rounded off: a rim of
 * more than about sixteen coplanar points on a body only millimetres thick is
 * close enough to degenerate that the engine quietly hands back a piece with
 * no volume, no mass and no inertia, rather than reporting a failure.
 */
export function pieceCollisionMesh(): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const count = RIM.length;
  const vertices = new Float32Array((count + 2) * 3);
  RIM.forEach((point, i) => {
    vertices[i * 3] = point.x;
    vertices[i * 3 + 1] = 0;
    vertices[i * 3 + 2] = point.z;
  });
  const topApex = count;
  const bottomApex = count + 1;
  vertices[topApex * 3 + 1] = APEX_HEIGHT;
  vertices[bottomApex * 3 + 1] = -APEX_HEIGHT;

  const indices = new Uint32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices[i * 3] = i;
    indices[i * 3 + 1] = next;
    indices[i * 3 + 2] = topApex;
    const back = count * 3 + i * 3;
    indices[back] = next;
    indices[back + 1] = i;
    indices[back + 2] = bottomApex;
  }

  return { vertices, indices };
}
