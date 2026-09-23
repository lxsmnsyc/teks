import { Show, createSignal, onSettled, untrack } from 'solid-js';
import type { Connection } from './connection';
import { rememberedSeat } from './connection';
import type { Profile } from './profile';

export interface RoomGateProps {
  code: string;
  net: Connection;
  profile: Profile;
  onJoin: (code: string, name: string) => void;
  onBack: () => void;
}

/**
 * What someone sees when they open a room's link and are not in it yet.
 *
 * The link is the invitation, so all that is left to ask is a name. Someone
 * coming back to a room they were already in, after a reload, is put straight
 * back in their seat without being asked again.
 */
export function RoomGate(props: RoomGateProps) {
  const [problem, setProblem] = createSignal<string | null>(null);

  // Read here, not inside onSettled: a prop passed as an expression becomes
  // a memo on first read, and building one inside onSettled throws.
  const seat = untrack(() => rememberedSeat(props.code));
  const onJoin = untrack(() => props.onJoin);
  const rejoining = seat !== null;

  onSettled(() => {
    if (seat) onJoin(seat.code, seat.name);
  });

  return (
    <main class="gate">
      <form
        class="gate-card"
        onSubmit={event => {
          event.preventDefault();
          const name = props.profile.name().trim();
          if (!name) {
            setProblem('Put in a name first.');
            return;
          }
          setProblem(null);
          props.onJoin(props.code, name);
        }}
      >
        <span class="dialog-kicker">You have been invited to</span>
        <h1 class="gate-code">{props.code}</h1>

        <Show
          when={!rejoining || props.net.refusal()}
          fallback={<p class="hint">Taking your seat again…</p>}
        >
          <label class="field-stack">
            <span class="field-label">Your name</span>
            <input
              class="text-input"
              value={props.profile.name()}
              maxlength={16}
              autocomplete="nickname"
              placeholder="What should the table call you?"
              onInput={event => {
                props.profile.setName(event.currentTarget.value);
                setProblem(null);
              }}
            />
          </label>

          <button type="submit" class="primary big">
            {props.net.status() === 'open' ? 'Sit down' : 'Connecting…'}
          </button>
        </Show>

        <Show when={problem() ?? props.net.refusal()}>
          {reason => <p class="join-error">{reason()}</p>}
        </Show>

        <button type="button" class="link" onClick={() => props.onBack()}>
          Back to the games
        </button>
      </form>
    </main>
  );
}
