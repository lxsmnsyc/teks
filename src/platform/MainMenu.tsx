import { For } from 'solid-js';
import type { GameId } from './protocol';
import { APP_NAME, GAMES } from './games';
import { GameArt } from './GameArt';

export interface MainMenuProps {
  onPick: (game: GameId) => void;
}

/** The front door: every game there is to play. */
export function MainMenu(props: MainMenuProps) {
  return (
    <main class="menu">
      <header class="menu-head">
        <h1 class="brand">{APP_NAME}</h1>
        <p class="menu-lede">
          Filipino games to play together. Pick one, host a room, and send the
          link to whoever is playing.
        </p>
      </header>

      <section class="game-grid" aria-label="Games">
        <For each={GAMES}>
          {game => (
            <button
              type="button"
              class="game-tile"
              onClick={() => props.onPick(game.id)}
            >
              <GameArt game={game.id} />
              <span class="game-tile-body">
                <span class="game-tile-name">{game.name}</span>
                <span class="game-tile-tagline">{game.tagline}</span>
                <span class="game-tile-players">
                  {game.players.min}–{game.players.max} players
                </span>
              </span>
            </button>
          )}
        </For>

        <div class="game-tile game-tile-soon" aria-disabled="true">
          <span class="game-tile-body">
            <span class="game-tile-name">More soon</span>
            <span class="game-tile-tagline">Other games are on the way.</span>
          </span>
        </div>
      </section>

      <p class="menu-foot">
        No accounts. Your name stays on this device, and nothing about a game is
        kept once it is over.
      </p>
    </main>
  );
}
