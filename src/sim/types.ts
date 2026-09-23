/**
 * Pure simulation types. Nothing in `src/sim` may touch the DOM, three.js or
 * Solid: the same module runs in the browser for the aiming preview and on the
 * server as the authoritative judge of a round.
 */

/** Which side of a pamato ended up looking at the sky. */
export type Face = 'up' | 'down';

/**
 * A pamato's stats. Every field is a physical property fed to Rapier or to the
 * launch impulse. There are deliberately no economic or rule-bending effects:
 * a pamato can only change how it flies and how it behaves once it is down.
 */
export interface PamatoSpec {
  id: string;
  name: string;
  tagline: string;

  /** Mass in kilograms. Heavier pieces punch through the stack. */
  mass: number;
  /** Bounciness in [0, 1] while the piece is still airborne. */
  restitution: number;
  /** Sliding friction against the arena floor and other pieces. */
  friction: number;
  /** Air drag on linear motion. Higher means shorter flights. */
  linearDamping: number;
  /** Air drag on spin. Higher means fewer flips per metre. */
  angularDamping: number;

  /**
   * Centre of mass offset along the piece's local Y axis, in metres. A
   * positive value makes the piece top-heavy so it tends to roll onto its
   * back. This biases the resting face without ever overriding the physics.
   */
  comOffset: number;

  /** Multiplier on the vertical part of the launch impulse. */
  launchLift: number;
  /** Multiplier on the launch torque, so some pamatos flip more per throw. */
  launchSpin: number;

  /** Friction multiplier applied once the piece has touched down. */
  postLandFriction: number;
  /** Extra angular damping applied once the piece has touched down. */
  postLandAngularDamping: number;
  /** Restitution multiplier applied once the piece has touched down. */
  postLandRestitution: number;
}

/** One physical piece in a round, owned by one player. */
export interface SimPiece {
  /** Unique per round. Two players may bring the same pamato. */
  id: string;
  ownerId: string;
  spec: PamatoSpec;
}

/**
 * One piece as the launcher placed it in the stack.
 *
 * A launcher may turn a piece over while building the stack, so the stack
 * carries an orientation per piece and not just an order.
 */
export interface StackEntry {
  pieceId: string;
  /** True when the launcher placed this piece face down. */
  flipped: boolean;
}

/** Where on the arena floor the launcher wants the throw to come down. */
export interface Target {
  x: number;
  z: number;
}

/**
 * Everything the launching player chose, and nothing else.
 *
 * A throw is set up in two stages. First the launcher arranges and rotates the
 * stack, which is `stack` and `tilt`. Then they say where they want it to come
 * down, which is `target`. Speed follows from the target, and the tilt both
 * orients the stack and banks the arc it travels along.
 */
export interface LaunchInput {
  /** The stack bottom-first, as the launcher arranged and oriented it. */
  stack: StackEntry[];
  /**
   * Rotation of the stack, in radians, measured from flat. A quarter turn
   * stands it on edge so the pieces are thrown sideways.
   *
   * The same angle banks the throw: the stack spins about its own face like a
   * thrown disc, and that spin pushes the flight off a flat parabola, so a
   * stack rotated on its side curves differently from a flat one.
   */
  tilt: number;
  /** Where the launcher is aiming it to land. */
  target: Target;
  /** Seed for the small launch jitter, issued by the server. */
  seed: number;
}

export interface SimRequest {
  pieces: SimPiece[];
  launch: LaunchInput;
}

/** A piece's state at one recorded frame: position then quaternion. */
export const FRAME_STRIDE = 7;

export interface SimResult {
  /** Resting face per piece, in the same order as `SimRequest.pieces`. */
  faces: Face[];
  /** Number of recorded frames. */
  frameCount: number;
  /**
   * Flat replay buffer, `frameCount * pieces.length * FRAME_STRIDE` long.
   * Layout per piece: x, y, z, qx, qy, qz, qw.
   */
  frames: Float32Array;
  /** Physics steps taken before everything settled. */
  steps: number;
  /** How many times a piece had to be nudged off its edge. */
  edgeResolutions: number;
  /** How many times a piece had to be recovered from outside the arena. */
  recoveries: number;
  /** True if the sim hit the step ceiling instead of settling on its own. */
  timedOut: boolean;
}
