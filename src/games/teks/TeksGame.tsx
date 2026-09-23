import {
  Errored,
  Show,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from 'solid-js';
import './teks.css';
import { getPamato } from '~/games/teks/data/pamatos';
import { ownerColor } from '~/games/teks/render/pieceMeshes';
import type { Player, RoundOutcome } from '~/games/teks/rules/round';
import { PANABLA_ID, findGameWinner } from '~/games/teks/rules/round';
import type { SimPiece } from '~/games/teks/sim/types';
import type { Aim, PiecePose } from '~/games/teks/ui/ArenaCanvas';
import { ArenaCanvas } from '~/games/teks/ui/ArenaCanvas';
import { Banner } from '~/games/teks/ui/Banner';
import type { EndKind } from '~/games/teks/ui/EndScreen';
import { EndScreen } from '~/games/teks/ui/EndScreen';
import { Hand } from '~/games/teks/ui/Hand';
import { Lobby } from '~/games/teks/ui/Lobby';
import { PlayerBar } from '~/games/teks/ui/PlayerBar';
import { WagerDialog } from '~/games/teks/ui/WagerDialog';
import { flyTeks } from '~/games/teks/ui/payout';
import type { Connection } from '~/platform/connection';
import type { RoomInfo } from '~/platform/protocol';
import { roomLink } from '~/platform/route';
import type { TeksMessage } from './protocol';
import type { SimResult } from './sim/types';
import type { TableView, ThrowResult } from './view';
import { decodeFrames } from './view';

/** Aim updates are sent no more often than this, in milliseconds. */
const AIM_INTERVAL = 60;

/** Pause between the pieces coming to rest and the teks starting to move. */
const PAYOUT_DELAY = 600;
/**
 * Longest the arena is given to put the pieces back in the hand. It normally
 * reports back well before this; the limit is for when it cannot, such as
 * when the arena failed to draw at all, so the round can still be moved on.
 */
const GATHER_LIMIT = 1600;

/** How long a refusal stays on screen, in milliseconds. */
const TOAST_TIME = 3500;

/** How much of the canvas the interface covers, top and bottom, in pixels. */
const ARENA_INSET = { top: 110, bottom: 250 };

/**
 * Where the client is in a round.
 *
 * Mostly this is the server's phase. A settled round is split further, because
 * the server settles the moment the throw is simulated but the people at the
 * table still have to watch it land, see the teks change hands, and see the
 * pieces picked back up before the next round makes sense.
 */
type Stage =
  | 'lobby'
  | 'wagering'
  | 'stacking'
  | 'aiming'
  | 'throwing'
  | 'replaying'
  | 'payout'
  | 'gathering'
  | 'settled'
  | 'over';

function describe(
  outcome: RoundOutcome,
  nameOf: (pieceId: string) => string,
): string {
  if (outcome.kind === 'rethrow') {
    return `No winner: ${outcome.reason}. Same launcher throws again.`;
  }
  const names = outcome.winners.map(winner => nameOf(winner.pieceId));
  if (outcome.by === 'unique') {
    return `${names[0]} is the odd one out and takes the round!`;
  }
  return `${names.join(' and ')} were the smaller side and split the round!`;
}

function degrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI);
}

export interface TeksGameProps {
  net: Connection;
  room: RoomInfo;
  /** Gets up from the table and goes back to the game's page. */
  onLeave: () => void;
}

/**
 * A game of Teks, in one room.
 *
 * The client keeps no game state. It draws whatever table the server last
 * described and sends back what the person did, so nothing here decides
 * anything: not the wagers, not the throw, not who won. What it does own is
 * pacing: holding the result back until the throw has been watched, then
 * paying it out, then putting the pieces away.
 */
