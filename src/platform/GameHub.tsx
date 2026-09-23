import { For, Show, createSignal, onSettled, untrack } from 'solid-js';
import type { Connection } from './connection';
import { GameArt } from './GameArt';
import { gameInfo } from './games';
import type { Profile } from './profile';
import type { GameId, RoomInfo } from './protocol';

/** How often the list of open lobbies is refreshed, in milliseconds. */
const LOBBY_REFRESH = 4000;

export interface GameHubProps {
  game: GameId;
  net: Connection;
  profile: Profile;
  onBack: () => void;
  onHost: (listed: boolean) => void;
  onJoin: (code: string) => void;
  /** Goes back to the room this player is already sitting in. */
  onReturn: (room: RoomInfo) => void;
}

/**
 * A game's own page: the name to play under, and the three ways into a room.
 * Hosting one, typing a code someone read out, or picking an open lobby from
 * the list.
 */
export function GameHub(props: GameHubProps) {
  const info = () => gameInfo(props.game);
  const [listed, setListed] = createSignal(false);
  const [code, setCode] = createSignal('');
  const [problem, setProblem] = createSignal<string | null>(null);

  // Read here, not inside onSettled: a prop passed as an expression becomes
  // a memo on first read, and building one inside onSettled throws.
  const game = untrack(() => props.game);
  const net = untrack(() => props.net);

  onSettled(() => {
    net.requestRooms(game);
    const timer = setInterval(() => net.requestRooms(game), LOBBY_REFRESH);
    return () => clearInterval(timer);
  });

  /** Everything below needs a name first. */
  const named = (): boolean => {
    if (props.profile.name().trim().length > 0) return true;
    setProblem('Put in a name first.');
    return false;
  };

  const lobbies = () =>
    props.net.rooms().filter(room => room.game === props.game);

  return (
    <main class="hub">
      <header class="hub-head">
        <button type="button" class="back" onClick={() => props.onBack()}>
          ← Games
        </button>
        <div class="hub-title">
          <GameArt game={props.game} />
          <div>
            <h1>{info().name}</h1>
            <p class="hub-about">{info().about}</p>
          </div>
        </div>
      </header>

      <Show when={props.net.room()}>
        {room => (
          <button
            type="button"
            class="return-banner"
            onClick={() => props.onReturn(room())}
          >
            You are still in room <strong>{room().code}</strong>. Go back to it
            →
          </button>
        )}
      </Show>

      <div class="hub-grid">
        <section class="hub-card hub-name">
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
        </section>

        <section class="hub-card">
          <h2>Host a room</h2>
          <p class="hint">
            You run the lobby: who plays, bots, and when it starts.
          </p>
          <div class="segmented" role="radiogroup" aria-label="Who can find it">
            <button
              type="button"
              class="segment"
              role="radio"
              aria-checked={listed() ? 'false' : 'true'}
              onClick={() => setListed(false)}
            >
              Private
            </button>
            <button
              type="button"
              class="segment"
              role="radio"
              aria-checked={listed() ? 'true' : 'false'}
              onClick={() => setListed(true)}
            >
              Public
            </button>
          </div>
          <p class="hint">
            {listed()
              ? 'Anyone can find it under open lobbies.'
              : 'Only people you give the code or link to can join.'}
          </p>
          <button
            type="button"
            class="primary big"
            onClick={() => {
              if (named()) props.onHost(listed());
            }}
          >
            Host
          </button>
        </section>

        <section class="hub-card">
          <h2>Join with a code</h2>
          <p class="hint">Ask the host for their six-character code.</p>
          <form
            class="join-row"
            onSubmit={event => {
              event.preventDefault();
              const typed = code().trim().toUpperCase();
              if (typed.length !== 6) {
                setProblem('A room code is six characters.');
                return;
              }
              if (named()) props.onJoin(typed);
            }}
          >
            <input
              class="text-input code-input"
              value={code()}
              maxlength={6}
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              placeholder="ABC123"
              aria-label="Room code"
              onInput={event => {
                setCode(event.currentTarget.value.toUpperCase());
                setProblem(null);
              }}
            />
            <button type="submit" class="primary big">
              Join
            </button>
          </form>
        </section>

        <section class="hub-card hub-lobbies">
          <h2>Open lobbies</h2>
          <Show
            when={lobbies().length > 0}
            fallback={
              <p class="hint">
                Nobody has a public room open right now. Host one!
              </p>
            }
          >
            <ul class="lobby-list">
              <For each={lobbies()} keyed={room => room.code}>
                {room => (
                  <li class="lobby-row">
                    <span class="lobby-host">{room().hostName}’s room</span>
                    <span class="lobby-seats">
                      {room().seated} / {room().capacity}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (named()) props.onJoin(room().code);
                      }}
                    >
                      Join
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>

      <Show when={problem() ?? props.net.refusal()}>
        {reason => <p class="hub-problem">{reason()}</p>}
      </Show>

      <Show when={props.net.status() !== 'open'}>
        <p class="hub-status">Connecting…</p>
      </Show>
    </main>
  );
}
