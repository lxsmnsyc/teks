import { createEffect, onSettled, untrack } from 'solid-js';
import * as THREE from 'three';
import type { AimGuide } from '~/games/teks/render/aim';
import { createAimGuide, poseStack } from '~/games/teks/render/aim';
import type { PieceView } from '~/games/teks/render/pieceMeshes';
import {
  createPieceViews,
  disposePieceViews,
} from '~/games/teks/render/pieceMeshes';
import type { Replay } from '~/games/teks/render/replay';
import { createReplay } from '~/games/teks/render/replay';
import type { Arena } from '~/games/teks/render/scene';
import { BASE_FRAME_RADIUS, createArenaView } from '~/games/teks/render/scene';
import {
  ARENA_HALF_SIZE,
  TILT_MAX,
  TILT_MIN,
} from '~/games/teks/sim/constants';
import type {
  SimPiece,
  SimResult,
  StackEntry,
  Target,
} from '~/games/teks/sim/types';

/** Pixels of sideways drag that sweep the stack through its whole range. */
const TILT_DRAG = 320;

/** The point the framing measures from, matching where the camera looks. */
const CENTRE_Z = 1.2;
/** Breathing room left around the furthest piece, in metres. */
const FRAME_MARGIN = 1.2;

/** How long the pieces take to fly back into the hand, in seconds. */
const GATHER_TIME = 0.7;
/** How long they take to come out of the hand onto the mark. */
const RISE_TIME = 0.55;
/** Gap between one piece leaving and the next, so they read as separate. */
const PIECE_STAGGER = 0.08;
/** How small a piece is drawn once it is back in the hand. */
const HAND_SCALE = 0.35;

export interface Aim {
  /** Stack rotation, between TILT_MIN and TILT_MAX. */
  tilt: number;
  /** Where the launcher wants the throw to land. */
  target: Target;
}

/** Which half of the throw setup the launcher is on. */
export type AimStage = 'stack' | 'throw';

/**
 * Where the pieces are.
 *
 * `hand` is off the table, held by the players; the cards drawn along the
 * bottom of the screen stand in for them. `stack` is sitting on the throwing
 * mark as the launcher built it. `replay` is the throw being played back.
 */
export type PiecePose = 'hand' | 'stack' | 'replay';

