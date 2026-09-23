import { createSignal } from 'solid-js';
import type { GameId } from './protocol';
import { GAME_IDS } from './protocol';

/**
 * Where the player is.
 *
 * `/` is the menu, `/teks` is a game's page for hosting and joining, and
 * `/room/ABC123` is a room. A room's address is its link: sending it to
 * someone is how they are invited.
 */
export type Route =
  | { page: 'menu' }
  | { page: 'hub'; game: GameId }
  | { page: 'room'; code: string };

function isGame(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

export function parseRoute(path: string, search: string): Route {
  // Links from before there were rooms carried the code as `?code=`.
  const legacy = new URLSearchParams(search).get('code');
  if (legacy) return { page: 'room', code: legacy.toUpperCase() };

  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'room' && parts[1]) {
    return { page: 'room', code: parts[1].toUpperCase() };
  }
  if (parts[0] && isGame(parts[0])) return { page: 'hub', game: parts[0] };
  return { page: 'menu' };
}

export function pathOf(route: Route): string {
  switch (route.page) {
    case 'menu':
      return '/';
    case 'hub':
      return `/${route.game}`;
    case 'room':
      return `/room/${route.code}`;
  }
}

/** The address of a room, for handing to someone. */
export function roomLink(code: string): string {
  return `${location.origin}/room/${code}`;
}

/**
 * The current route, kept in step with the address bar, so the back button
 * and shared links behave the way they would on any other site.
 */
export function createRouter() {
  const [route, setRoute] = createSignal<Route>(
    parseRoute(location.pathname, location.search),
  );

  addEventListener('popstate', () => {
    setRoute(parseRoute(location.pathname, location.search));
  });

  const navigate = (next: Route, replace = false): void => {
    const path = pathOf(next);
    if (path !== location.pathname || location.search) {
      if (replace) history.replaceState(null, '', path);
      else history.pushState(null, '', path);
    }
    setRoute(next);
  };

  // Tidy an old `?code=` link into the room's own address. Only the address
  // bar changes: the route was already read from the link, and setting it
  // again here would write to a signal while the app is still being built.
  if (location.search) {
    history.replaceState(
      null,
      '',
      pathOf(parseRoute(location.pathname, location.search)),
    );
  }

  return { route, navigate };
}
