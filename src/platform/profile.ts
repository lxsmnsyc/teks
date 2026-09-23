import { createSignal } from 'solid-js';

/**
 * The name this device plays under.
 *
 * There are no accounts. The name is kept in the browser so it does not have
 * to be typed again, and it never goes anywhere except to the rooms the player
 * sits down in.
 */
const NAME_KEY = 'laro.name';

function read(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function createProfile() {
  const [name, setName] = createSignal(read());
  return {
    name,
    setName: (next: string) => {
      setName(next);
      try {
        localStorage.setItem(NAME_KEY, next.trim());
      } catch {
        // Unavailable storage only means typing the name again next time.
      }
    },
  };
}

export type Profile = ReturnType<typeof createProfile>;
