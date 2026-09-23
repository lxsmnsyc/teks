import type { GameId } from './protocol';

/** A game as the menu shows it. */
export interface GameInfo {
  id: GameId;
  name: string;
  /** One line, under the name. */
  tagline: string;
  /** A few sentences, on the game's own page. */
  about: string;
  players: { min: number; max: number };
}

export const GAMES: GameInfo[] = [
  {
    id: 'teks',
    name: 'Teks',
    tagline: 'Stack the pamatos, throw, and hope yours is the odd face out.',
    about:
      'Everyone wagers teks. One player stacks every pamato and throws the ' +
      'lot. The piece that lands differently from all the others wins the ' +
      'round, and the last player holding teks wins the game.',
    players: { min: 3, max: 6 },
  },
];

export function gameInfo(id: GameId): GameInfo {
  const found = GAMES.find(game => game.id === id);
  if (!found) throw new Error(`unknown game "${id}"`);
  return found;
}

/** What the platform calls itself: "laro" is Filipino for a game, or play. */
export const APP_NAME = 'Laro';
