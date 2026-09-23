import { For, Show } from 'solid-js';
import type { Player } from '~/games/teks/rules/round';
import { hex, inkOn } from './colour';

/**
 * `victory` and `defeat` are the end of the game, seen by the one who won it
 * and by everyone else. `out` is being knocked out while the others play on.
 */
export type EndKind = 'victory' | 'defeat' | 'out';

export interface EndScreenProps {
  kind: EndKind;
  /** The line under the title. */
  detail: string;
  /** Everyone, best placed first. */
  standings: Player[];
  /** Who holds everything, once there is such a player. */
  championId?: string;
  you: string;
  rounds: number;
  colorOf: (playerId: string) => number;
  primaryLabel: string;
  onPrimary: () => void;
}

const TITLE: Record<EndKind, string> = {
  victory: 'Victory!',
  defeat: 'Defeat',
  out: 'You’re out',
};

/**
 * Teks falling behind the title, for the winner. Fixed rather than random, so
 * the screen looks the same every time and nothing re-rolls on a redraw.
 */
const SHOWER = Array.from({ length: 18 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: (index * 0.23) % 2.4,
  duration: 2.6 + ((index * 0.41) % 1.6),
  spin: index % 2 === 0 ? 1 : -1,
}));

export function EndScreen(props: EndScreenProps) {
  return (
    <div class="end-backdrop" data-kind={props.kind}>
      <Show when={props.kind === 'victory'}>
        <div class="shower" aria-hidden="true">
          <For each={SHOWER}>
            {drop => (
              <span
                class="tek falling"
                style={{
                  left: `${drop.left}%`,
                  'animation-delay': `${drop.delay}s`,
                  'animation-duration': `${drop.duration}s`,
                  '--spin': String(drop.spin),
                }}
              />
            )}
          </For>
        </div>
      </Show>

      <section class="end-card" data-kind={props.kind}>
        <Show when={props.kind === 'victory'}>
          <div class="rays" aria-hidden="true" />
        </Show>

        <h1 class="end-title">{TITLE[props.kind]}</h1>
        <p class="end-detail">{props.detail}</p>

        <ol class="standings">
          <For each={props.standings}>
            {(player, index) => (
              <li
                class="standing"
                data-you={player.id === props.you ? 'true' : 'false'}
                data-champion={
                  player.id === props.championId ? 'true' : 'false'
                }
                data-out={player.eliminated ? 'true' : 'false'}
                style={{
                  '--player': hex(props.colorOf(player.id)),
                  '--player-ink': inkOn(props.colorOf(player.id)),
                  '--i': String(index()),
                }}
              >
                <span class="standing-place">{index() + 1}</span>
                <span class="standing-name">
                  {player.name}
                  <Show when={player.id === props.you}>
                    <span class="tag">you</span>
                  </Show>
                </span>
                <span class="standing-teks">
                  <Show
                    when={!player.eliminated}
                    fallback={<span class="standing-out">out</span>}
                  >
                    <span class="tek" aria-hidden="true" />
                    {player.teks}
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ol>

        <p class="end-rounds">
          {props.rounds} {props.rounds === 1 ? 'round' : 'rounds'}
        </p>

        <button type="button" class="primary big" onClick={props.onPrimary}>
          {props.primaryLabel}
        </button>
      </section>
    </div>
  );
}
