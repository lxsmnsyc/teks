import { For, Match, Switch } from 'solid-js';
import type { GameId } from './protocol';

/** Colours for the little pieces in the Teks tile, from the player palette. */
const TEKS_CARDS = ['#e4572e', '#30a9de', '#f4d35e'];

/** A small picture of each game, for its tile and its page. */
export function GameArt(props: { game: GameId }) {
  return (
    <span class="game-art" data-game={props.game} aria-hidden="true">
      <Switch>
        <Match when={props.game === 'teks'}>
          <For each={TEKS_CARDS}>
            {(colour, index) => (
              <span
                class="game-art-card"
                style={{ '--card': colour, '--i': String(index() - 1) }}
              />
            )}
          </For>
        </Match>
      </Switch>
    </span>
  );
}
