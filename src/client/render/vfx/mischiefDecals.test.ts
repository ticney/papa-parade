import type { MischiefMark } from '@sim';
import { Group, type Mesh, type MeshToonMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestGeometry } from '../../../../tests/support/testContent.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  createDecalGeometry,
  createMischiefDecals,
  DECAL_LIFT_M,
  type DecalCover,
  type DecalView,
  decalColorOf,
  GAME_VIEW,
  visibleDecalPoint,
} from './mischiefDecals.ts';

const geometry = createTestGeometry();
const colliders = geometry.colliders;
const cover: DecalCover = {
  colliders,
  wallHeightM: 2,
  boundsMinM: geometry.boundsMinM,
  boundsMaxM: geometry.boundsMaxM,
};
// The end photo's camera, lower and turned from the game's (`feel.fx.photoCamera`).
const PHOTO: DecalView = { yawDeg: 38, pitchDeg: 30 };
const VIEWS = [GAME_VIEW, PHOTO];
const TONES = [96, 178, 255];

const mark = (gag: MischiefMark['gag'], xM: number, zM: number): MischiefMark => ({
  gag,
  xM,
  zM,
});

describe('visibleDecalPoint', () => {
  const out = { xM: 0, zM: 0 };

  it('keeps a point the camera sees where it is (in front of the furniture)', () => {
    visibleDecalPoint(-2, 2, cover, VIEWS, out);
    expect(out).toEqual({ xM: -2, zM: 2 });
  });

  it('moves a point hidden behind the sofa towards the camera, past what hid it', () => {
    // The silence's hiding place: behind the sofa, as the baby went there (`ZONE_hidden_behind_sofa`).
    visibleDecalPoint(0.5, -2.6, cover, VIEWS, out);
    expect(out.xM).toBeGreaterThan(0.5);
    expect(out.zM).toBeGreaterThan(-2.6);
    // And it is seen from there, by the same test the search ends on.
    const moved = { xM: 0, zM: 0 };
    visibleDecalPoint(out.xM, out.zM, cover, VIEWS, moved);
    expect(moved).toEqual(out);
  });

  it('does not take a wall for cover: a point against the back wall is in front of it', () => {
    visibleDecalPoint(-3, -2.9, cover, VIEWS, out);
    expect(out).toEqual({ xM: -3, zM: -2.9 });
  });

  it('stays where it is when no collider can hide it', () => {
    visibleDecalPoint(0.5, -2.6, { ...cover, colliders: [] }, VIEWS, out);
    expect(out).toEqual({ xM: 0.5, zM: -2.6 });
  });

  it('is seen from the end photo too: a point the game camera sees but the photo camera does not is moved', () => {
    // Find a floor point hidden from the photo camera only, then check it moves with the photo view and not without.
    const hiddenFromPhoto = { xM: 0, zM: 0 };
    let found = false;
    for (let x = -3; x <= 3 && !found; x += 0.1) {
      for (let z = -3; z <= 3 && !found; z += 0.1) {
        const gameOnly = { xM: 0, zM: 0 };
        const both = { xM: 0, zM: 0 };
        visibleDecalPoint(x, z, cover, [GAME_VIEW], gameOnly);
        visibleDecalPoint(x, z, cover, VIEWS, both);
        if (gameOnly.xM === x && gameOnly.zM === z && (both.xM !== x || both.zM !== z)) {
          hiddenFromPhoto.xM = x;
          hiddenFromPhoto.zM = z;
          found = true;
        }
      }
    }
    expect(found).toBe(true);
    visibleDecalPoint(hiddenFromPhoto.xM, hiddenFromPhoto.zM, cover, VIEWS, out);
    const moved = { xM: 0, zM: 0 };
    visibleDecalPoint(out.xM, out.zM, cover, VIEWS, moved);
    expect(moved).toEqual(out);
  });

  it('follows the wall height it is given: a collider taller than it is a wall, not cover', () => {
    const tall = { ...cover, wallHeightM: 0.1 };
    visibleDecalPoint(0.5, -2.6, tall, VIEWS, out);
    expect(out).toEqual({ xM: 0.5, zM: -2.6 });
  });

  it('never moves a decal out of the room', () => {
    const tiny = { ...cover, boundsMaxM: [0.6, 3, -2.5] as const };
    visibleDecalPoint(0.5, -2.6, tiny, VIEWS, out);
    expect(out).toEqual({ xM: 0.5, zM: -2.6 });
  });

  it('writes the same point for the same input (no randomness)', () => {
    const a = { xM: 0, zM: 0 };
    visibleDecalPoint(0.5, -2.6, cover, VIEWS, a);
    visibleDecalPoint(0.5, -2.6, cover, VIEWS, out);
    expect(a).toEqual(out);
  });
});

