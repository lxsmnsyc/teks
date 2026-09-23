import * as THREE from 'three';
import { pieceShape } from '~/sim/shape';
import type { SimPiece } from '~/sim/types';

/** The shared back every piece shows when it lands face down. */
const BACK_COLOR = 0x1d232b;

function faceMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    // The two pyramids are separate surfaces meeting at the rim, so the crease
    // between them should read as an edge rather than being smoothed over.
    flatShading: true,
  });
}

/**
 * Builds a piece from the same bipyramid the physics uses, with the owner's
 * colour on the side that counts as its face and the common back on the other,
 * so a glance at the arena tells you which pieces landed which way up.
 */
export function createPieceMesh(ownerColor: number): THREE.Mesh {
  const shape = pieceShape();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(shape.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(shape.indices, 1));
  shape.groups.forEach((group, material) => {
    geometry.addGroup(group.start, group.count, material);
  });
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, [
    faceMaterial(ownerColor),
    faceMaterial(BACK_COLOR),
  ]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Distinct, readable colours assigned to players in seat order. */
export const OWNER_COLORS = [
  0xe4572e, 0x30a9de, 0xf4d35e, 0x8ac926, 0xc77dff, 0xff9ecd,
];

export function ownerColor(index: number): number {
  return OWNER_COLORS[index % OWNER_COLORS.length];
}

export interface PieceView {
  piece: SimPiece;
  mesh: THREE.Mesh;
}

/** Creates one mesh per piece and parents them all to the arena group. */
export function createPieceViews(
  parent: THREE.Object3D,
  pieces: SimPiece[],
  colorOf: (piece: SimPiece) => number,
): PieceView[] {
  return pieces.map(piece => {
    const mesh = createPieceMesh(colorOf(piece));
    parent.add(mesh);
    return { piece, mesh };
  });
}

export function disposePieceViews(
  parent: THREE.Object3D,
  views: PieceView[],
): void {
  for (const view of views) {
    parent.remove(view.mesh);
    view.mesh.geometry.dispose();
    const material = view.mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material.dispose();
    }
  }
}
