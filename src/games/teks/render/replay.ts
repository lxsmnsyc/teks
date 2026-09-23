import { FRAME_STRIDE } from '~/games/teks/sim/types';
import type { SimResult } from '~/games/teks/sim/types';
import type { PieceView } from './pieceMeshes';

/** Replay runs at the rate the sim recorded frames at. */
export const REPLAY_FPS = 60;

export interface Replay {
  /** Advances the replay by `delta` seconds and poses the meshes. */
  advance: (delta: number) => void;
  /** Jumps straight to the final resting pose. */
  finish: () => void;
  reset: () => void;
  readonly done: boolean;
  readonly progress: number;
}

/**
 * Drives the piece meshes from a recorded throw. The replay never re-simulates
 * anything: it plays back exactly the frames the authoritative sim produced,
 * so every client sees the same throw land the same way.
 */
export function createReplay(result: SimResult, views: PieceView[]): Replay {
  const count = views.length;
  let elapsed = 0;

  const pose = (frame: number): void => {
    const clamped = Math.min(Math.max(frame, 0), result.frameCount - 1);
    let offset = clamped * count * FRAME_STRIDE;
    for (const view of views) {
      view.mesh.position.set(
        result.frames[offset],
        result.frames[offset + 1],
        result.frames[offset + 2],
      );
      view.mesh.quaternion.set(
        result.frames[offset + 3],
        result.frames[offset + 4],
        result.frames[offset + 5],
        result.frames[offset + 6],
      );
      offset += FRAME_STRIDE;
    }
  };

  pose(0);

  return {
    advance(delta) {
      if (this.done) return;
      elapsed += delta;
      pose(Math.floor(elapsed * REPLAY_FPS));
    },
    finish() {
      elapsed = result.frameCount / REPLAY_FPS;
      pose(result.frameCount - 1);
    },
    reset() {
      elapsed = 0;
      pose(0);
    },
    get done() {
      return elapsed * REPLAY_FPS >= result.frameCount - 1;
    },
    get progress() {
      if (result.frameCount <= 1) return 1;
      return Math.min(1, (elapsed * REPLAY_FPS) / (result.frameCount - 1));
    },
  };
}
