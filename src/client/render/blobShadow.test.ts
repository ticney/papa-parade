import { Mesh, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { addBlobShadows, blobAlpha, blobFootprint } from './blobShadow.ts';

const collider = (
  id: string,
  centerM: [number, number, number],
  halfExtentsM: [number, number, number],
) => ({
  id,
  centerM,
  halfExtentsM,
});

describe('blobFootprint', () => {
  it('is centred under the collider and wider than it', () => {
    const footprint = blobFootprint(collider('sofa', [0.5, 0.45, -1.75], [1.1, 0.45, 0.45]));
    expect(footprint).not.toBeNull();
    expect(footprint?.centerXM).toBe(0.5);
    expect(footprint?.centerZM).toBe(-1.75);
    expect(footprint?.widthM).toBeGreaterThan(2.2);
    expect(footprint?.depthM).toBeGreaterThan(0.9);
  });

  it('gives a wall no blob', () => {
    expect(blobFootprint(collider('wall_back', [0, 1.25, -3.1], [4.2, 1.25, 0.1]))).toBeNull();
  });

  it('gives a collider with no footprint no blob', () => {
    expect(blobFootprint(collider('flat', [0, 0.1, 0], [0, 0.1, 1]))).toBeNull();
  });
});

describe('blobAlpha', () => {
  it('is opaque at the centre, soft in between and nothing at the rim and beyond', () => {
    expect(blobAlpha(0)).toBe(1);
    expect(blobAlpha(0.5)).toBeGreaterThan(0);
    expect(blobAlpha(0.5)).toBeLessThan(1);
    expect(blobAlpha(1)).toBe(0);
    expect(blobAlpha(2)).toBe(0);
  });

  it('never grows with the distance', () => {
    let previous = 1;
    for (let r = 0; r <= 1; r += 0.05) {
      expect(blobAlpha(r)).toBeLessThanOrEqual(previous);
      previous = blobAlpha(r);
    }
  });
});

describe('addBlobShadows', () => {
  it('adds one flat, transparent, depth-write-free quad per piece of furniture', () => {
    const scene = new Scene();
    const shadows = addBlobShadows(scene, [
      collider('sofa', [0, 0.45, 0], [1, 0.45, 0.4]),
      collider('table', [2, 0.2, 0], [0.5, 0.2, 0.3]),
      collider('wall', [0, 1.25, -3], [4, 1.25, 0.1]),
    ]);
    expect(shadows.count).toBe(2);
    const blobs = scene.children.filter((child): child is Mesh => child instanceof Mesh);
    expect(blobs.map((blob) => blob.name)).toEqual(['blob_sofa', 'blob_table']);
    const [first, second] = blobs;
    expect(first?.material).toBe(second?.material);
    expect(first?.geometry).toBe(second?.geometry);
    const material = first?.material as { transparent: boolean; depthWrite: boolean };
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(first?.position.y).toBeGreaterThan(0);
    expect(first?.position.y).toBeLessThan(0.05);
    shadows.dispose();
  });
});
