import { For, Show } from 'solid-js';
import type { RoundOutcome } from '~/games/teks/rules/round';
import type { Face } from '~/games/teks/sim/types';
import { hex } from './colour';

export interface BannerProps {
  /** The line that says what is going on. */
  message: string;
  /** Smaller text under it, for what to do about it. */
  detail?: string;
  /** How each piece landed, once there is a result worth showing. */
  faces?: { pieceId: string; face: Face }[];
  outcome?: RoundOutcome | null;
  nameOf: (pieceId: string) => string;
  colorOf: (pieceId: string) => number;
}

/** What is happening, said once, in the middle of the screen under the bar. */
export function Banner(props: BannerProps) {
  const won = (pieceId: string) =>
    props.outcome?.kind === 'winner' &&
    props.outcome.winners.some(winner => winner.pieceId === pieceId);

  return (
    <div class="banner" data-kind={props.outcome?.kind ?? 'info'}>
      <p class="banner-message">{props.message}</p>
      <Show when={props.detail}>
        {detail => <p class="banner-detail">{detail()}</p>}
      </Show>
      <Show when={props.faces && props.faces.length > 0}>
        <ul class="landed">
          <For each={props.faces}>
            {landed => (
              <li
                class="landed-piece"
                data-face={landed.face}
                data-won={won(landed.pieceId) ? 'true' : 'false'}
                style={{ '--owner': hex(props.colorOf(landed.pieceId)) }}
              >
                <span class="landed-swatch" aria-hidden="true" />
                <span>{props.nameOf(landed.pieceId)}</span>
                <span class="landed-face">
                  {landed.face === 'up' ? 'face' : 'back'}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
