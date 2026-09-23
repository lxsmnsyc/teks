import type { GameId } from '~/platform/protocol';
import { teks } from './teks';
import type { GameServer } from './types';

/** Every game the server can host, by the id the client asks for. */
export const GAMES: Record<GameId, GameServer> = {
  teks,
};
