import type { PamatoSpec } from '~/games/teks/sim/types';

/**
 * The pamato roster.
 *
 * Every stat here is a physical property. A pamato can change how it flies and
 * how it behaves once it is down, and nothing else: no pamato touches teks,
 * wagers, turn order or the reading of a face.
 *
 * `comOffset` is the subtle one. It shifts the centre of mass along the
 * piece's local +Y axis, the side its face is printed on. A positive offset
 * makes the piece top-heavy while it is lying face up, so it tends to roll
 * onto its back; a negative offset does the opposite. It biases the odds
 * without ever overriding what the physics actually did.
 */
export const PAMATOS: PamatoSpec[] = [
  {
    id: 'baraha',
    name: 'Baraha',
    tagline: 'Plain, honest, no opinions. The one to learn the throw with.',
    mass: 0.03,
    restitution: 0.3,
    friction: 0.6,
    linearDamping: 0.15,
    angularDamping: 0.2,
    comOffset: 0,
    launchLift: 1,
    launchSpin: 1,
    postLandFriction: 1,
    postLandAngularDamping: 0,
    postLandRestitution: 1,
  },
  {
    id: 'bato',
    name: 'Bato',
    tagline: 'Heavy. Shoulders through the stack and stops where it lands.',
    mass: 0.085,
    restitution: 0.12,
    friction: 0.9,
    linearDamping: 0.1,
    angularDamping: 0.35,
    comOffset: 0,
    launchLift: 0.85,
    launchSpin: 0.7,
    postLandFriction: 1.6,
    postLandAngularDamping: 1.2,
    postLandRestitution: 0.4,
  },
  {
    id: 'alon',
    name: 'Alon',
    tagline: 'Springy. Keeps hopping long after the others have settled.',
    mass: 0.026,
    restitution: 0.62,
    friction: 0.35,
    linearDamping: 0.12,
    angularDamping: 0.14,
    comOffset: 0,
    launchLift: 1.1,
    launchSpin: 1.15,
    postLandFriction: 0.7,
    postLandAngularDamping: 0.25,
    postLandRestitution: 1.15,
  },
  {
    id: 'ipo-ipo',
    name: 'Ipo-ipo',
    tagline: 'Tumbles hard off the hand. Many more flips before it rests.',
    mass: 0.028,
    restitution: 0.32,
    friction: 0.5,
    linearDamping: 0.14,
    angularDamping: 0.09,
    comOffset: 0,
    launchLift: 1,
    launchSpin: 1.9,
    postLandFriction: 0.85,
    postLandAngularDamping: 0.5,
    postLandRestitution: 1,
  },
  {
    id: 'dahon',
    name: 'Dahon',
    tagline: 'Light and floaty. Hangs in the air, lands late and gently.',
    mass: 0.012,
    restitution: 0.25,
    friction: 0.7,
    linearDamping: 0.55,
    angularDamping: 0.45,
    comOffset: 0,
    launchLift: 1.45,
    launchSpin: 1.2,
    postLandFriction: 1.2,
    postLandAngularDamping: 0.6,
    postLandRestitution: 0.8,
  },
  {
    id: 'tabingi',
    name: 'Tabingi',
    tagline: 'Weighted off-centre. Rolls onto its back more often than not.',
    mass: 0.034,
    restitution: 0.28,
    friction: 0.65,
    linearDamping: 0.16,
    angularDamping: 0.18,
    comOffset: 0.0025,
    launchLift: 0.95,
    launchSpin: 0.9,
    postLandFriction: 0.9,
    postLandAngularDamping: 0,
    postLandRestitution: 1,
  },
];

const BY_ID = new Map(PAMATOS.map(spec => [spec.id, spec]));

export function getPamato(id: string): PamatoSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`unknown pamato "${id}"`);
  return spec;
}
