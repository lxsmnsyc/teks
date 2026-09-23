import { For, Show, createSignal, untrack } from 'solid-js';
import { getPamato } from '~/data/pamatos';
import type { Player } from '~/rules/round';
import { maxWager } from '~/rules/round';

export interface WagerDialogProps {
  player: Player;
  round: number;
  /** What the table has this player down for, as a starting point. */
  suggested: number;
  onPamato: (pamatoId: string) => void;
  onConfirm: (teks: number) => void;
}

/**
 * Asks one player what they are putting up this round, and, if they have won
 * pamatos from others, which one they are throwing.
 *
 * Nothing is sent until the player commits. The wager and the lock go out
 * together, so the table never shows a half-made choice.
 */
export function WagerDialog(props: WagerDialogProps) {
  const most = () => Math.max(1, maxWager(props.player));
  const clampWager = (teks: number) =>
    Math.min(most(), Math.max(1, Math.round(teks) || 1));

  // Where the slider starts. Read once: after this the player owns it.
  const [amount, setAmount] = createSignal(
    untrack(() => clampWager(props.suggested)),
  );

  /** Quick picks, as fractions of the most this player can stake. */
  const presets = () => {
    const top = most();
    const picks = [
      { label: 'Min', teks: 1 },
      { label: '10%', teks: Math.round(top * 0.1) },
      { label: '25%', teks: Math.round(top * 0.25) },
      { label: 'Half', teks: Math.round(top * 0.5) },
      { label: 'All in', teks: top },
    ];
    return picks.map(pick => ({ ...pick, teks: clampWager(pick.teks) }));
  };

  return (
    <div class="dialog-backdrop">
      <form
        class="dialog wager-dialog"
        onSubmit={event => {
          event.preventDefault();
          props.onConfirm(amount());
        }}
      >
        <header class="dialog-head">
          <span class="dialog-kicker">Round {props.round}</span>
          <h2>Your wager</h2>
        </header>

        <div class="wager-amount">
          <span class="tek tek-large" aria-hidden="true" />
          <output>{amount()}</output>
        </div>

        <input
          class="wager-slider"
          type="range"
          min={1}
          max={most()}
          step={1}
          value={amount()}
          aria-label="Wager"
          onInput={event =>
            setAmount(clampWager(event.currentTarget.valueAsNumber))
          }
        />

        <div class="presets">
          <For each={presets()}>
            {pick => (
              <button
                type="button"
                class="preset"
                aria-pressed={amount() === pick.teks ? 'true' : 'false'}
                onClick={() => setAmount(pick.teks)}
              >
                {pick.label}
              </button>
            )}
          </For>
        </div>

        <p class="dialog-note">
          Win the round and everyone else pays you this much. Lose, and you pay
          what the winner staked. You hold {props.player.teks}.
        </p>

        <Show when={props.player.pamatoIds.length > 1}>
          <div class="pamato-pick">
            <span class="dialog-kicker">Throw with</span>
            <div class="pamato-options">
              <For each={props.player.pamatoIds}>
                {pamatoId => (
                  <button
                    type="button"
                    class="pamato-option"
                    aria-pressed={
                      props.player.activePamatoId === pamatoId
                        ? 'true'
                        : 'false'
                    }
                    title={getPamato(pamatoId).tagline}
                    onClick={() => props.onPamato(pamatoId)}
                  >
                    {getPamato(pamatoId).name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <button type="submit" class="primary big">
          Wager in
        </button>
      </form>
    </div>
  );
}
