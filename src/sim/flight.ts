import {
  DISC_SPIN_RATE,
  GRAVITY,
  MAX_LAUNCH_ELEVATION,
  MIN_LAUNCH_ELEVATION,
  MIN_THROW_HEIGHT,
  MAGNUS_LIFT,
  MAX_LAUNCH_SPEED,
  STACK_ORIGIN,
  TIMESTEP,
} from './constants';
import type { Vec3 } from './quat';
import { rotate, stackOrientation } from './quat';
import type { LaunchInput, Target } from './types';

/** How long a predicted flight may run before it is cut off, in seconds. */
const MAX_FLIGHT = 4;
/**
 * Passes used to bend the aim onto the target.
 *
 * Each pass flies the throw, measures how far it missed by, and solves for a
 * better heading and speed from how the landing responds to each. That
 * converges in a handful of passes even when the flight curves hard, which
 * simply nudging the aim point by the miss does not.
 */
const AIM_PASSES = 8;
/** Step used to measure how the landing responds to heading and speed. */
const AIM_PROBE = 1e-3;
/** Close enough to stop early, in metres. */
const AIM_TOLERANCE = 1e-3;
/** Passes used to loft the throw up to the minimum height. */
const LOFT_PASSES = 8;
/** How far under the minimum height a throw may sit, in metres. */
const LOFT_TOLERANCE = 0.05;

/** Direction and speed the stack leaves the mark with. */
export interface LaunchVelocity {
  direction: Vec3;
  speed: number;
}

/**
 * The axis the stack spins about, at the chosen tilt.
 *
 * The pieces spin about their own faces, so this is the face normal, taken
 * negative: the stack turns the way that makes the air carry it over in the
 * same direction the stack is leaning. With the other sign the flight bows
 * away from the lean, which reads as the arc disagreeing with the stack.
 */
export function spinAxis(tilt: number): Vec3 {
  const normal = rotate(stackOrientation(tilt), { x: 0, y: 1, z: 0 });
  return { x: -normal.x, y: -normal.y, z: -normal.z };
}

/**
 * The direction "up" leans for a throw at this tilt.
 *
 * The stack is thrown along a plane rolled over by the same rotation the
 * launcher gave it, upright when the stack is on edge and tipped over as the
 * stack is rotated away from that.
 *
 * This on its own does not bend the flight sideways, because a rolled parabola
 * is still a parabola and the aim solver simply re-aims through it. What it
 * does change is how much of the throw goes upward, so a rotated stack travels
 * on a flatter, longer arc. The sideways bow comes from the spin.
 */
function bankedUp(tilt: number, heading: Vec3): Vec3 {
  const bank = tilt - Math.PI / 2;
  const cos = Math.cos(bank);
  const sin = Math.sin(bank);
  // Rodrigues' rotation of world up about the heading, which is horizontal.
  return {
    x: heading.z * sin,
    y: cos,
    z: -heading.x * sin,
  };
}

/**
 * One unobstructed flight, stepped the way the simulation steps it.
 *
 * The returned touchdown is interpolated back to floor level rather than being
 * the first sample underneath it. A step at this speed covers a few
 * centimetres, which would otherwise put a floor under how accurately the aim
 * can be solved.
 */
function integrate(
  velocity: Vec3,
  axis: Vec3,
  onSample?: (position: Vec3) => void,
): Vec3 {
  const position: Vec3 = { ...STACK_ORIGIN };
  const current: Vec3 = { ...velocity };
  // Lift is an acceleration, so it scales with the length of a step. Adding a
  // fixed slice of the cross product instead lets the flight gain speed with
  // every step, which sends a hard-curving throw up into the sky.
  const push = MAGNUS_LIFT * TIMESTEP;
  const steps = Math.round(MAX_FLIGHT / TIMESTEP);

  onSample?.(position);

  for (let step = 0; step < steps; step++) {
    const previous = { ...position };
    const vx = current.x;
    const vy = current.y;
    const vz = current.z;
    current.x += (axis.y * vz - axis.z * vy) * push;
    current.y += (axis.z * vx - axis.x * vz) * push + GRAVITY.y * TIMESTEP;
    current.z += (axis.x * vy - axis.y * vx) * push;

    position.x += current.x * TIMESTEP;
    position.y += current.y * TIMESTEP;
    position.z += current.z * TIMESTEP;

    if (position.y <= 0) {
      const span = previous.y - position.y;
      const at = span === 0 ? 0 : previous.y / span;
      position.x = previous.x + (position.x - previous.x) * at;
      position.y = 0;
      position.z = previous.z + (position.z - previous.z) * at;
      onSample?.(position);
      break;
    }
    onSample?.(position);
  }

  return position;
}

function velocityFor(
  heading: Vec3,
  speed: number,
  tilt: number,
  elevation: number,
): Vec3 {
  const up = bankedUp(tilt, heading);
  const cos = Math.cos(elevation);
  const sin = Math.sin(elevation);
  return {
    x: heading.x * cos * speed + up.x * sin * speed,
    y: up.y * sin * speed,
    z: heading.z * cos * speed + up.z * sin * speed,
  };
}

/**
 * How steeply a throw has to leave the hand to clear the minimum height.
 *
 * For a plain parabola the peak sits a quarter of the way up the range times
 * the tangent of the launch angle, which inverts to this. The flight is not a
 * plain parabola, so this is a starting point that the solve then checks
 * against a real flight; banking the throw also robs it of height, which the
 * cosine accounts for.
 */
