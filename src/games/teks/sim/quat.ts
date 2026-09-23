/**
 * The small amount of quaternion maths the simulation needs.
 *
 * `src/sim` stays free of three.js so that it can run on a server, and Rapier
 * does not expose rotation helpers of its own, so the few operations used when
 * orienting a stack live here.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  };
}

/** Applies `a` after `b`, the usual quaternion composition order. */
export function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * The orientation of a stack rotated to a given tilt.
 *
 * Tilt is the angle of the stack's *edge*, read the way angles are read on a
 * protractor standing behind the throw: zero lies flat to the right, a quarter
 * turn stands straight up, a half turn lies flat to the left. The launcher
 * rotates the stack through the upper half of that dial.
 *
 * The edge is what the angle describes, not the face. At a quarter turn the
 * edge is vertical, so the pieces stand on edge and the stack grows sideways.
 *
 * The camera looks down +Z, so screen-right is world -X. Matching the edge to
 * the dial angle in that view is a turn of `pi - tilt` about the throw axis.
 */
export function stackOrientation(tilt: number): Quat {
  return fromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI - tilt);
}

/**
 * Half a turn about the piece's long axis, which is what "face down" means.
 *
 * This turns about X while the stack tilt turns about Z, so that turning a
 * piece over stays a separate choice from how the stack is tilted rather than
 * collapsing into it.
 */
export const FLIP = fromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI);

/**
 * The direction a stack at this tilt grows in, piece on piece: square to the
 * edge, because pieces pile face to face.
 */
export function stackAxis(tilt: number): Vec3 {
  return rotate(stackOrientation(tilt), { x: 0, y: 1, z: 0 });
}

/**
 * Where the dial sits for a given tilt, in the vertical plane across the
 * throw. Angles run anticlockwise from screen-right, so a quarter turn is
 * straight up and the launcher's range draws as an arc overhead.
 */
export function dialPoint(tilt: number, radius: number): Vec3 {
  return {
    x: -Math.cos(tilt) * radius,
    y: Math.sin(tilt) * radius,
    z: 0,
  };
}
