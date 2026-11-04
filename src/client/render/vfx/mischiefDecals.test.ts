import type { MischiefMark } from '@sim';
import { Group, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestGeometry } from '../../../../tests/support/testContent.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  createDecalGeometry,
  createMischiefDecals,
  DECAL_LIFT_M,
  visibleDecalPoint,
} from './mischiefDecals.ts';

const colliders = createTestGeometry().colliders;
const TONES = [96, 178, 255];

const mark = (gag: MischiefMark['gag'], xM: number, zM: number): MischiefMark => ({
  gag,
  xM,
  zM,
});

describe('visibleDecalPoint', () => {
  const out = { xM: 0, zM: 0 };

  it('keeps a point the camera sees where it is (in front of the furniture)', () => {
    visibleDecalPoint(-2, 2, colliders, out);
    expect(out).toEqual({ xM: -2, zM: 2 });
  });

  it('moves a point hidden behind the sofa towards the camera, past what hid it', () => {
    // The silence's hiding place: behind the sofa, as the baby went there (`ZONE_hidden_behind_sofa`).
    visibleDecalPoint(0.5, -2.6, colliders, out);
    expect(out.xM).toBeGreaterThan(0.5);
    expect(out.zM).toBeGreaterThan(-2.6);
    // And it is seen from there, by the same test the search ends on.
    const moved = { xM: 0, zM: 0 };
    visibleDecalPoint(out.xM, out.zM, colliders, moved);
    expect(moved).toEqual(out);
  });

  it('does not take a wall for cover: a point against the back wall is in front of it', () => {
    visibleDecalPoint(-3, -2.9, colliders, out);
    expect(out).toEqual({ xM: -3, zM: -2.9 });
  });

  it('stays where it is when no collider can hide it', () => {
    visibleDecalPoint(0.5, -2.6, [], out);
    expect(out).toEqual({ xM: 0.5, zM: -2.6 });
  });

  it('writes the same point for the same input (no randomness)', () => {
    const a = { xM: 0, zM: 0 };
    visibleDecalPoint(0.5, -2.6, colliders, a);
    visibleDecalPoint(0.5, -2.6, colliders, out);
    expect(a).toEqual(out);
  });
});

describe('createDecalGeometry', () => {
  it('lies flat on the floor and is the same every time for the same mark', () => {
    for (const gag of ['tissues_everywhere', 'crayon_scribbles']) {
      const a = createDecalGeometry(gag, 3);
      const b = createDecalGeometry(gag, 3);
      const positions = a.getAttribute('position');
      expect(positions.count).toBeGreaterThan(0);
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBe(0);
      expect(Array.from(a.getAttribute('position').array)).toEqual(
        Array.from(b.getAttribute('position').array),
      );
      a.dispose();
      b.dispose();
    }
  });

  it('is not the same from one mark to the next, nor from one gag to the other', () => {
    const first = createDecalGeometry('tissues_everywhere', 0);
    const second = createDecalGeometry('tissues_everywhere', 1);
    const crayon = createDecalGeometry('crayon_scribbles', 0);
    expect(Array.from(first.getAttribute('position').array)).not.toEqual(
      Array.from(second.getAttribute('position').array),
    );
    expect(crayon.getAttribute('position').count).not.toBe(first.getAttribute('position').count);
    for (const geometry of [first, second, crayon]) geometry.dispose();
  });

  it('indexes only vertices it made', () => {
    const geometry = createDecalGeometry('crayon_scribbles', 2);
    const count = geometry.getAttribute('position').count;
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    expect(Math.max(...Array.from(index?.array ?? []))).toBeLessThan(count);
    geometry.dispose();
  });
});

describe('createMischiefDecals', () => {
  const build = () => {
    const parent = new Group();
    const toon = createToonMaterialCache(TONES);
    return { parent, decals: createMischiefDecals(parent, colliders, toon), toon };
  };

  it('draws one mesh per mark, a little above the floor, and makes nothing more on the next frame', () => {
    const { parent, decals } = build();
    const marks = [mark('tissues_everywhere', -2, 2), mark('crayon_scribbles', -1, 1.5)];
    decals.sync(marks);
    expect(decals.count).toBe(2);
    expect(parent.children).toHaveLength(2);
    const [first] = parent.children as Mesh[];
    expect(first?.position.y).toBe(DECAL_LIFT_M);
    const meshes = [...parent.children];
    decals.sync(marks);
    expect(parent.children).toEqual(meshes);
  });

  it('adds the mark that comes later, and keeps the ones it has', () => {
    const { parent, decals } = build();
    decals.sync([mark('tissues_everywhere', -2, 2)]);
    const first = parent.children[0];
    decals.sync([mark('tissues_everywhere', -2, 2), mark('crayon_scribbles', 1, 2)]);
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0]).toBe(first);
  });

  it('removes every decal when the world lists fewer (a restart), and on clear and dispose', () => {
    const { parent, decals } = build();
    decals.sync([mark('tissues_everywhere', -2, 2), mark('crayon_scribbles', 1, 2)]);
    decals.sync([]);
    expect(parent.children).toHaveLength(0);
    decals.sync([mark('crayon_scribbles', 1, 2)]);
    decals.clear();
    expect(decals.count).toBe(0);
    decals.sync([mark('crayon_scribbles', 1, 2)]);
    decals.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('shares its materials: two marks of the same kind add no draw state', () => {
    const { toon, decals } = build();
    decals.sync([mark('tissues_everywhere', -2, 2), mark('tissues_everywhere', 1, 2)]);
    expect(toon.size).toBe(1);
  });
});
