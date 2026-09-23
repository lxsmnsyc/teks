import * as THREE from 'three';
import { ARENA_HALF_SIZE, STACK_ORIGIN } from '~/sim/constants';

/**
 * How far the drawn ground runs out, in metres. The ground itself has no edge;
 * this only needs to reach past the fog so none is ever visible.
 */
const VISIBLE_GROUND = 60;

export interface Arena {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Where the camera looks. Pieces are parented here for convenience. */
  pieces: THREE.Group;
  /**
   * Asks the camera to hold everything within `radius` metres of the centre of
   * play. The camera eases toward it, or snaps if told to.
   */
  frame: (radius: number, immediate?: boolean) => void;
  /** Advances the camera easing by `delta` seconds. */
  update: (delta: number) => void;
  /**
   * Tells the camera how many pixels at the top and bottom of the canvas are
   * covered by the interface, so what matters is framed in the part that is
   * still visible.
   */
  setInset: (top: number, bottom: number) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

/** What the camera holds in view while the launcher is still aiming. */
export const BASE_FRAME_RADIUS = 4.2;

/** The point the camera looks at, out in front of the throwing mark. */
const FOCUS = new THREE.Vector3(0, 0.3, 1.2);
/** Direction from the focus out to the camera: high, and behind the mark. */
const VIEW_DIRECTION = new THREE.Vector3(0, 6.2, -6).normalize();
/** How quickly the camera settles onto a new framing, per second. */
const FRAME_EASE = 2.2;

const FLOOR_COLOR = 0x2d3a2f;
const LINE_COLOR = 0x4f6b54;

function createFloor(): THREE.Group {
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(VISIBLE_GROUND, 0.02, VISIBLE_GROUND),
    new THREE.MeshStandardMaterial({
      color: FLOOR_COLOR,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  group.add(floor);

  // The grid marks the area worth aiming at. The ground continues past it, so
  // it reads as a marked-out pitch rather than the edge of the world.
  const grid = new THREE.GridHelper(
    ARENA_HALF_SIZE * 2,
    12,
    LINE_COLOR,
    LINE_COLOR,
  );
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.opacity = 0.25;
  gridMaterial.transparent = true;
  grid.position.y = 0.001;
  group.add(grid);

  // A ring marking where the stack is thrown from.
  const mark = new THREE.Mesh(
    new THREE.RingGeometry(0.1, 0.12, 48),
    new THREE.MeshBasicMaterial({
      color: 0xd9b26a,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(STACK_ORIGIN.x, 0.002, STACK_ORIGIN.z);
  group.add(mark);

  return group;
}

/**
 * Builds the three.js side of the arena: renderer, camera and static scenery.
 * The camera is fixed behind the throwing mark so the throw always reads the
 * same way, which matters more here than free orbiting.
 */
export function createArenaView(canvas: HTMLCanvasElement): Arena {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161a);
  scene.fog = new THREE.Fog(0x11161a, 14, 46);

  // High and looking down the arena, so the stack waiting on the mark sits low
  // in the frame and the throw travels up and away from the viewer.
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);

  let wanted = BASE_FRAME_RADIUS;
  let shown = BASE_FRAME_RADIUS;

  let width = 1;
  let height = 1;
  let insetTop = 0;
  let insetBottom = 0;

  /**
   * Slides the picture so its centre sits in the middle of the uncovered
   * band. The frustum is skewed rather than the camera moved, so the view
   * keeps looking down the arena from the same place.
   */
  const applyInset = (): void => {
    camera.setViewOffset(
      width,
      height,
      0,
      (insetBottom - insetTop) / 2,
      width,
      height,
    );
    camera.updateProjectionMatrix();
  };

  /** How far back the camera has to sit to hold a circle of this radius. */
  const distanceFor = (radius: number): number => {
    // Only the uncovered band counts: a radius that fits the whole canvas
    // would put the edges of the throw under the interface.
    const usable = Math.max(0.35, (height - insetTop - insetBottom) / height);
    const half = Math.tan(((camera.fov / 2) * Math.PI) / 180) * usable;
    // The vertical field is the given one; the horizontal follows the aspect,
    // so a narrow viewport needs the camera further back for the same radius.
    return Math.max(radius / half, radius / (half * camera.aspect));
  };

  const place = (): void => {
    const distance = distanceFor(shown);
    camera.position.copy(VIEW_DIRECTION).multiplyScalar(distance).add(FOCUS);
    camera.lookAt(FOCUS);
  };

  const ambient = new THREE.HemisphereLight(0x9fb8c8, 0x27302a, 1.1);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff2d8, 2.1);
  key.position.set(2.5, 5, -1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -ARENA_HALF_SIZE;
  key.shadow.camera.right = ARENA_HALF_SIZE;
  key.shadow.camera.top = ARENA_HALF_SIZE;
  key.shadow.camera.bottom = -ARENA_HALF_SIZE;
  scene.add(key);

  scene.add(createFloor());

  const pieces = new THREE.Group();
  scene.add(pieces);

  const resize = (nextWidth: number, nextHeight: number): void => {
    if (nextWidth === 0 || nextHeight === 0) return;
    width = nextWidth;
    height = nextHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    applyInset();
    place();
  };

  const setInset = (top: number, bottom: number): void => {
    insetTop = top;
    insetBottom = bottom;
    applyInset();
    place();
  };

  const frame = (radius: number, immediate = false): void => {
    wanted = Math.max(radius, BASE_FRAME_RADIUS);
    if (immediate) shown = wanted;
    place();
  };

  const update = (delta: number): void => {
    if (Math.abs(wanted - shown) < 1e-3) return;
    // Ease rather than cut, so a throw that runs long is followed out rather
    // than snapping the whole table to a new size.
    shown += (wanted - shown) * Math.min(1, delta * FRAME_EASE);
    place();
  };

  place();

  const dispose = (): void => {
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        for (const entry of material) entry.dispose();
      } else {
        material.dispose();
      }
    });
    renderer.dispose();
  };

  return {
    renderer,
    scene,
    camera,
    pieces,
    frame,
    update,
    setInset,
    resize,
    dispose,
  };
}
