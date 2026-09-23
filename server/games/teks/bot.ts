import type { TeksMessage } from '~/games/teks/protocol';
import type { TableView } from '~/games/teks/view';
import { maxWager } from '~/games/teks/rules/round';
import {
  ARENA_HALF_SIZE,
  STACK_ORIGIN,
  TILT_MAX,
  TILT_MIN,
} from '~/games/teks/sim/constants';

/** Names for the seats nobody is sitting in. */
export const BOT_NAMES = [
  'Tikboy',
  'Nene',
  'Kuya Jun',
  'Aling Rosa',
  'Totoy',
  'Ate Mila',
];

/** One thing a bot does, and how long it waits first. */
export interface BotStep {
  message: TeksMessage;
  delay: number;
}

/**
 * How long a bot waits before acting.
 *
 * Bots would act instantly if allowed to, which makes a round flash past
 * before anyone has read it. The pause is for the people watching, not for the
 * bot, so it is longest for the things worth watching.
 */
const THINK = 650;
const AIM = 900;
/**
 * How long a bot that has to throw again waits once the tied throw has played
 * out: long enough to see where the pieces went back into the hand and read
 * that nobody won, before the stack comes back out.
 */
const RETHROW_PAUSE = 2600;

/**
 * Decides what a bot does on its turn, as the sequence of things a person
 * would have clicked. Returns nothing when it is not the bot's move.
 *
 * The bot plays honestly. It stakes a sensible slice of what it holds, builds
 * a stack without reading the physics, and throws somewhere reasonable. In
 * particular it does not exploit the fact that a piece tends to keep the face
 * it was stacked with, which a bot could do relentlessly and a person would
 * find unbearable.
 */
export function decide(
  view: TableView,
  playerId: string,
  random: () => number,
): BotStep[] {
  const me = view.players.find(player => player.id === playerId);
  if (!me || me.eliminated) return [];

  const isLauncher = view.launcherId === playerId;

  if (view.phase === 'wagering') {
    if (view.locked.includes(playerId)) return [];
    const most = maxWager(me);
    const teks = Math.min(
      most,
      Math.max(1, Math.round(most * (0.05 + random() * 0.1))),
    );
    return [
      { message: { type: 'wager', teks }, delay: THINK },
      { message: { type: 'wagersIn' }, delay: THINK },
    ];
  }

  if (view.phase === 'stacking' && isLauncher) {
    const steps: BotStep[] = [];
    // Turn one piece over now and then, and otherwise leave the stack be.
    if (random() < 0.45 && view.stack.length > 0) {
      const at = Math.floor(random() * view.stack.length);
      steps.push({
        message: {
          type: 'stack',
          stack: view.stack.map((entry, index) =>
            index === at ? { ...entry, flipped: !entry.flipped } : entry,
          ),
        },
        delay: THINK,
      });
    }
    steps.push({ message: { type: 'stackSet' }, delay: THINK });
    return steps;
  }

  // A tie is thrown again by the same launcher. A person decides when; a bot
  // just does it, once everyone has watched the tie land.
  if (
    view.phase === 'settled' &&
    view.outcome?.kind === 'rethrow' &&
    isLauncher
  ) {
    return [
      {
        message: { type: 'next' },
        delay: view.replaySeconds * 1000 + RETHROW_PAUSE,
      },
    ];
  }

  if (view.phase === 'aiming' && isLauncher) {
    const reach = ARENA_HALF_SIZE - STACK_ORIGIN.z;
    return [
      {
        message: {
          type: 'aim',
          tilt: TILT_MIN + random() * (TILT_MAX - TILT_MIN),
          target: {
            x: (random() - 0.5) * 1.6 * ARENA_HALF_SIZE,
            z: STACK_ORIGIN.z + (0.4 + random() * 0.55) * reach,
          },
        },
        delay: AIM,
      },
      { message: { type: 'throw' }, delay: AIM },
    ];
  }

  return [];
}
