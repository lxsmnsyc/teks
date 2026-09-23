import * as THREE from 'three';
import { STACK_GAP, STACK_ORIGIN, TILT_MAX, TILT_MIN } from '~/sim/constants';
import { predictArc, predictLanding } from '~/sim/flight';
import { APEX_HEIGHT } from '~/sim/shape';
import { dialPoint, stackAxis } from '~/sim/quat';
import type { LaunchInput, StackEntry } from '~/sim/types';
import type { PieceView } from './pieceMeshes';

const ARC_SAMPLES = 64;

/** Samples along the drawn tilt dial, and how far out it sits from the mark. */
const TILT_SAMPLES = 40;
const TILT_RADIUS = 0.26;

const TILT_AXIS = new THREE.Vector3(0, 0, 1);
const FLIP_QUAT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI,
);

export type AimPreview = Pick<LaunchInput, 'tilt' | 'target'>;

export interface AimGuide {
  update: (aim: AimPreview) => void;
  /** Stage one shows the tilt dial, stage two shows the arc. */
  setStage: (stage: 'stack' | 'throw') => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

/**
 * Draws what the launcher is choosing, one stage at a time.
 *
 * While the stack is being set up, a dial at the mark shows the range the
 * stack may be rotated through and where in it the current rotation sits. Once
 * the stack is set, the dial gives way to the arc the throw will follow, which
 * is banked by that same rotation: setting the stack on its edge and setting
 * the curve of the throw are one choice, not two.
 */
export function createAimGuide(parent: THREE.Object3D): AimGuide {
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(ARC_SAMPLES * 3), 3),
  );
  const arc = new THREE.Line(
    arcGeometry,
    new THREE.LineBasicMaterial({
      color: 0xd9b26a,
      transparent: true,
      opacity: 0.85,
    }),
  );
  arc.frustumCulled = false;
  parent.add(arc);

  const landing = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 40),
    new THREE.MeshBasicMaterial({
      color: 0xd9b26a,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    }),
  );
  landing.rotation.x = -Math.PI / 2;
  parent.add(landing);

  // The dial the launcher rotates the stack along, drawn in the plane the
  // stack actually turns in.
  const dialPoints = new Float32Array(TILT_SAMPLES * 3);
  for (let i = 0; i < TILT_SAMPLES; i++) {
    const angle = TILT_MIN + (i / (TILT_SAMPLES - 1)) * (TILT_MAX - TILT_MIN);
    const at = dialPoint(angle, TILT_RADIUS);
    dialPoints[i * 3] = STACK_ORIGIN.x + at.x;
    dialPoints[i * 3 + 1] = STACK_ORIGIN.y + at.y;
    dialPoints[i * 3 + 2] = STACK_ORIGIN.z;
  }
  const dialGeometry = new THREE.BufferGeometry();
  dialGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(dialPoints, 3),
  );
  const dial = new THREE.Line(
    dialGeometry,
    new THREE.LineBasicMaterial({
      color: 0x30a9de,
      transparent: true,
      opacity: 0.4,
    }),
  );
  dial.frustumCulled = false;
  parent.add(dial);

  const needlePoints = new Float32Array(6);
  const needleGeometry = new THREE.BufferGeometry();
  needleGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(needlePoints, 3),
  );
  const needle = new THREE.Line(
    needleGeometry,
    new THREE.LineBasicMaterial({
      color: 0x30a9de,
      transparent: true,
      opacity: 0.95,
    }),
  );
  needle.frustumCulled = false;
  parent.add(needle);

  let stage: 'stack' | 'throw' = 'stack';
  let visible = true;

  const refresh = (): void => {
    arc.visible = visible && stage === 'throw';
    landing.visible = visible && stage === 'throw';
    dial.visible = visible && stage === 'stack';
    needle.visible = visible && stage === 'stack';
  };

  return {
    update(aim) {
      const path = predictArc(aim, ARC_SAMPLES);
      (arcGeometry.attributes.position.array as Float32Array).set(path);
      arcGeometry.attributes.position.needsUpdate = true;
      arcGeometry.computeBoundingSphere();

      const touchdown = predictLanding(aim);
      landing.position.set(touchdown.x, 0.003, touchdown.z);

      // The needle lies along the stack's edge, which is what the dial reads.
      const at = dialPoint(aim.tilt, TILT_RADIUS);
      needlePoints[0] = STACK_ORIGIN.x - at.x;
      needlePoints[1] = STACK_ORIGIN.y - at.y;
      needlePoints[2] = STACK_ORIGIN.z;
      needlePoints[3] = STACK_ORIGIN.x + at.x;
      needlePoints[4] = STACK_ORIGIN.y + at.y;
      needlePoints[5] = STACK_ORIGIN.z;
      needleGeometry.attributes.position.needsUpdate = true;
      needleGeometry.computeBoundingSphere();
    },
    setStage(next) {
      stage = next;
      refresh();
    },
    setVisible(next) {
      visible = next;
      refresh();
    },
    dispose() {
      for (const object of [arc, landing, dial, needle]) parent.remove(object);
      arcGeometry.dispose();
      arc.material.dispose();
      landing.geometry.dispose();
      landing.material.dispose();
      dialGeometry.dispose();
      dial.material.dispose();
      needleGeometry.dispose();
      needle.material.dispose();
    },
  };
}

/**
 * Poses the pieces as the stack the launcher built: bottom first, each one the
 * way up they placed it, the whole stack rotated to the tilt they set, sitting
 * on the throwing mark.
 */
export function poseStack(
  views: PieceView[],
  stack: StackEntry[],
  tilt: number,
): void {
  const halfHeight = APEX_HEIGHT;
  const axis = stackAxis(tilt);
  const pitch = halfHeight * 2 + STACK_GAP;
  const middle = ((stack.length - 1) * pitch) / 2;
  const byId = new Map(views.map(view => [view.piece.id, view]));

  stack.forEach((entry, index) => {
    const view = byId.get(entry.pieceId);
    if (!view) return;
    const offset = index * pitch - middle;
    view.mesh.position.set(
      STACK_ORIGIN.x + axis.x * offset,
      STACK_ORIGIN.y + axis.y * offset,
      STACK_ORIGIN.z + axis.z * offset,
    );
    // Tilt is applied after the flip, matching how the simulation composes
    // them, so the preview is the orientation that will actually be thrown.
    view.mesh.quaternion.setFromAxisAngle(TILT_AXIS, Math.PI - tilt);
    if (entry.flipped) view.mesh.quaternion.multiply(FLIP_QUAT);
  });
}
