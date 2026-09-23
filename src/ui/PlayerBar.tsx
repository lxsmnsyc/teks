import { For, Show, untrack } from 'solid-js';
import type { Player } from '~/rules/round';
import { hex, inkOn } from './colour';

export interface PlayerBarProps {
  players: Player[];
  launcherId: string;
  you: string;
  bots: string[];
  present: string[];
  /** What each player has staked this round, when there is a round. */
  wagers: Record<string, number>;
  /** Players whose wager is in. */
  locked: string[];
  /** Whether stakes are worth showing yet. */
  showWagers: boolean;
  /** Players who have just won the round. */
  winners: string[];
  colorOf: (playerId: string) => number;
  /**
   * The teks to show for a player. Usually what they hold, but while the
   * payout is being animated it runs from what they held to what they will.
   */
  teksOf: (playerId: string) => number;
  /** Whether a player is out, as far as the screen is concerned yet. */
  outOf: (playerId: string) => boolean;
  /** Hands each player's box to whoever animates teks between them. */
  onAnchor: (playerId: string, element: HTMLElement) => void;
}

/**
 * Everyone at the table along the top of the screen, in their own colour:
 * who they are, what they hold, and what they have put up this round.
 */
export function PlayerBar(props: PlayerBarProps) {
  return (
    <ol class="player-bar">
      <For each={props.players} keyed={player => player.id}>
        {player => {
          // Boxes are keyed by player, so this never changes for this box.
          const id = untrack(() => player().id);
          const colour = () => props.colorOf(id);
          return (
            <li
              class="player"
              data-you={id === props.you ? 'true' : 'false'}
              data-out={props.outOf(id) ? 'true' : 'false'}
              data-winner={props.winners.includes(id) ? 'true' : 'false'}
              data-launcher={id === props.launcherId ? 'true' : 'false'}
              style={{
                '--player': hex(colour()),
                '--player-ink': inkOn(colour()),
              }}
              ref={element => props.onAnchor(id, element)}
            >
              <div class="player-head">
                <span class="player-name">{player().name}</span>
                <Show when={id === props.you}>
                  <span class="tag">you</span>
                </Show>
                <Show when={props.bots.includes(id)}>
                  <span class="tag">bot</span>
                </Show>
                <Show
                  when={!props.bots.includes(id) && !props.present.includes(id)}
                >
                  <span class="tag">away</span>
                </Show>
              </div>

              <div class="player-teks" title="Teks held">
                <span class="tek" aria-hidden="true" />
                <span class="player-teks-count">{props.teksOf(id)}</span>
              </div>

              <div class="player-foot">
                <Show
                  when={!props.outOf(id)}
                  fallback={<span class="player-status">out</span>}
                >
                  <Show when={id === props.launcherId}>
                    <span class="player-status" data-kind="throws">
                      throws
                    </span>
                  </Show>
                  <Show when={props.showWagers}>
                    <span
                      class="player-wager"
                      data-locked={props.locked.includes(id) ? 'true' : 'false'}
                      title="Staked this round"
                    >
                      {props.locked.includes(id)
                        ? `stakes ${props.wagers[id] ?? 0}`
                        : 'deciding…'}
                    </span>
                  </Show>
                </Show>
              </div>
            </li>
          );
        }}
      </For>
    </ol>
  );
}
