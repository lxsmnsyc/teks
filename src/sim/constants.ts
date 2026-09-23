/** Fixed physics timestep. Thin pieces need a small step to stay stable. */
export const TIMESTEP = 1 / 120;

/** Record one replay frame every N steps, giving a 60fps replay. */
export const FRAMES_PER_RECORD = 2;

/** Give up after this many steps even if something is still creeping. */
export const MAX_STEPS = 120 * 20;

/** Solver iterations. Stacked thin bodies jitter with the default of 4. */
export const SOLVER_ITERATIONS = 8;

export const GRAVITY = { x: 0, y: -9.81, z: 0 };

/**
 * Half the width of the marked playing area, in metres.
 *
 * This is where the launcher may aim and what the camera frames. It is not a
 * boundary: the ground runs on past it and a piece that skids beyond simply
 * keeps going until friction stops it.
 */
export const ARENA_HALF_SIZE = 3;

/**
 * Half the width of the ground, in metres.
 *
 * Large enough that nothing reaches the end of it. There are no walls: a piece
 * bouncing off one would be returned to play by something the launcher cannot
 * see and did not aim at, which makes the throw read as unfair even when it is
 * not.
 */
export const GROUND_HALF_SIZE = 200;

/**
 * How high the throw is made, measured from the floor: half the arena across,
 * which is about where a standing person holds something before throwing it.
 */
export const THROW_HEIGHT = ARENA_HALF_SIZE / 2;

/** Where the stack is held before the throw, at that standing height. */
export const STACK_ORIGIN = {
  x: 0,
  y: THROW_HEIGHT,
  z: -ARENA_HALF_SIZE + 0.6,
};

/**
 * How high a throw has to rise, measured from the floor.
 *
 * A throw that leaves the hand already falling skims the ground, barely turns
 * the pieces over on the way, and reads as a slide rather than a throw. Every
 * throw is lofted to at least the height it was released from, however near
 * the target is. The launcher chooses where it lands, not how low it gets
 * there.
 */
export const MIN_THROW_HEIGHT = THROW_HEIGHT;
/** Vertical gap left between stacked pieces so they do not start interpenetrating. */
export const STACK_GAP = 0.002;

/**
 * Teks card half-extents in metres: 10cm wide, 14cm long, and 8mm from the rim
 * up to the apex of each face.
 */
export const CARD_HALF = { x: 0.05, y: 0.004, z: 0.07 };

/**
 * Range of the tumble axis tilt, in radians. A right angle to the throw is a
 * clean end-over-end flip; the ends of the range are a pronounced corkscrew.
 */
export const TILT_MIN = Math.PI / 4;
export const TILT_MAX = (Math.PI * 3) / 4;

/** Elevation a throw is made at when nothing forces it steeper, in radians. */
export const MIN_LAUNCH_ELEVATION = Math.PI / 4;
/** Steepest a throw may be lofted, short of straight up. */
export const MAX_LAUNCH_ELEVATION = (Math.PI / 180) * 80;
/** Speed ceiling, so a far target cannot ask for an absurd throw. */
export const MAX_LAUNCH_SPEED = 16;

/**
 * How fast the stack spins about its own face, in radians per second.
 *
 * This is disc spin: the flat frisbee-like rotation a thrown card actually
 * carries, about the axis running through its faces.
 */
export const DISC_SPIN_RATE = 55;

/**
 * Strength of the sideways push a spinning piece gets from the air, per
 * second of flight.
 *
 * A spinning disc moving through air is pushed at right angles to both its
 * spin axis and its travel, which is what bends a thrown frisbee off a flat
 * parabola. Because the spin axis is the stack's own face normal, the rotation
 * the launcher sets in the first stage is what decides which way the arc
 * bends: a flat stack is pushed sideways, a stack on its edge is pushed up.
 */
export const MAGNUS_LIFT = 2.2;

/** Fraction of the launch velocity that seeded jitter may vary. */
export const LAUNCH_JITTER = 0.03;
/** Fraction of the spin rate that seeded jitter may vary, per piece. */
export const SPIN_JITTER = 0.18;

/**
 * Steps after which the arena starts quietly stealing energy from the pieces.
 * A springy pamato on a slick floor can keep hopping and rolling for a very
 * long time, and a round has to end, so past this point damping ramps up until
 * everything stops. It is late enough that it never touches a normal throw.
 */
export const SETTLE_ASSIST_AFTER = 480;
/** How much damping the settle assist adds per step, once it starts. */
export const SETTLE_ASSIST_RATE = 0.02;
/** Ceiling on the damping the settle assist may add. */
export const SETTLE_ASSIST_MAX = 12;
/**
 * Smallest damping change the settle assist bothers writing. Writing damping
 * on every step resets Rapier's sleep timer, so the assist moves in steps.
 */
export const SETTLE_ASSIST_STEP = 0.75;

/** A piece counts as landed once it is this close to the floor. */
export const LAND_HEIGHT = 0.05;

/**
 * Minimum |dot(localUp, worldUp)| for a face to be readable. Below this the
 * piece is standing on its edge and has to be resolved.
 */
export const FACE_THRESHOLD = 0.7;

/** Impulse used to topple a piece that settled on its edge. */
export const EDGE_KICK = 0.03;
/**
 * Below this height a piece has escaped the arena, which should not happen but
 * is cheap to insure against. It is put back on the floor rather than allowed
 * to fall forever and hang the round.
 */
export const ESCAPE_Y = -0.5;
/** How many times we will kick an edge-standing piece before forcing a read. */
export const MAX_EDGE_RESOLUTIONS = 6;
/** Steps allowed for each edge resolution to settle again. */
export const EDGE_SETTLE_STEPS = 240;
