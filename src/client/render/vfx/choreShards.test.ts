import { CHORE_SHARDS_MAX } from '@shared/constants';
import { Group, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestGeometry } from '../../../../tests/support/testContent.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  type ChoreStationSpec,
  createChoreShards,
  createShardsGeometry,
  shardCountOf,
} from './choreShards.ts';
import { DECAL_LIFT_M, type DecalCover, GAME_VIEW } from './mischiefDecals.ts';

// The shards of the plates a chore broke (story 9.6, AC 4): one cluster per plate, a count read from the
// world, drawn when it changes and never per frame, with no randomness.

const geometry = createTestGeometry();
const cover: DecalCover = {
  colliders: geometry.colliders,
  wallHeightM: 2,
  boundsMinM: geometry.boundsMinM,
  boundsMaxM: geometry.boundsMaxM,
};
const TONES = [96, 178, 255];
// A cooking that breaks nothing, then a dishwasher that breaks one plate per missed beat, in a floor spot of the room.
const STATIONS: readonly ChoreStationSpec[] = [
  { defId: 'cooking', xM: 2, zM: 1, missBrokenObjects: 0 },
  { defId: 'unload_dishwasher', xM: -2, zM: 2, missBrokenObjects: 1 },
];
const missed = (cooking: number, dishwasher: number) => [
  { beatsMissed: cooking },
  { beatsMissed: dishwasher },
];

describe('shardCountOf', () => {
  it('is the beats missed times the objects a miss breaks', () => {
    expect(shardCountOf(0, 1)).toBe(0);
    expect(shardCountOf(3, 1)).toBe(3);
    expect(shardCountOf(3, 2)).toBe(6);
  });

  it('is 0 for a chore that breaks nothing, whatever it missed', () => {
    expect(shardCountOf(7, 0)).toBe(0);
  });

  it('is held to CHORE_SHARDS_MAX', () => {
    expect(shardCountOf(CHORE_SHARDS_MAX, 1)).toBe(CHORE_SHARDS_MAX);
    expect(shardCountOf(CHORE_SHARDS_MAX + 5, 1)).toBe(CHORE_SHARDS_MAX);
    expect(shardCountOf(CHORE_SHARDS_MAX, 3)).toBe(CHORE_SHARDS_MAX);
  });

  it('never counts a negative', () => {
    expect(shardCountOf(-2, 1)).toBe(0);
  });
});

describe('createShardsGeometry', () => {
  it('lies flat, indexes only vertices it made and is the same every time', () => {
    const a = createShardsGeometry(1, 3);
    const b = createShardsGeometry(1, 3);
    const positions = a.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i++) expect(positions.getY(i)).toBe(0);
    expect(Math.max(...Array.from(a.getIndex()?.array ?? []))).toBeLessThan(positions.count);
    expect(Array.from(a.getAttribute('position').array)).toEqual(
      Array.from(b.getAttribute('position').array),
    );
    a.dispose();
    b.dispose();
  });

  it('draws more for more plates, and not the same for another station', () => {
    const one = createShardsGeometry(1, 1);
    const three = createShardsGeometry(1, 3);
    const other = createShardsGeometry(2, 3);
    expect(three.getAttribute('position').count).toBeGreaterThan(
      one.getAttribute('position').count,
    );
    expect(Array.from(other.getAttribute('position').array)).not.toEqual(
      Array.from(three.getAttribute('position').array),
    );
    for (const g of [one, three, other]) g.dispose();
  });

  it('faces every splinter up, so that the toon material is not culled from the camera', () => {
    const shards = createShardsGeometry(1, 5);
    const position = shards.getAttribute('position');
    const index = shards.getIndex()?.array ?? [];
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t] as number, index[t + 1] as number, index[t + 2] as number];
      // The y of (b - a) x (c - a) for points lying in the xz plane: positive faces up.
      const upward =
        (position.getZ(b) - position.getZ(a)) * (position.getX(c) - position.getX(a)) -
        (position.getX(b) - position.getX(a)) * (position.getZ(c) - position.getZ(a));
      expect(upward).toBeGreaterThan(0);
    }
    shards.dispose();
  });
});

