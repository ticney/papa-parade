import type { LevelGeometry } from '@content/schemas/levelGeometry';
import {
  Color,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  type Scene,
} from 'three';
import { PALETTE } from './materials/palette.ts';

// Art constants (Geo tunes them here until E7), named with their units.
/** A shadow is this much wider than the footprint it sits under, in percent. */
const BLOB_MARGIN_PCT = 30;
/** Opacity of the darkest point of a shadow. */
const BLOB_OPACITY = 0.38;
/** The shadows float this far above the floor so that they never fight it for the depth buffer, in metres. */
const BLOB_LIFT_M = 0.004;
/** A collider whose top is higher than this is a wall, not furniture: no blob under it, in metres. */
const BLOB_MAX_TOP_M = 2;
/** Side of the shadow texture, in texels. */
const BLOB_TEXTURE_SIZE_PX = 64;

export interface BlobFootprint {
  centerXM: number;
  centerZM: number;
  widthM: number;
  depthM: number;
}

/**
 * Where the blob of a collider goes and how big it is, or null when it gets none (a wall, or a
 * collider with no footprint). Pure.
 */
export function blobFootprint(collider: LevelGeometry['colliders'][number]): BlobFootprint | null {
  const [cx, cy, cz] = collider.centerM;
  const [hx, hy, hz] = collider.halfExtentsM;
  if (cy + hy > BLOB_MAX_TOP_M || hx === 0 || hz === 0) return null;
  const grow = 1 + BLOB_MARGIN_PCT / 100;
  return { centerXM: cx, centerZM: cz, widthM: hx * 2 * grow, depthM: hz * 2 * grow };
}

/** Alpha of the shadow at distance `r` from its centre, `r` = 1 at the rim: smooth, 0 at and past the rim. */
export function blobAlpha(r: number): number {
  if (r >= 1) return 0;
  const falloff = 1 - r * r;
  return falloff * falloff;
}

function createBlobTexture(): DataTexture {
  const size = BLOB_TEXTURE_SIZE_PX;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const at = (y * size + x) * 4;
      data.set([255, 255, 255, Math.round(blobAlpha(r) * 255)], at);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export interface BlobShadows {
  /** How many blobs were added. */
  readonly count: number;
  dispose(): void;
}

/**
 * One soft round shadow on the floor under each collider footprint (no shadow map anywhere: the
 * renderer's `shadowMap` stays off). All blobs share one geometry, one texture and one material.
 */
export function addBlobShadows(scene: Scene, colliders: LevelGeometry['colliders']): BlobShadows {
  const texture = createBlobTexture();
  const material = new MeshBasicMaterial({
    map: texture,
    color: new Color(PALETTE.ink),
    transparent: true,
    opacity: BLOB_OPACITY,
    depthWrite: false,
  });
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2); // a plane is born vertical; the blob lies on the floor
  let count = 0;
  for (const collider of colliders) {
    const footprint = blobFootprint(collider);
    if (footprint === null) continue;
    const blob = new Mesh(geometry, material);
    blob.name = `blob_${collider.id}`;
    blob.position.set(footprint.centerXM, BLOB_LIFT_M, footprint.centerZM);
    blob.scale.set(footprint.widthM, 1, footprint.depthM);
    blob.renderOrder = 1; // after the floor
    scene.add(blob);
    count++;
  }
  return {
    count,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