describe('createDecalGeometry', () => {
  it('lies flat on the floor and is the same every time for the same mark', () => {
    for (const gag of [
      'tissues_everywhere',
      'crayon_scribbles',
      'pot_boiled_over',
      'baby_in_dishwasher',
    ]) {
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

  it.each(['tissues_everywhere', 'crayon_scribbles', 'pot_boiled_over', 'baby_in_dishwasher'])(
    'indexes only vertices it made (%s)',
    (gag) => {
      const geometry = createDecalGeometry(gag, 2);
      const count = geometry.getAttribute('position').count;
      const index = geometry.getIndex();
      expect(index).not.toBeNull();
      expect(Math.max(...Array.from(index?.array ?? []))).toBeLessThan(count);
      geometry.dispose();
    },
  );

  it('draws the purée of the pot as a puddle with splashes of its own, not the tissues or the crayons (story 9.5)', () => {
    const puree = createDecalGeometry('pot_boiled_over', 0);
    const tissues = createDecalGeometry('tissues_everywhere', 0);
    const crayons = createDecalGeometry('crayon_scribbles', 0);
    // The puddle's centre and rim (1 + 14 points), then four splashes of four corners each.
    expect(puree.getAttribute('position').count).toBe(1 + 14 + 4 * 4);
    expect(puree.getAttribute('position').count).not.toBe(tissues.getAttribute('position').count);
    expect(puree.getAttribute('position').count).not.toBe(crayons.getAttribute('position').count);
    for (const geometry of [puree, tissues, crayons]) geometry.dispose();
  });

  it('draws the cutlery of the open dishwasher as pieces with a head, not the tissues, the crayons or the purée (story 9.6)', () => {
    const cutlery = createDecalGeometry('baby_in_dishwasher', 0);
    // Six pieces, each a thin shaft and a wider head: two quads of four corners.
    expect(cutlery.getAttribute('position').count).toBe(6 * 2 * 4);
    for (const gag of ['tissues_everywhere', 'crayon_scribbles', 'pot_boiled_over']) {
      const other = createDecalGeometry(gag, 0);
      expect(cutlery.getAttribute('position').count, gag).not.toBe(
        other.getAttribute('position').count,
      );
      other.dispose();
    }
    // Strewn round the mark, differently from one mark to the next.
    const second = createDecalGeometry('baby_in_dishwasher', 1);
    expect(Array.from(second.getAttribute('position').array)).not.toEqual(
      Array.from(cutlery.getAttribute('position').array),
    );
    cutlery.dispose();
    second.dispose();
  });
});

describe('the decals of the five mischiefs of the big salon (story 9.7)', () => {
  /** Each new gag, its vertex count for mark 0 (what its pattern is made of) and its colour. */
  const NEW_DECALS = [
    // Nine triangle shards.
    { gag: 'dishes_on_floor', vertices: 9 * 3, color: 0xdfe9f2 },
    // Four discs of a centre and ten rim points.
    { gag: 'pan_concert', vertices: 4 * 11, color: 0x59606b },
    // Nine thin quads; the first mark's peelings are beige.
    { gag: 'peelings_everywhere', vertices: 9 * 4, color: 0xd9c59a },
    // The patch (a centre and 14 rim points) and six crumbs of four corners.
    { gag: 'soil_on_rug', vertices: 1 + 14 + 6 * 4, color: 0x4a3223 },
    // One puddle: a centre and 14 rim points.
    { gag: 'coffee_spilled', vertices: 1 + 14, color: 0x7a4a2b },
  ] as const;

  it.each(NEW_DECALS)(
    'draws $gag flat, with its own pattern and the same every time',
    ({ gag, vertices }) => {
      const a = createDecalGeometry(gag, 0);
      const b = createDecalGeometry(gag, 0);
      const positions = a.getAttribute('position');
      expect(positions.count).toBe(vertices);
      for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBe(0);
      expect(Array.from(positions.array)).toEqual(Array.from(b.getAttribute('position').array));
      const index = a.getIndex();
      expect(Math.max(...Array.from(index?.array ?? []))).toBeLessThan(positions.count);
      // Another mark of the same gag is not a copy of this one.
      const next = createDecalGeometry(gag, 1);
      expect(Array.from(next.getAttribute('position').array)).not.toEqual(
        Array.from(positions.array),
      );
      for (const geometry of [a, b, next]) geometry.dispose();
    },
  );

  it('gives each of the five, the older gags and the tissues a pattern of its own', () => {
    const gags = [
      'tissues_everywhere',
      'crayon_scribbles',
      'pot_boiled_over',
      'baby_in_dishwasher',
      ...NEW_DECALS.map(({ gag }) => gag),
    ];
    const patterns = gags.map((gag) => {
      const geometry = createDecalGeometry(gag, 0);
      const pattern = Array.from(geometry.getAttribute('position').array).join(',');
      geometry.dispose();
      return pattern;
    });
    expect(new Set(patterns).size).toBe(gags.length);
  });

  it.each(NEW_DECALS)(
    'colours $gag in a colour of its own, never the tissues’ white',
    ({ gag, color }) => {
      expect(decalColorOf(gag, 0)).toBe(color);
      expect(decalColorOf(gag, 0)).not.toBe(decalColorOf('tissues_everywhere', 0));
      const parent = new Group();
      const decals = createMischiefDecals(parent, cover, createToonMaterialCache(TONES));
      decals.sync([mark(gag, -2, 2)], PHOTO);
      const mesh = parent.children[0] as Mesh;
      expect((mesh.material as MeshToonMaterial).color.getHex()).toBe(color);
    },
  );

  it('alternates the peelings between beige and green from one mark to the next', () => {
    const first = decalColorOf('peelings_everywhere', 0);
    const second = decalColorOf('peelings_everywhere', 1);
    expect(first).not.toBe(second);
    expect(decalColorOf('peelings_everywhere', 2)).toBe(first);
  });

  it('falls back to the tissues’ colour for a gag with no row', () => {
    expect(decalColorOf('burp', 0)).toBe(decalColorOf('tissues_everywhere', 0));
  });

  it('keeps the soil and the coffee apart: two browns, not one', () => {
    expect(decalColorOf('soil_on_rug', 0)).not.toBe(decalColorOf('coffee_spilled', 0));
  });
});

describe('createMischiefDecals', () => {
  const build = () => {
    const parent = new Group();
    const toon = createToonMaterialCache(TONES);
    return { parent, decals: createMischiefDecals(parent, cover, toon), toon };
  };

  it('draws one mesh per mark, a little above the floor, and makes nothing more on the next frame', () => {
    const { parent, decals } = build();
    const marks = [mark('tissues_everywhere', -2, 2), mark('crayon_scribbles', -1, 1.5)];
    decals.sync(marks, PHOTO);
    expect(decals.count).toBe(2);
    expect(parent.children).toHaveLength(2);
    const [first] = parent.children as Mesh[];
    expect(first?.position.y).toBe(DECAL_LIFT_M);
    const meshes = [...parent.children];
    decals.sync(marks, PHOTO);
    expect(parent.children).toEqual(meshes);
  });

  it('adds the mark that comes later, and keeps the ones it has', () => {
    const { parent, decals } = build();
    decals.sync([mark('tissues_everywhere', -2, 2)], PHOTO);
    const first = parent.children[0];
    decals.sync([mark('tissues_everywhere', -2, 2), mark('crayon_scribbles', 1, 2)], PHOTO);
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0]).toBe(first);
  });

  it('removes every decal when the world lists fewer (a restart), and on clear and dispose', () => {
    const { parent, decals } = build();
    decals.sync([mark('tissues_everywhere', -2, 2), mark('crayon_scribbles', 1, 2)], PHOTO);
    decals.sync([], PHOTO);
    expect(parent.children).toHaveLength(0);
    decals.sync([mark('crayon_scribbles', 1, 2)], PHOTO);
    decals.clear();
    expect(decals.count).toBe(0);
    decals.sync([mark('crayon_scribbles', 1, 2)], PHOTO);
    decals.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('shares its materials: two marks of the same kind add no draw state', () => {
    const { toon, decals } = build();
    decals.sync([mark('tissues_everywhere', -2, 2), mark('tissues_everywhere', 1, 2)], PHOTO);
    expect(toon.size).toBe(1);
  });

  it('draws the baby’s dishwasher as cutlery in a steel grey of its own, not the tissues’ white (story 9.6)', () => {
    const { parent, decals, toon } = build();
    decals.sync([mark('tissues_everywhere', -2, 2), mark('baby_in_dishwasher', -1, 2)], PHOTO);
    const [tissues, cutlery] = parent.children as Mesh[];
    expect(cutlery?.name).toBe('mischief_decal_1');
    expect(cutlery?.material).not.toBe(tissues?.material);
    expect(toon.size).toBe(2);
    expect(cutlery?.geometry.getAttribute('position').count).toBe(6 * 2 * 4);
  });
});
