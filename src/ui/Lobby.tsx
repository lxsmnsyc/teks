import { For, Show } from 'solid-js';
import { COLOUR_COUNT, MAX_PLAYERS, MIN_PLAYERS, TEKS_RANGE } from '~/net/view';
import type { TableView } from '~/net/view';
import { OWNER_COLORS } from '~/render/pieceMeshes';

export interface LobbyProps {
  view: TableView;
  onColour: (colour: number) => void;
  onStartingTeks: (teks: number) => void;
  onAddBot: () => void;
  onRemoveBot: () => void;
  onStart: () => void;
}

function swatch(colour: number): string {
  return `#${OWNER_COLORS[colour].toString(16).padStart(6, '0')}`;
}

/**
 * The table before it is a game.
 *
 * Nothing starts by itself. People arrive, pick a colour, and the host decides
 * when there are enough of them and what everyone is playing for. Until then
 * the door stays open, which is the whole reason this screen exists: an
 * earlier version began the moment a third player sat down and shut out
 * everyone still on their way.
 */
export function Lobby(props: LobbyProps) {
  const isHost = () => props.view.you === props.view.hostId;
  const seated = () => props.view.players.length;
  const humans = () =>
    props.view.players.filter(player => !props.view.bots.includes(player.id));
  const canStart = () => seated() >= MIN_PLAYERS && humans().length > 0;
  const takenBy = (colour: number) =>
    Object.entries(props.view.colours).find(
      ([seat, taken]) => taken === colour && seat !== props.view.you,
    );

  return (
    <section class="panel">
      <header class="panel-head">
        <h2>Lobby</h2>
        <span class="join-code" title="Read this out to the others">
          {props.view.joinCode}
        </span>
      </header>

      <p class="hint">
        {seated()} of {MAX_PLAYERS} seated, {MIN_PLAYERS} needed.
        {isHost() ? ' You are the host.' : ' Waiting for the host to start.'}
      </p>

      <ul class="seats">
        <For each={props.view.players}>
          {player => (
            <li class="seat">
              <span
                class="chip"
                style={{
                  background: swatch(props.view.colours[player.id] ?? 0),
                }}
              />
              <span class="seat-name">
                {player.name}
                <Show when={player.id === props.view.hostId}>
                  <span class="badge">host</span>
                </Show>
                <Show when={props.view.bots.includes(player.id)}>
                  <span class="badge">bot</span>
                </Show>
                <Show when={player.id === props.view.you}>
                  <span class="badge">you</span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>

      <div class="field-block">
        <span class="field-label">Your colour</span>
        <div class="colours">
          <For each={Array.from({ length: COLOUR_COUNT }, (_, i) => i)}>
            {colour => (
              <button
                type="button"
                class="colour"
                style={{ background: swatch(colour) }}
                aria-pressed={
                  props.view.colours[props.view.you] === colour
                    ? 'true'
                    : 'false'
                }
                disabled={takenBy(colour) !== undefined}
                title={takenBy(colour) ? 'Taken' : 'Take this colour'}
                onClick={() => props.onColour(colour)}
              />
            )}
          </For>
        </div>
      </div>

      <Show when={isHost()}>
        <label class="field">
          <span>Starting teks</span>
          <input
            type="range"
            min={TEKS_RANGE.min}
            max={TEKS_RANGE.max}
            step={10}
            value={props.view.startingTeks}
            onInput={event =>
              props.onStartingTeks(event.currentTarget.valueAsNumber)
            }
          />
          <output>{props.view.startingTeks}</output>
        </label>

        <div class="actions">
          <button
            type="button"
            disabled={seated() >= MAX_PLAYERS}
            onClick={props.onAddBot}
          >
            Add a bot
          </button>
          <button
            type="button"
            disabled={props.view.bots.length === 0}
            onClick={props.onRemoveBot}
          >
            Remove a bot
          </button>
        </div>

        <div class="actions">
          <button
            type="button"
            class="primary"
            disabled={!canStart()}
            onClick={props.onStart}
          >
            {canStart()
              ? 'Start the game'
              : `Need ${MIN_PLAYERS - seated()} more`}
          </button>
        </div>
      </Show>
    </section>
  );
}