describe('createChoreShards', () => {
  const build = () => {
    const parent = new Group();
    const shards = createChoreShards(parent, cover, createToonMaterialCache(TONES), STATIONS);
    return { parent, shards };
  };

  it('draws nothing for a level whose chores broke nothing', () => {
    const { parent, shards } = build();
    shards.sync(missed(0, 0), GAME_VIEW);
    expect(parent.children).toHaveLength(0);
    expect(shards.plateCount).toBe(0);
  });

  it('draws the shards of the chore that breaks plates, a little above the floor, and none for the cooking', () => {
    const { parent, shards } = build();
    // The cooking missed a lot too: it breaks nothing.
    shards.sync(missed(5, 2), GAME_VIEW);
    expect(parent.children).toHaveLength(1);
    const mesh = parent.children[0] as Mesh;
    expect(mesh.name).toBe('chore_shards_1');
    expect(mesh.position.y).toBe(DECAL_LIFT_M);
    expect(shards.plateCount).toBe(2);
  });

  it('puts the cluster in front of the station, towards the camera, not on it', () => {
    const { parent, shards } = build();
    shards.sync(missed(0, 1), GAME_VIEW);
    const mesh = parent.children[0] as Mesh;
    const station = STATIONS[1] as ChoreStationSpec;
    const distance = Math.hypot(mesh.position.x - station.xM, mesh.position.z - station.zM);
    expect(distance).toBeGreaterThan(0.2);
    expect(distance).toBeLessThan(1.5);
  });

  it('makes a mesh only when the count changes: the next frames reuse it', () => {
    const { parent, shards } = build();
    shards.sync(missed(0, 1), GAME_VIEW);
    const first = parent.children[0];
    for (let frame = 0; frame < 5; frame++) shards.sync(missed(0, 1), GAME_VIEW);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(first);
    // One more plate: the cluster is made again, with the new count.
    shards.sync(missed(0, 2), GAME_VIEW);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).not.toBe(first);
    expect(shards.plateCount).toBe(2);
  });

  it('draws at most CHORE_SHARDS_MAX plates, however many were broken', () => {
    const { shards } = build();
    shards.sync(missed(0, CHORE_SHARDS_MAX + 8), GAME_VIEW);
    expect(shards.plateCount).toBe(CHORE_SHARDS_MAX);
  });

  it('removes the shards when the world lists fewer (a restart), and on clear and dispose', () => {
    const { parent, shards } = build();
    shards.sync(missed(0, 3), GAME_VIEW);
    expect(parent.children).toHaveLength(1);
    shards.sync(missed(0, 0), GAME_VIEW);
    expect(parent.children).toHaveLength(0);
    expect(shards.plateCount).toBe(0);
    shards.sync(missed(0, 2), GAME_VIEW);
    shards.clear();
    expect(parent.children).toHaveLength(0);
    shards.sync(missed(0, 2), GAME_VIEW);
    shards.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('draws the same cluster for the same count, in two scenes: nothing in it is random', () => {
    const a = build();
    const b = build();
    a.shards.sync(missed(0, 4), GAME_VIEW);
    b.shards.sync(missed(0, 4), GAME_VIEW);
    const [ma, mb] = [a.parent.children[0] as Mesh, b.parent.children[0] as Mesh];
    expect(ma.position.toArray()).toEqual(mb.position.toArray());
    expect(Array.from(ma.geometry.getAttribute('position').array)).toEqual(
      Array.from(mb.geometry.getAttribute('position').array),
    );
  });

  it('shares one material between the clusters of every station', () => {
    const parent = new Group();
    const stations: ChoreStationSpec[] = [
      { defId: 'unload_dishwasher', xM: -2, zM: 2, missBrokenObjects: 1 },
      { defId: 'unload_dishwasher', xM: 1, zM: 2, missBrokenObjects: 1 },
    ];
    const shards = createChoreShards(parent, cover, createToonMaterialCache(TONES), stations);
    shards.sync([{ beatsMissed: 1 }, { beatsMissed: 2 }], GAME_VIEW);
    const [first, second] = parent.children as Mesh[];
    expect(first?.material).toBe(second?.material);
    expect(shards.plateCount).toBe(3);
  });
});
