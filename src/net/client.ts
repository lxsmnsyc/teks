import { createSignal } from 'solid-js';
import type { ClientMessage } from './protocol';
import type { ServerMessage, TableView } from './view';
import { decodeFrames } from './view';
import type { SimResult } from '~/sim/types';

export type Status = 'connecting' | 'open' | 'closed';

export interface Connection {
  status: () => Status;
  view: () => TableView | null;
  you: () => string | null;
  /** The last thing the server refused to do, for showing to the player. */
  refusal: () => string | null;
  /** The most recent throw, ready for the replay. */
  result: () => SimResult | null;
  join: (code: string, name: string) => void;
  send: (message: ClientMessage) => void;
  clearRefusal: () => void;
}

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

/**
 * The client's end of the tunnel.
 *
 * It holds no game state of its own. Everything shown comes from the table
 * view the server sends, and every action is a message describing what the
 * player did, never what the result was. The one thing that arrives separately
 * is the replay, because it is large and only changes once a throw.
 */
export function createConnection(): Connection {
  const [status, setStatus] = createSignal<Status>('connecting');
  const [view, setView] = createSignal<TableView | null>(null);
  const [you, setYou] = createSignal<string | null>(null);
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<SimResult | null>(null);

  let socket: WebSocket | undefined;
  let queued: ClientMessage | undefined;

  const connect = (): void => {
    socket = new WebSocket(socketUrl());

    socket.addEventListener('open', () => {
      setStatus('open');
      if (queued) {
        socket?.send(JSON.stringify(queued));
        queued = undefined;
      }
    });

    socket.addEventListener('close', () => {
      setStatus('closed');
      // The host may simply have restarted; keep trying rather than stranding
      // everyone on a dead page.
      setTimeout(connect, 1500);
    });

    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      switch (message.type) {
        case 'welcome':
          setYou(message.you);
          setView(message.view);
          setRefusal(null);
          break;
        case 'state':
          setView(message.view);
          break;
        case 'result':
          setResult({
            faces: message.result.faces,
            frameCount: message.result.frameCount,
            frames: decodeFrames(message.result.frames),
            steps: 0,
            edgeResolutions: 0,
            recoveries: 0,
            timedOut: false,
          });
          break;
        case 'refused':
          setRefusal(message.reason);
          break;
      }
    });
  };

  connect();

  const send = (message: ClientMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      queued = message;
    }
  };

  return {
    status,
    view,
    you,
    refusal,
    result,
    join: (code, name) => {
      setResult(null);
      send({ type: 'join', code, name });
    },
    send,
    clearRefusal: () => setRefusal(null),
  };
}