export function TeksGame(props: TeksGameProps) {
  const stateMessage = props.net.gameMessage('state');
  const resultMessage = props.net.gameMessage('result');

  const view = createMemo<TableView | null>(
    () => (stateMessage() as { view: TableView } | null)?.view ?? null,
  );

  /** The latest throw, unpacked for the replay. */
  const result = createMemo<SimResult | null>(() => {
    const message = resultMessage() as { result: ThrowResult } | null;
    if (!message) return null;
    return {
      faces: message.result.faces,
      frameCount: message.result.frameCount,
      frames: decodeFrames(message.result.frames),
      steps: 0,
      edgeResolutions: 0,
      recoveries: 0,
      timedOut: false,
    };
  });

  const you = () => props.net.you();
  const send = (message: TeksMessage): void => props.net.sendGame(message);
  const [confirmingLeave, setConfirmingLeave] = createSignal(false);

  const [revealed, setRevealed] = createSignal(false);
  const [paidOut, setPaidOut] = createSignal(false);
  const [gathered, setGathered] = createSignal(false);
  /** How far through the payout the counters are, from 0 to 1. */
  const [payoutProgress, setPayoutProgress] = createSignal(0);
  /**
   * Set when this player presses Throw, until the server says the throw is
   * under way. Aiming stops at once, rather than when the server's answer
   * arrives: a drag in between would send an aim for a throw that has already
   * gone, which the server refuses.
   */
  const [throwing, setThrowing] = createSignal(false);

  // A fresh throw means a fresh replay to watch, payout to run and pieces to
  // pick up. This has to be an effect: a memo is a pure computation and must
  // not write to a signal, which the runtime reports as
  // REACTIVE_WRITE_IN_OWNED_SCOPE.
  createEffect(
    () => result(),
    () => {
      setRevealed(false);
      setPaidOut(false);
      setGathered(false);
      setPayoutProgress(0);
    },
  );

  const stage = createMemo<Stage>(() => {
    const current = view();
    if (!current) return 'lobby';
    switch (current.phase) {
      case 'waiting':
        return 'lobby';
      case 'settled':
        // Someone who arrives after the throw has no replay to watch.
        if (!revealed() && result() !== null) return 'replaying';
        if (current.settlement && !paidOut()) return 'payout';
        if (!gathered()) return 'gathering';
        return 'settled';
      case 'replaying':
        return 'replaying';
      default:
        return current.phase;
    }
  });

  createEffect(
    () => stage(),
    current => {
      if (current !== 'aiming') setThrowing(false);
    },
  );

  const pose = createMemo<PiecePose>(() => {
    switch (stage()) {
      case 'stacking':
      case 'aiming':
      case 'throwing':
        return 'stack';
      case 'replaying':
      case 'payout':
        return 'replay';
      default:
        return 'hand';
    }
  });

  const players = () => view()?.players ?? [];
  const pieces = () => view()?.pieces ?? [];
  const launcherId = () => view()?.launcherId ?? '';
  const isLauncher = () => you() !== null && you() === launcherId();
  const me = () => players().find(player => player.id === you());

  const simPieces = createMemo<SimPiece[]>(() =>
    pieces().map(piece => ({
      id: piece.pieceId,
      ownerId: piece.ownerId ?? PANABLA_ID,
      spec: getPamato(piece.pamatoId),
    })),
  );

  const seatIndex = (playerId: string) =>
    players().findIndex(player => player.id === playerId);

  // Colours are the players' own choice, made in the lobby, so they travel
  // with the table rather than being derived from where someone is sitting.
  const colourOf = (pieceId: string) => {
    if (pieceId === PANABLA_ID) return 0x8ea0b0;
    const chosen = view()?.colours?.[pieceId];
    return ownerColor(chosen ?? seatIndex(pieceId));
  };

  const nameOf = (pieceId: string) => {
    if (pieceId === PANABLA_ID) return 'Panabla';
    return players().find(player => player.id === pieceId)?.name ?? pieceId;
  };

  const pamatoOf = (pieceId: string) =>
    pieces().find(piece => piece.pieceId === pieceId)?.pamatoId ?? 'baraha';

  const aim = createMemo<Aim>(() => {
    const current = view();
    return {
      tilt: current?.tilt ?? Math.PI / 2,
      target: current?.target ?? { x: 0, z: 0 },
    };
  });

  /** The throw this round, and only this round. */
  const throwResult = () => (view()?.phase === 'settled' ? result() : null);

  // What each player holds on screen. The server settles before the throw
  // has been watched, so until the payout runs the old amounts are shown, and
  // while it runs they count across from one to the other.
  const settledPlayer = (playerId: string) =>
    view()?.settlement?.players.find(player => player.id === playerId);

  const teksOf = (playerId: string): number => {
    const before = players().find(player => player.id === playerId)?.teks ?? 0;
    const after = settledPlayer(playerId)?.teks;
    if (view()?.phase !== 'settled' || after === undefined) return before;
    switch (stage()) {
      case 'replaying':
        return before;
      case 'payout':
        return Math.round(before + (after - before) * payoutProgress());
      default:
        return after;
    }
  };

  const outOf = (playerId: string): boolean => {
    const before =
      players().find(player => player.id === playerId)?.eliminated ?? false;
    if (stage() === 'replaying' || stage() === 'payout') return before;
    return settledPlayer(playerId)?.eliminated ?? before;
  };

  const winners = () => {
    const outcome = view()?.outcome;
    const shown = ['payout', 'gathering', 'settled'].includes(stage());
    if (!shown || outcome?.kind !== 'winner') return [];
    return outcome.winners.map(winner => winner.playerId);
  };

  /**
   * Who has won the whole game, once the screen has caught up with it.
   *
   * The last round is decided the moment it is settled, but the end screen
   * waits until that round has been watched and paid out, and it does not
   * wait for anyone to press on to the next round, which there will not be.
   */
  const champion = (): Player | undefined => {
    const current = view();
    if (!current) return undefined;
    if (current.phase === 'over') return findGameWinner(current.players);
    if (stage() === 'settled' && current.settlement) {
      return findGameWinner(current.settlement.players);
    }
    return undefined;
  };

  /** Everyone as they stand once this round's payout has landed. */
  const finalPlayers = (): Player[] => view()?.settlement?.players ?? players();

  const standings = (): Player[] => {
    const first = champion()?.id;
    return [...finalPlayers()].sort((a, b) => {
      if (a.id === first) return -1;
      if (b.id === first) return 1;
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return b.teks - a.teks;
    });
  };

  // Being knocked out is said once. After that the player watches the rest
  // of the game like anyone else, until a new one starts.
  const [outSeen, setOutSeen] = createSignal(false);
  createEffect(
    () => me()?.eliminated ?? false,
    eliminated => {
      if (!eliminated) setOutSeen(false);
    },
  );

  const endKind = (): EndKind | undefined => {
    const winner = champion();
    if (winner) return winner.id === you() ? 'victory' : 'defeat';
    const mine = you();
    const settling = ['replaying', 'payout', 'gathering'].includes(stage());
    if (mine && !settling && outOf(mine) && !outSeen()) return 'out';
    return undefined;
  };

  const endDetail = (): string => {
    const winner = champion();
    switch (endKind()) {
      case 'victory':
        return 'You took every teks on the table.';
      case 'defeat':
        return `${winner?.name ?? 'Someone'} took every teks on the table.`;
      default: {
        const settlement = view()?.settlement;
        const mine = settlement?.payments.find(
          payment => payment.playerId === you(),
        );
        const takers = (settlement?.awards ?? [])
          .filter(award =>
            award.pamatoIds.some(id => mine?.surrenderedPamatoIds.includes(id)),
          )
          .map(award => nameOf(award.playerId));
        return takers.length > 0
          ? `You could not cover what you owed. ${takers.join(' and ')} took your pamato.`
          : 'You ran out of teks. You can watch the rest of the game.';
      }
    }
  };

  // Starting again from the last round's result means stepping the table on
  // to the end of the game first, then asking for a new one.
  const [againWanted, setAgainWanted] = createSignal(false);
  function playAgain(): void {
    if (view()?.phase === 'over') {
      send({ type: 'newGame' });
      return;
    }
    setAgainWanted(true);
    send({ type: 'next' });
  }
  createEffect(
    () => view()?.phase,
    phase => {
      if (phase !== 'over' || !untrack(againWanted)) return;
      setAgainWanted(false);
      send({ type: 'newGame' });
    },
  );

  // The player boxes along the top, which the payout flies teks between.
  const anchors = new Map<string, HTMLElement>();
  let tekLayer: HTMLDivElement | undefined;

  createEffect(
    () => stage(),
    current => {
      if (current === 'payout') {
        const settlement = untrack(() => view()?.settlement);
        const timer = setTimeout(() => {
          if (!settlement || !tekLayer) {
            setPaidOut(true);
            return;
          }
          const length = flyTeks(tekLayer, settlement, id => anchors.get(id));
          const started = performance.now();
          const tick = (now: number) => {
            const t = length > 0 ? Math.min(1, (now - started) / length) : 1;
            setPayoutProgress(t);
            if (t < 1) requestAnimationFrame(tick);
            else setPaidOut(true);
          };
          requestAnimationFrame(tick);
        }, PAYOUT_DELAY);
        return () => clearTimeout(timer);
      }
      if (current === 'gathering') {
        const timer = setTimeout(() => setGathered(true), GATHER_LIMIT);
        return () => clearTimeout(timer);
      }
      return undefined;
    },
  );

  // A refusal is worth a glance, not a click to dismiss.
  createEffect(
    () => props.net.refusal(),
    reason => {
      if (!reason) return undefined;
      const timer = setTimeout(props.net.clearRefusal, TOAST_TIME);
      return () => clearTimeout(timer);
    },
  );

  let lastSentAt = 0;
  const sendAim = (next: Aim): void => {
    const now = performance.now();
    if (now - lastSentAt < AIM_INTERVAL) return;
    lastSentAt = now;
    send({ type: 'aim', tilt: next.tilt, target: next.target });
  };

  function swap(pieceId: string, otherId: string): void {
    const current = view();
    if (!current) return;
    const from = current.stack.findIndex(entry => entry.pieceId === pieceId);
    const to = current.stack.findIndex(entry => entry.pieceId === otherId);
    if (from < 0 || to < 0 || from === to) return;
    const stack = [...current.stack];
    stack[from] = current.stack[to];
    stack[to] = current.stack[from];
    send({ type: 'stack', stack });
  }

  function flip(pieceId: string): void {
    const current = view();
    if (!current) return;
    send({
      type: 'stack',
      stack: current.stack.map(entry =>
        entry.pieceId === pieceId
          ? { ...entry, flipped: !entry.flipped }
          : entry,
      ),
    });
  }

  const handShown = () =>
    ['wagering', 'stacking', 'settled', 'over'].includes(stage());

  const wagering = () =>
    stage() === 'wagering' &&
    me() !== undefined &&
    !me()?.eliminated &&
    !(view()?.locked ?? []).includes(you() ?? '');

  const banner = () => {
    const current = view();
    const who = nameOf(launcherId());
    switch (stage()) {
      case 'wagering': {
        if (me()?.eliminated) return { message: 'You are out. Watching.' };
        const live = players().filter(player => !player.eliminated).length;
        const inCount = current?.locked.length ?? 0;
        return {
          message: 'Wagers',
          detail: `${inCount} of ${live} in`,
        };
      }
      case 'stacking':
        return isLauncher()
          ? {
              message: 'Build your stack',
              detail: `Drag the arena sideways to tilt it. Rotation ${degrees(aim().tilt)}°`,
            }
          : { message: `${who} is building the stack` };
      case 'aiming':
        return isLauncher()
          ? {
              message: 'Aim the throw',
              detail: 'Tap or drag on the arena where it should land.',
            }
          : { message: `${who} is aiming` };
      case 'throwing':
      case 'replaying':
        return { message: `${who} throws!` };
      case 'payout':
      case 'gathering':
      case 'settled': {
        const outcome = current?.outcome;
        const faces = throwResult()?.faces ?? [];
        return {
          message: outcome ? describe(outcome, nameOf) : 'Round over',
          detail:
            stage() !== 'settled'
              ? undefined
              : outcome?.kind === 'winner'
                ? 'Next round coming up…'
                : isLauncher()
                  ? 'Your throw again.'
                  : `${who} throws again.`,
          outcome,
          faces: simPieces().map((piece, index) => ({
            pieceId: piece.id,
            face: faces[index] ?? 'up',
          })),
        };
      }
      case 'over': {
        const champion = findGameWinner(players());
        return {
          message: champion
            ? `${champion.name} takes every teks on the table!`
            : 'Game over',
        };
      }
      default:
        return { message: '' };
    }
  };

  return (
    <Show
      when={view()}
      fallback={
        <main class="game game-loading">
          <p>Setting the table…</p>
        </main>
      }
    >
      <main class="game" data-stage={stage()}>
        <Errored
          fallback={(error, reset) => (
            <div class="arena arena-failed">
              <p>The arena could not be drawn.</p>
              <p class="hint">{String(error())}</p>
              <button type="button" onClick={reset}>
                Try again
              </button>
            </div>
          )}
        >
          <ArenaCanvas
            pieces={simPieces()}
            stack={view()?.stack ?? []}
            aim={aim()}
            stage={stage() === 'aiming' ? 'throw' : 'stack'}
            pose={pose()}
            result={throwResult()}
            skipReplay={revealed()}
            colorOf={piece => untrack(() => colourOf(piece.id))}
            canAim={
              isLauncher() &&
              !throwing() &&
              (stage() === 'stacking' || stage() === 'aiming')
            }
            inset={ARENA_INSET}
            onAim={sendAim}
            onReplayEnd={() => setRevealed(true)}
            onGathered={() => setGathered(true)}
          />
        </Errored>

        <Show when={stage() !== 'lobby'}>
          <div class="hud">
            <header class="hud-top">
              <PlayerBar
                players={players()}
                launcherId={launcherId()}
                you={you() ?? ''}
                bots={view()?.bots ?? []}
                present={view()?.present ?? []}
                wagers={view()?.wagers ?? {}}
                locked={view()?.locked ?? []}
                showWagers={stage() !== 'over'}
                winners={winners()}
                colorOf={colourOf}
                teksOf={teksOf}
                outOf={outOf}
                onAnchor={(id, element) => anchors.set(id, element)}
              />
              <Banner {...banner()} nameOf={nameOf} colorOf={colourOf} />
            </header>

            <Show when={stage() !== 'over'}>
              <span class="round-tag">Round {view()?.round ?? 1}</span>
            </Show>

            <Hand
              stack={view()?.stack ?? []}
              shown={handShown()}
              editable={isLauncher() && stage() === 'stacking'}
              nameOf={nameOf}
              pamatoOf={pamatoOf}
              colorOf={colourOf}
              onFlip={flip}
              onSwap={swap}
            />

            <div class="action-bar">
              <Show when={stage() === 'stacking' && isLauncher()}>
                <button
                  type="button"
                  class="primary big"
                  onClick={() => send({ type: 'stackSet' })}
                >
                  Stack is set
                </button>
              </Show>
              <Show when={stage() === 'aiming' && isLauncher()}>
                <button
                  type="button"
                  class="big"
                  onClick={() => send({ type: 'stackBack' })}
                >
                  Back
                </button>
                <button
                  type="button"
                  class="primary big"
                  disabled={throwing()}
                  onClick={() => {
                    setThrowing(true);
                    send({ type: 'throw' });
                  }}
                >
                  Throw
                </button>
              </Show>
              <Show when={stage() === 'replaying'}>
                <button
                  type="button"
                  class="big"
                  onClick={() => setRevealed(true)}
                >
                  Skip to result
                </button>
              </Show>
              {/*
                A decided round moves on by itself, and a bot throws its own
                ties again, so the only thing left to press is a tie this
                player has to throw again.
              */}
              <Show
                when={
                  stage() === 'settled' &&
                  view()?.outcome?.kind === 'rethrow' &&
                  isLauncher()
                }
              >
                <button
                  type="button"
                  class="primary big"
                  onClick={() => send({ type: 'next' })}
                >
                  Throw again
                </button>
              </Show>
              <Show when={stage() === 'over'}>
                <button
                  type="button"
                  class="primary big"
                  onClick={() => send({ type: 'newGame' })}
                >
                  New game
                </button>
              </Show>
            </div>

            <div class="tek-layer" ref={element => (tekLayer = element)} />

            <button
              type="button"
              class="leave-button"
              onClick={() => setConfirmingLeave(true)}
            >
              Leave
            </button>
          </div>
        </Show>

        <Show when={stage() === 'lobby' && view()}>
          {current => (
            <div class="dialog-backdrop">
              <div class="dialog lobby-card">
                <h1 class="title">Teks</h1>
                <Lobby
                  view={current()}
                  code={props.room.code}
                  link={roomLink(props.room.code)}
                  listed={props.room.listed}
                  onLeave={props.onLeave}
                  onColour={colour => send({ type: 'colour', colour })}
                  onStartingTeks={teks => send({ type: 'startingTeks', teks })}
                  onAddBot={() => send({ type: 'addBot' })}
                  onRemoveBot={() => send({ type: 'removeBot' })}
                  onStart={() => send({ type: 'start' })}
                />
              </div>
            </div>
          )}
        </Show>

        <Show when={wagering() && me()}>
          {player => (
            <WagerDialog
              player={player()}
              round={view()?.round ?? 1}
              suggested={view()?.wagers[player().id] ?? 1}
              onPamato={pamatoId => send({ type: 'pamato', pamatoId })}
              onConfirm={teks => {
                send({ type: 'wager', teks });
                send({ type: 'wagersIn' });
              }}
            />
          )}
        </Show>

        <Show when={endKind()}>
          {kind => (
            <EndScreen
              kind={kind()}
              detail={endDetail()}
              standings={standings()}
              championId={champion()?.id}
              you={you() ?? ''}
              rounds={
                // Stepping on to the end of the game counts as starting a
                // round that is never played.
                view()?.phase === 'over'
                  ? Math.max(1, (view()?.round ?? 2) - 1)
                  : (view()?.round ?? 1)
              }
              colorOf={colourOf}
              primaryLabel={kind() === 'out' ? 'Keep watching' : 'Play again'}
              onPrimary={() =>
                kind() === 'out' ? setOutSeen(true) : playAgain()
              }
            />
          )}
        </Show>

        <Show when={confirmingLeave()}>
          <div class="dialog-backdrop">
            <div class="dialog">
              <header class="dialog-head">
                <h2>Leave the game?</h2>
              </header>
              <p class="dialog-note">
                A bot plays your seat while you are gone, so the others can
                carry on. Open the room link again to take it back.
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="big"
                  onClick={() => setConfirmingLeave(false)}
                >
                  Stay
                </button>
                <button
                  type="button"
                  class="primary big"
                  onClick={() => props.onLeave()}
                >
                  Leave
                </button>
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.net.refusal()}>
          {reason => (
            <p class="toast" onClick={props.net.clearRefusal}>
              {reason()}
            </p>
          )}
        </Show>
      </main>
    </Show>
  );
}
