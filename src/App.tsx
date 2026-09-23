import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  untrack,
} from 'solid-js';
import './app.css';
import { GAME_VIEWS } from '~/games';
import { createConnection } from '~/platform/connection';
import { GameHub } from '~/platform/GameHub';
import { MainMenu } from '~/platform/MainMenu';
import { createProfile } from '~/platform/profile';
import type { GameId } from '~/platform/protocol';
import { RoomGate } from '~/platform/RoomGate';
import { createRouter } from '~/platform/route';

/**
 * The whole app: a menu of games, a page per game for getting into a room,
 * and the room itself, where the game takes over.
 *
 * There are no accounts. A player is a name typed on this device, and a room
 * lasts as long as somebody is in it.
 */
export default function App() {
  const net = createConnection();
  const profile = createProfile();
  const { route, navigate } = createRouter();

  /**
   * Set when this page asked to host or join, so that being seated takes the
   * player to the room. A seat restored after a dropped connection does not
   * count: that player may be looking at something else by then.
   */
  let heading = false;

  createEffect(
    () => net.room(),
    room => {
      if (!room || !heading) return;
      heading = false;
      navigate({ page: 'room', code: room.code });
    },
  );

  createEffect(
    () => net.refusal(),
    refusal => {
      if (refusal) heading = false;
    },
  );

  const host = (game: GameId, listed: boolean): void => {
    heading = true;
    net.host(game, profile.name().trim(), listed);
  };

  const join = (code: string, name: string): void => {
    heading = true;
    net.join(code, name);
  };

  const leave = (): void => {
    const game = net.room()?.game ?? 'teks';
    net.leave();
    navigate({ page: 'hub', game });
  };

  const hubGame = createMemo(() => {
    const current = route();
    return current.page === 'hub' ? current.game : null;
  });

  const roomCode = createMemo(() => {
    const current = route();
    return current.page === 'room' ? current.code : null;
  });

  /** The room on screen, once this client is actually sitting in it. */
  const seatedCode = createMemo(() => {
    const code = roomCode();
    return code !== null && net.room()?.code === code ? code : null;
  });

  return (
    <Switch>
      <Match when={route().page === 'menu'}>
        <MainMenu onPick={game => navigate({ page: 'hub', game })} />
      </Match>

      <Match when={hubGame()} keyed>
        {game => (
          <GameHub
            game={game}
            net={net}
            profile={profile}
            onBack={() => navigate({ page: 'menu' })}
            onHost={listed => host(game, listed)}
            onJoin={code => join(code, profile.name().trim())}
            onReturn={room => navigate({ page: 'room', code: room.code })}
          />
        )}
      </Match>

      <Match when={seatedCode()} keyed>
        {code => (
          <Show when={net.room()}>
            {room => {
              // The room is fixed for as long as this is on screen: a new
              // code remounts it, so which game it is never changes here.
              const View = untrack(() => GAME_VIEWS[room().game]);
              return <View net={net} room={room()} onLeave={leave} />;
            }}
          </Show>
        )}
      </Match>

      <Match when={roomCode()} keyed>
        {code => (
          <RoomGate
            code={code}
            net={net}
            profile={profile}
            onJoin={join}
            onBack={() => navigate({ page: 'menu' })}
          />
        )}
      </Match>
    </Switch>
  );
}