export interface ArenaCanvasProps {
  pieces: SimPiece[];
  stack: StackEntry[];
  aim: Aim;
  stage: AimStage;
  pose: PiecePose;
  /** Set once a throw has been simulated; drives the replay. */
  result: SimResult | null;
  /** Jump the replay to where everything came to rest. */
  skipReplay: boolean;
  colorOf: (piece: SimPiece) => number;
  canAim: boolean;
  /** Pixels covered by the interface at the top and bottom of the canvas. */
  inset: { top: number; bottom: number };
  onAim: (aim: Aim) => void;
  onReplayEnd: () => void;
  /** The pieces have finished flying back into the hand. */
  onGathered: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** How far the furthest piece has got from the centre of play. */
function spreadOf(views: PieceView[]): number {
  let furthest = BASE_FRAME_RADIUS;
  for (const view of views) {
    const { x, z } = view.mesh.position;
    furthest = Math.max(furthest, Math.hypot(x, z - CENTRE_Z) + FRAME_MARGIN);
  }
  return furthest;
}

/** Eases in and out, so a piece neither jerks away nor slams into place. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** One piece moving from one pose to another. */
interface Track {
  mesh: THREE.Object3D;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromQuaternion: THREE.Quaternion;
  toQuaternion: THREE.Quaternion;
  fromScale: number;
  toScale: number;
  delay: number;
}

/** A set of pieces moving together, and what to do once they arrive. */
interface Tween {
  tracks: Track[];
  elapsed: number;
  duration: number;
  /** Extra height at the middle of the move, so pieces arc rather than slide. */
  lift: number;
  onDone: () => void;
}

/**
 * Owns the three.js side of the game: the arena, one mesh per piece, the aim
 * guide, the replay, and the pieces being picked up and put down between
 * rounds.
 *
 * The pointer means different things in the two stages of a throw. While the
 * stack is being set up, dragging sideways rotates it. Once it is set, the
 * pointer picks the spot on the floor the throw is aimed at.
 */
export function ArenaCanvas(props: ArenaCanvasProps) {
  let canvas: HTMLCanvasElement | undefined;
  let host: HTMLDivElement | undefined;

  let arena: Arena | undefined;
  let guide: AimGuide | undefined;
  let views: PieceView[] = [];
  let replay: Replay | undefined;
  let replayNotified = false;
  let tween: Tween | undefined;
  /** The roster the current meshes were built from. */
  let builtFrom = '';

  const raycaster = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const pointer = new THREE.Vector2();

  /** Where on the arena floor the pointer is, if it is over the floor. */
  const floorPoint = (event: PointerEvent): Target | undefined => {
    if (!arena || !canvas) return undefined;
    const box = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1;
    raycaster.setFromCamera(pointer, arena.camera);
    if (!raycaster.ray.intersectPlane(floor, hit)) return undefined;
    return {
      x: clamp(hit.x, -ARENA_HALF_SIZE, ARENA_HALF_SIZE),
      z: clamp(hit.z, -ARENA_HALF_SIZE, ARENA_HALF_SIZE),
    };
  };

  /** Who is in the throw and what they are throwing, as one comparable line. */
  const rosterOf = (pieces: SimPiece[]): string =>
    pieces.map(piece => `${piece.id}:${piece.spec.id}`).join('|');

  /**
   * What the first frame is drawn from.
   *
   * A compound expression passed as a prop compiles to a memo that Solid
   * builds the first time the prop is read, and building any reactive
   * primitive inside onSettled is forbidden: it throws, which loses the arena
   * and halts the reactive system with it. Reading these here, in the
   * component body, keeps that construction out of the setup callback. The
   * effects below carry every change from then on.
   */
  const first = untrack(() => ({
    pieces: props.pieces,
    stack: props.stack,
    aim: props.aim,
    stage: props.stage,
    pose: props.pose,
    canAim: props.canAim,
    inset: props.inset,
    colorOf: props.colorOf,
  }));

  let pose: PiecePose = first.pose;

  /**
   * A point just below the bottom edge of the picture, a little way in front
   * of the camera. It is where the hand is, as far as the arena can tell: the
   * cards along the bottom of the screen sit right in front of it.
   */
  const handPoint = (spread: number): THREE.Vector3 => {
    const camera = arena?.camera;
    if (!camera) return new THREE.Vector3();
    const toward = new THREE.Vector3(spread * 0.25, -1.1, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    return camera.position.clone().addScaledVector(toward, 2.4);
  };

  const setVisible = (visible: boolean): void => {
    for (const view of views) view.mesh.visible = visible;
  };

  /** Records where each mesh is now, to move it from. */
  const snapshot = (
    mesh: THREE.Object3D,
  ): Pick<Track, 'fromPosition' | 'fromQuaternion' | 'fromScale'> => ({
    fromPosition: mesh.position.clone(),
    fromQuaternion: mesh.quaternion.clone(),
    fromScale: mesh.scale.x,
  });

  /** Flies every piece off the table and into the hand. */
  const gather = (onDone: () => void): void => {
    if (views.length === 0) {
      onDone();
      return;
    }
    const middle = (views.length - 1) / 2;
    tween = {
      elapsed: 0,
      duration: GATHER_TIME,
      lift: 0.9,
      tracks: views.map((view, index) => ({
        mesh: view.mesh,
        ...snapshot(view.mesh),
        toPosition: handPoint(index - middle),
        toQuaternion: view.mesh.quaternion.clone(),
        toScale: HAND_SCALE,
        delay: index * PIECE_STAGGER,
      })),
      onDone: () => {
        setVisible(false);
        onDone();
      },
    };
  };

  /** Brings the pieces out of the hand and sets them down as the stack. */
  const rise = (stack: StackEntry[], tilt: number): void => {
    // Pose them where they are going first, to read the targets back off.
    poseStack(views, stack, tilt);
    const targets = views.map(view => ({
      position: view.mesh.position.clone(),
      quaternion: view.mesh.quaternion.clone(),
    }));
    const middle = (views.length - 1) / 2;
    tween = {
      elapsed: 0,
      duration: RISE_TIME,
      lift: 0.35,
      tracks: views.map((view, index) => {
        const start = handPoint(index - middle);
        view.mesh.position.copy(start);
        view.mesh.scale.setScalar(HAND_SCALE);
        view.mesh.visible = true;
        return {
          mesh: view.mesh,
          fromPosition: start,
          fromQuaternion: targets[index].quaternion.clone(),
          fromScale: HAND_SCALE,
          toPosition: targets[index].position,
          toQuaternion: targets[index].quaternion,
          toScale: 1,
          delay: index * PIECE_STAGGER,
        };
      }),
      onDone: () => {
        // The stack may have been rotated while it was on its way out.
        untrack(() => poseStack(views, props.stack, props.aim.tilt));
      },
    };
  };

  /** Puts every piece where the current pose says, with no movement. */
  const settlePose = (): void => {
    tween = undefined;
    for (const view of views) view.mesh.scale.setScalar(1);
    if (pose === 'hand') {
      setVisible(false);
      return;
    }
    setVisible(true);
    if (pose === 'stack') {
      untrack(() => poseStack(views, props.stack, props.aim.tilt));
    }
  };

  const advanceTween = (delta: number): void => {
    const current = tween;
    if (!current) return;
    current.elapsed += delta;
    let finished = true;
    for (const track of current.tracks) {
      const raw = (current.elapsed - track.delay) / current.duration;
      if (raw < 1) finished = false;
      const t = ease(clamp(raw, 0, 1));
      track.mesh.position.lerpVectors(track.fromPosition, track.toPosition, t);
      track.mesh.position.y += Math.sin(Math.PI * t) * current.lift;
      track.mesh.quaternion.slerpQuaternions(
        track.fromQuaternion,
        track.toQuaternion,
        t,
      );
      track.mesh.scale.setScalar(
        track.fromScale + (track.toScale - track.fromScale) * t,
      );
    }
    if (finished) {
      tween = undefined;
      current.onDone();
    }
  };

  onSettled(() => {
    if (!canvas || !host) return undefined;
    const view = createArenaView(canvas);
    arena = view;
    guide = createAimGuide(view.scene);

    const element = host;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) view.resize(box.width, box.height);
    });
    observer.observe(element);
    view.setInset(first.inset.top, first.inset.bottom);
    view.resize(element.clientWidth, element.clientHeight);

    views = createPieceViews(view.pieces, first.pieces, first.colorOf);
    builtFrom = rosterOf(first.pieces);
    poseStack(views, first.stack, first.aim.tilt);
    setVisible(pose !== 'hand');
    guide.update(first.aim);
    guide.setStage(first.stage);
    guide.setVisible(first.canAim);

    let last = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      frame = requestAnimationFrame(loop);
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;

      advanceTween(delta);

      if (replay && pose === 'replay') {
        replay.advance(delta);
        if (replay.done && !replayNotified) {
          replayNotified = true;
          props.onReplayEnd();
        }
        // There is no wall to stop a piece, so a hard throw can put one well
        // outside the marked area. Widen the view to keep every piece in
        // frame, or the round ends somewhere the players cannot read it.
        view.frame(spreadOf(views));
      }
      view.update(delta);
      view.renderer.render(view.scene, view.camera);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      guide?.dispose();
      disposePieceViews(view.pieces, views);
      views = [];
      view.dispose();
      arena = undefined;
      guide = undefined;
    };
  });

  /**
   * Rebuilds the meshes when the pieces in the throw change.
   *
   * The guard is the point. An effect's second callback runs whenever
   * something it read has changed, not only when the value it was handed
   * differs, and the table view is rebuilt on every message from the server,
   * so this runs many times a round with the same three pieces in it.
   * Rebuilding throws the replay away, and the server broadcasts the settled
   * table immediately after sending the throw, so without the guard the
   * replay was discarded a moment after it was made and the pieces were never
   * seen to fly at all.
   */
  createEffect(
    () => rosterOf(props.pieces),
    roster => {
      const view = arena;
      if (!view || roster === builtFrom) return;
      builtFrom = roster;
      // The colours, the order and the rotation are read for their current
      // values, not subscribed to: the effect below already re-poses the
      // stack when those change, and tracking them here would throw the
      // meshes away on every drag.
      const { pieces, colorOf } = untrack(() => ({
        pieces: props.pieces,
        colorOf: props.colorOf,
      }));
      disposePieceViews(view.pieces, views);
      views = createPieceViews(view.pieces, pieces, colorOf);
      replay = undefined;
      settlePose();
    },
    { defer: true },
  );

  // Moving between poses is where the pieces are picked up and put down.
  createEffect(
    () => props.pose,
    next => {
      const previous = pose;
      if (next === previous) return;
      pose = next;
      if (!arena) return;

      if (next === 'hand') {
        arena.frame(BASE_FRAME_RADIUS);
        gather(() => props.onGathered());
        return;
      }
      if (next === 'stack' && previous === 'hand') {
        arena.frame(BASE_FRAME_RADIUS);
        untrack(() => rise(props.stack, props.aim.tilt));
        return;
      }
      settlePose();
    },
  );

  // Re-pose the stack as the launcher reorders, flips or rotates it. Only
  // while it is sitting on the mark: in the hand it is not drawn, and during
  // the replay or a move between poses something else owns the meshes.
  createEffect(
    () => ({ stack: props.stack, tilt: props.aim.tilt }),
    ({ stack, tilt }) => {
      if (pose !== 'stack' || tween) return;
      poseStack(views, stack, tilt);
    },
  );

  createEffect(
    () => ({ aim: props.aim, canAim: props.canAim, stage: props.stage }),
    ({ aim, canAim, stage }) => {
      guide?.update(aim);
      guide?.setStage(stage);
      guide?.setVisible(canAim);
    },
  );

  createEffect(
    () => props.inset,
    inset => arena?.setInset(inset.top, inset.bottom),
  );

  createEffect(
    () => props.result,
    result => {
      if (!result || views.length === 0) {
        replay = undefined;
        return;
      }
      tween = undefined;
      for (const view of views) {
        view.mesh.scale.setScalar(1);
        view.mesh.visible = true;
      }
      replayNotified = false;
      replay = createReplay(result, views);
    },
  );

  createEffect(
    () => props.skipReplay,
    skip => {
      if (skip && replay && !replay.done) replay.finish();
    },
  );

  let dragId: number | undefined;
  let originX = 0;
  let originTilt = Math.PI / 2;

  const onPointerDown = (event: PointerEvent): void => {
    if (!props.canAim || dragId !== undefined) return;
    dragId = event.pointerId;
    originX = event.clientX;
    originTilt = props.aim.tilt;
    canvas?.setPointerCapture(event.pointerId);
    if (props.stage === 'throw') {
      const target = floorPoint(event);
      if (target) props.onAim({ ...props.aim, target });
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== dragId) return;

    if (props.stage === 'stack') {
      const range = TILT_MAX - TILT_MIN;
      props.onAim({
        ...props.aim,
        tilt: clamp(
          originTilt - ((event.clientX - originX) / TILT_DRAG) * range,
          TILT_MIN,
          TILT_MAX,
        ),
      });
      return;
    }

    const target = floorPoint(event);
    if (target) props.onAim({ ...props.aim, target });
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== dragId) return;
    dragId = undefined;
    canvas?.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      class="arena"
      data-aiming={props.canAim ? 'true' : 'false'}
      ref={el => (host = el)}
    >
      <canvas
        ref={el => (canvas = el)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