function elevationFor(distance: number, tilt: number): number {
  const climb = Math.max(MIN_THROW_HEIGHT - STACK_ORIGIN.y, 0);
  const bank = Math.abs(Math.cos(tilt - Math.PI / 2));
  const spread = Math.max(distance, 0.01) * Math.max(bank, 0.2);
  return Math.min(
    Math.max(Math.atan((4 * climb) / spread), MIN_LAUNCH_ELEVATION),
    MAX_LAUNCH_ELEVATION,
  );
}

/**
 * Works out the throw that lands on the target.
 *
 * The launcher says where they want the stack to come down and the throw
 * follows from that, rather than dialling in a speed. A flat parabola would be
 * a closed-form answer, but this flight is banked by the stack's rotation and
 * bent by the spin, so the closed-form solution only gets close. The aim is
 * then solved for properly: each pass flies the throw and works out how the
 * landing responds to the heading and the speed, which converges to within a
 * millimetre in a handful of passes however hard the flight curves.
 *
 * Around that sits a second loop holding the throw above the minimum height.
 * Lofting the throw changes where it lands, so the two cannot be solved apart
 * from each other: the elevation is raised, the aim re-solved at that
 * elevation, and the height checked again.
 */
export function solveLaunch(target: Target, tilt: number): LaunchVelocity {
  const g = -GRAVITY.y;
  const axis = spinAxis(tilt);

  const dx = target.x - STACK_ORIGIN.x;
  const dz = target.z - STACK_ORIGIN.z;
  const distance = Math.hypot(dx, dz);

  let elevation = elevationFor(distance, tilt);
  let heading = Math.atan2(dx, dz);
  let speed = Math.min(
    Math.sqrt((Math.max(distance, 0.01) * g) / Math.sin(2 * elevation)),
    MAX_LAUNCH_SPEED,
  );

  const throwAt = (h: number, v: number): Vec3 =>
    velocityFor({ x: Math.sin(h), y: 0, z: Math.cos(h) }, v, tilt, elevation);

  for (let loft = 0; loft < LOFT_PASSES; loft++) {
    // Solve heading and speed for the target, at the current elevation.
    for (let pass = 0; pass < AIM_PASSES; pass++) {
      const at = integrate(throwAt(heading, speed), axis);
      const errorX = at.x - target.x;
      const errorZ = at.z - target.z;
      if (Math.hypot(errorX, errorZ) < AIM_TOLERANCE) break;

      const byHeading = integrate(throwAt(heading + AIM_PROBE, speed), axis);
      const bySpeed = integrate(throwAt(heading, speed + AIM_PROBE), axis);
      const a = (byHeading.x - at.x) / AIM_PROBE;
      const b = (bySpeed.x - at.x) / AIM_PROBE;
      const c = (byHeading.z - at.z) / AIM_PROBE;
      const d = (bySpeed.z - at.z) / AIM_PROBE;

      const determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-9) break;

      heading -= (d * errorX - b * errorZ) / determinant;
      speed -= (-c * errorX + a * errorZ) / determinant;
      speed = Math.min(Math.max(speed, 0.5), MAX_LAUNCH_SPEED);
    }

    // Check how high that throw actually went, and steepen it if it fell short.
    let peak = 0;
    integrate(throwAt(heading, speed), axis, at => {
      if (at.y > peak) peak = at.y;
    });
    if (peak >= MIN_THROW_HEIGHT - LOFT_TOLERANCE) break;
    if (elevation >= MAX_LAUNCH_ELEVATION) break;

    const climb = Math.max(peak - STACK_ORIGIN.y, 1e-3);
    const wanted = MIN_THROW_HEIGHT - STACK_ORIGIN.y;
    elevation = Math.min(
      Math.atan(Math.tan(elevation) * (wanted / climb)),
      MAX_LAUNCH_ELEVATION,
    );
  }

  const velocity = throwAt(heading, speed);
  return { direction: normalizeOrZero(velocity), speed: length(velocity) };
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalizeOrZero(v: Vec3): Vec3 {
  const size = length(v);
  if (size === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / size, y: v.y / size, z: v.z / size };
}

/**
 * Predicts the path of a single unobstructed piece, for the aim guide.
 *
 * This is the same flight the simulation will run, minus collisions and the
 * stack coming apart, so it is an honest preview of the arc rather than a
 * promise about where any given piece ends up.
 */
export function predictArc(
  launch: Pick<LaunchInput, 'tilt' | 'target'>,
  samples = 64,
): Float32Array {
  const { direction, speed } = solveLaunch(launch.target, launch.tilt);
  const path: number[] = [];
  integrate(
    { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed },
    spinAxis(launch.tilt),
    position => path.push(position.x, position.y, position.z),
  );

  const count = path.length / 3;
  const out = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i++) {
    const at = Math.min(
      count - 1,
      Math.round((i / (samples - 1)) * (count - 1)),
    );
    out[i * 3] = path[at * 3];
    out[i * 3 + 1] = path[at * 3 + 1];
    out[i * 3 + 2] = path[at * 3 + 2];
  }
  return out;
}

/** Where a predicted arc comes down, which is what the landing ring marks. */
export function predictLanding(
  launch: Pick<LaunchInput, 'tilt' | 'target'>,
): Vec3 {
  const { direction, speed } = solveLaunch(launch.target, launch.tilt);
  return integrate(
    { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed },
    spinAxis(launch.tilt),
  );
}
