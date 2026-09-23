import { For, Show, createSignal, untrack } from 'solid-js';
import { getPamato } from '~/games/teks/data/pamatos';
import type { StackEntry } from '~/games/teks/sim/types';
import { hex, inkOn } from './colour';

export interface HandProps {
  /** The stack, bottom first, each entry carrying which way up it sits. */
  stack: StackEntry[];
  /** Whether the cards are held up at all, or put away. */
  shown: boolean;
  /** Whether this player may flip and reorder them. */
  editable: boolean;
  nameOf: (pieceId: string) => string;
  pamatoOf: (pieceId: string) => string;
  colorOf: (pieceId: string) => number;
  onFlip: (pieceId: string) => void;
  /** Swap two cards' places in the stack. */
  onSwap: (pieceId: string, otherId: string) => void;
}

/** How far a pointer has to travel before a press becomes a drag, in pixels. */
const DRAG_THRESHOLD = 6;

/** Where one card sits in the fan. */
function fanned(index: number, count: number) {
  const middle = (count - 1) / 2;
  const offset = index - middle;
  const spread = Math.min(74, 420 / Math.max(count, 1));
  return {
    x: offset * spread,
    // Cards further from the middle sit lower, which is what makes it a fan
    // rather than a row.
    y: offset * offset * 5,
    angle: offset * 7,
  };
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
  over: string | null;
}

/**
 * The stack, held as a hand of cards along the bottom of the screen.
 *
 * Left to right is bottom to top of the stack. The launcher taps a card to
 * turn it over and drags one onto another to swap their places; everyone else
 * watches the same hand change as the launcher works on it.
 */
export function Hand(props: HandProps) {
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const cards = new Map<string, HTMLElement>();

  /** The card, other than the one being dragged, under a point on screen. */
  const cardAt = (x: number, dragged: string): string | null => {
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const [id, element] of cards) {
      if (id === dragged) continue;
      const box = element.getBoundingClientRect();
      const distance = Math.abs(x - (box.left + box.width / 2));
      if (distance < box.width * 0.75 && distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onPointerDown = (event: PointerEvent, id: string): void => {
    if (!props.editable || drag()) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
      over: null,
    });
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = drag();
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const moved = current.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
    setDrag({
      ...current,
      dx,
      dy,
      moved,
      over: moved ? cardAt(event.clientX, current.id) : null,
    });
  };

  const onPointerUp = (event: PointerEvent): void => {
    const current = drag();
    if (!current || current.pointerId !== event.pointerId) return;
    setDrag(null);
    if (!current.moved) {
      props.onFlip(current.id);
      return;
    }
    if (current.over) props.onSwap(current.id, current.over);
  };

  const onPointerCancel = (): void => {
    setDrag(null);
  };

  return (
    <div
      class="hand"
      data-shown={props.shown ? 'true' : 'false'}
      data-editable={props.editable ? 'true' : 'false'}
    >
      <Show when={props.editable}>
        <p class="hand-hint">
          Tap a card to turn it over. Drag it onto another to swap them.
        </p>
      </Show>

      <div class="fan">
        {/*
          Keyed by piece, not by entry: the server sends a fresh stack on
          every update, and keying by object would remount every card each
          time, which drops a drag in progress and skips the flip animation.
          Keyed by piece, a card that changes place slides there instead.
        */}
        <For each={props.stack} keyed={entry => entry.pieceId}>
          {(entry, index) => {
            // Cards are keyed by piece, so this never changes for this card.
            const id = untrack(() => entry().pieceId);
            const place = () => fanned(index(), props.stack.length);
            const dragging = () => drag()?.id === id && drag()?.moved === true;
            const targeted = () => drag()?.over === id;
            const colour = () => props.colorOf(id);

            return (
              <div
                class="card-slot"
                data-dragging={dragging() ? 'true' : 'false'}
                data-target={targeted() ? 'true' : 'false'}
                style={{
                  '--i': String(index()),
                  transform: dragging()
                    ? `translate(${place().x + (drag()?.dx ?? 0)}px, ${place().y + (drag()?.dy ?? 0) - 24}px) rotate(0deg) scale(1.08)`
                    : `translate(${place().x}px, ${place().y}px) rotate(${place().angle}deg)`,
                  'z-index': dragging() ? 50 : index() + 1,
                }}
                ref={element => {
                  cards.set(id, element);
                }}
                onPointerDown={event => onPointerDown(event, id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                <div
                  class="card"
                  data-flipped={entry().flipped ? 'true' : 'false'}
                  role="button"
                  aria-label={`${props.nameOf(id)}, ${entry().flipped ? 'back up' : 'face up'}`}
                >
                  <div
                    class="card-face card-front"
                    style={{
                      background: hex(colour()),
                      color: inkOn(colour()),
                    }}
                  >
                    <span class="card-name">{props.nameOf(id)}</span>
                    <span class="card-mark">
                      {props.nameOf(id).slice(0, 1).toUpperCase()}
                    </span>
                    <span class="card-pamato">
                      {getPamato(props.pamatoOf(id)).name}
                    </span>
                  </div>
                  <div
                    class="card-face card-back"
                    style={{ '--owner': hex(colour()) }}
                  >
                    <span class="card-name">{props.nameOf(id)}</span>
                    <span class="card-back-mark">TEKS</span>
                  </div>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <div class="hand-ends" aria-hidden="true">
        <span>Bottom</span>
        <span>Top</span>
      </div>
    </div>
  );
}
