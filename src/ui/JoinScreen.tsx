import { Show, createSignal } from 'solid-js';
import type { Status } from '~/net/client';

export interface JoinScreenProps {
  status: Status;
  refusal: string | null;
  onJoin: (code: string, name: string) => void;
}

/**
 * The door.
 *
 * Having the link is not enough: the host reads the join code out, and only
 * someone who has heard it can sit down. That is the whole of the access
 * control, and it is meant to be, because the alternative for a game played
 * among people who already know each other is an account system nobody wants.
 */
/**
 * A code carried in the address, so the host can hand out one link that opens
 * straight onto the name field.
 *
 * Sharing that link is the host giving away the code, which is theirs to do.
 * The plain link, with the code read out separately, is still the careful way
 * and is what the server prints alongside it.
 */
function codeFromAddress(): string {
  try {
    return (
      new URLSearchParams(location.search).get('code') ?? ''
    ).toUpperCase();
  } catch {
    return '';
  }
}

export function JoinScreen(props: JoinScreenProps) {
  /**
   * The code from the link, shown as settled text rather than put in a box.
   *
   * A join code in an input is a value anything may overwrite: autofill, a
   * password manager, and the form restore a browser performs on reload all
   * write to the field after the page's own script has run, and some of them
   * announce it as ordinary typing. The code then looks right on screen while
   * a stale one is what gets sent, and the server rightly refuses it. Nothing
   * can overwrite text that is not an input, so when the link carries a code
   * the box only appears if the player asks for it.
   */
  const addressCode = codeFromAddress();
  const [typing, setTyping] = createSignal(addressCode.length !== 6);

  const [code, setCode] = createSignal(addressCode);
  const [name, setName] = createSignal('');
  const [complained, setComplained] = createSignal<string | null>(null);
  const [sent, setSent] = createSignal<string | null>(null);

  /**
   * The button is never disabled.
   *
   * A value can land in a field without the browser telling us about it, which
   * leaves the field looking filled while our signal is still empty. A button
   * disabled off that signal then refuses a form the player can plainly see is
   * complete, with nothing on screen to explain it. Saying what is missing
   * cannot fail that way.
   */
  function submit(form: HTMLFormElement): void {
    const fields = form.elements as HTMLFormControlsCollection & {
      code?: HTMLInputElement;
      name: HTMLInputElement;
    };
    const chosen = typing()
      ? (fields.code?.value ?? '').trim().toUpperCase()
      : addressCode;
    const chosenName = fields.name.value.trim();

    setCode(chosen);
    setName(chosenName);

    if (chosenName.length === 0) {
      setComplained('Put in a name first.');
      return;
    }
    if (chosen.length !== 6) {
      setComplained('The join code is six characters.');
      return;
    }

    setComplained(null);
    setSent(chosen);
    props.onJoin(chosen, chosenName);
  }

  return (
    <main class="join">
      <form
        class="join-card"
        onSubmit={event => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
      >
        <h1>Teks</h1>
        <p class="hint">Ask the host for the join code.</p>

        <Show
          when={typing()}
          fallback={
            <div class="join-field">
              <span>Join code</span>
              <p class="join-code">{addressCode}</p>
              <button
                type="button"
                class="link"
                onClick={() => {
                  setCode('');
                  setTyping(true);
                }}
              >
                Use a different code
              </button>
            </div>
          }
        >
          <label class="join-field">
            <span>Join code</span>
            <input
              name="code"
              value={code()}
              maxlength={6}
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              placeholder="ABC123"
              onInput={event => {
                setCode(event.currentTarget.value.toUpperCase());
                setComplained(null);
              }}
            />
          </label>
        </Show>

        <label class="join-field">
          <span>Your name</span>
          <input
            name="name"
            value={name()}
            maxlength={16}
            autocomplete="off"
            placeholder="Alexis"
            onInput={event => {
              setName(event.currentTarget.value);
              setComplained(null);
            }}
          />
        </label>

        <button type="submit" class="primary">
          {props.status === 'open' ? 'Sit down' : 'Connecting…'}
        </button>

        <Show when={complained()}>
          {reason => <p class="join-error">{reason()}</p>}
        </Show>

        <Show when={props.refusal}>
          {reason => (
            <p class="join-error">
              {reason()}
              <Show when={sent()}>
                {code => <span class="hint"> Sent {code()}.</span>}
              </Show>
            </p>
          )}
        </Show>
      </form>
    </main>
  );
}
