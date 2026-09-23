import type { JSX } from '@solidjs/web';
import type { Connection } from '~/platform/connection';
import type { GameId, RoomInfo } from '~/platform/protocol';
import { TeksGame } from './teks/TeksGame';

/** What the platform hands a game once the player is in one of its rooms. */
export interface GameViewProps {
  net: Connection;
  room: RoomInfo;
  /** Gets up from the table and goes back to the game's page. */
  onLeave: () => void;
}

/** Each game's client, by id. */
export const GAME_VIEWS: Record<GameId, (props: GameViewProps) => JSX.Element> =
  {
    teks: TeksGame,
  };
