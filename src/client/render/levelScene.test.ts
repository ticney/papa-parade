import { createSim } from '@sim';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createTestContent, stepN } from '../../../tests/support/testContent.ts';
import { createTestLevelGeometry } from '../../../tests/support/testLevelGeometry.ts';
import { createLevelScene, probePathOf, roomOf } from './levelScene.ts';

function mesh(name: string, color: number): Mesh {
  const result = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color }));
  result.name = name;
  return result;
}

function buildModel(): Group {
  const model = new Group();
  model.add(
    mesh('floor', 0xfff4e3),
    mesh('sofa', 0x6d3fe0),
    mesh('wall_back', 0xfff4e3),
    mesh('COL_sofa', 0xffffff),
    mesh('NAV_floor', 0xffffff),
    mesh('NAV_block_sofa', 0xffffff),
    mesh('ZONE_hidden_behind_sofa', 0xffffff),
    mesh('PROP_mug_01', 0x8a80a8),
  );
  const anchor = new Object3D();
  anchor.name = 'ANCHOR_door';
  model.add(anchor);
  return model;
}

function build() {
  const geometry = createTestLevelGeometry('test_room');
  return { geometry, ...createLevelScene({ id: 'test_room', geometry, model: buildModel() }) };
}

function names(scene: { children: Object3D[] }): string[] {
  const found: string[] = [];
  const walk = (node: Object3D): void => {
    found.push(node.name);
    node.children.forEach(walk);
  };
  scene.children.forEach(walk);
  return found;
}

describe('roomOf', () => {
  it('takes the box from the bounds, down to what goes below the floor (y = 0)', () => {
    const geometry = createTestLevelGeometry();
    geometry.boundsMinM = [-4.2, -0.8, -3.2];
    geometry.boundsMaxM = [4.9, 2.5, 3];
    const room = roomOf(geometry);
    expect(room.widthM).toBeCloseTo(9.1, 9);
    expect(room.depthM).toBeCloseTo(6.2, 9);
    expect(room.floorYM).toBe(-0.8);
    expect(room.heightM).toBeCloseTo(3.3, 9);
    expect(room.centerXM).toBeCloseTo(0.35, 9);
    expect(room.centerZM).toBeCloseTo(-0.1, 9);
  });
});

describe('roomOf, a level that stays above the floor', () => {
  it('starts the box at y = 0, not at the lowest visual', () => {
    const geometry = createTestLevelGeometry();
    geometry.boundsMinM = [-4, 0.3, -3];
    geometry.boundsMaxM = [4, 2.5, 3];
    const room = roomOf(geometry);
    expect(room.floorYM).toBe(0);
    expect(room.heightM).toBe(2.5);
  });
});

describe('probePathOf', () => {
  it('slides along the row of papa_spawn, around the middle of the room, inside its width', () => {
    const geometry = createTestLevelGeometry();
    const path = probePathOf(geometry);
    expect(path.zM).toBe(geometry.anchors.find((a) => a.id === 'papa_spawn')?.positionM[2]);
    expect(path.centerXM).toBe(0);
    expect(path.halfPathM).toBeGreaterThan(0);
    expect(path.halfPathM).toBeLessThan((geometry.boundsMaxM[0] - geometry.boundsMinM[0]) / 2);
  });
});

describe('createLevelScene', () => {
  it('removes the collision, navigation, zone and anchor nodes and keeps the visuals and props', () => {
    const { scene } = build();
    const found = names(scene);
    for (const kept of ['floor', 'sofa', 'wall_back', 'PROP_mug_01', 'probe']) {
      expect(found).toContain(kept);
    }
    for (const gone of [
      'COL_sofa',
      'NAV_floor',
      'NAV_block_sofa',
      'ZONE_hidden_behind_sofa',
      'ANCHOR_door',
    ]) {
      expect(found).not.toContain(gone);
    }
  });

  it('hides a malformed gameplay node instead of showing it as a box, and keeps odd visual names', () => {
    const geometry = createTestLevelGeometry('test_room');
    const model = new Group();
    model.add(
      mesh('COL_Sofa', 0xffffff),
      mesh('nav_block_x', 0xffffff),
      mesh('ZONE_nowhere', 0xffffff),
      mesh('Sofa_Cube', 0x6d3fe0),
      mesh('collar', 0x6d3fe0),
    );
    const found = names(createLevelScene({ id: 'test_room', geometry, model }).scene);
    for (const gone of ['COL_Sofa', 'nav_block_x', 'ZONE_nowhere']) {
      expect(found).not.toContain(gone);
    }
    expect(found).toContain('Sofa_Cube');
    expect(found).toContain('collar');
  });

  it('gives every model mesh a shared toon material of its own colour, and the probe a basic one', () => {
    const { scene } = build();
    const floor = scene.getObjectByName('floor') as Mesh;
    const wall = scene.getObjectByName('wall_back') as Mesh;
    const sofa = scene.getObjectByName('sofa') as Mesh;
    expect(floor.material).toBeInstanceOf(MeshToonMaterial);
    expect(floor.material).toBe(wall.material); // same colour, one material
    expect(sofa.material).not.toBe(floor.material);
    expect((sofa.material as MeshToonMaterial).color.getHex()).toBe(new Color(0x6d3fe0).getHex());
    expect((scene.getObjectByName('probe') as Mesh).material).toBeInstanceOf(MeshBasicMaterial);
  });

  it('adds blob shadows under the furniture and lights, and uses no shadow map', () => {
    const { scene } = build();
    expect(names(scene)).toContain('blob_sofa');
    const lights = scene.children.filter((child) => 'isLight' in child);
    expect(lights.length).toBeGreaterThanOrEqual(2);
    for (const light of lights)
      expect((light as { castShadow?: boolean }).castShadow ?? false).toBe(false);
  });

  it('exposes the room of its geometry', () => {
    const { room, geometry } = build();
    expect(room).toEqual(roomOf(geometry));
  });

  it('moves the probe with the sim clock and nothing else', async () => {
    const { scene, update } = build();
    const probe = scene.getObjectByName('probe');
    const floor = scene.getObjectByName('floor');
    const floorBefore = floor?.position.toArray();
    const simAt = async (steps: number) => {
      const sim = await createSim({ content: createTestContent(), seed: 1 });
      stepN(sim, steps);
      return sim.world;
    };
    const [at0, at25, at26] = await Promise.all([simAt(0), simAt(25), simAt(26)]);

    update(at0, 0);
    const startX = probe?.position.x;
    update(at25, 0);
    expect(probe?.position.x).not.toBe(startX);

    // The same continuous clock gives the same place, however it is split between step and alpha.
    update(at25, 1);
    const fromAlpha = probe?.position.x as number;
    update(at26, 0);
    expect(probe?.position.x).toBeCloseTo(fromAlpha, 9);
    expect(floor?.position.toArray()).toEqual(floorBefore);
  });

  it('disposes geometries, materials and textures, and empties the scene', () => {
    const { scene, dispose } = build();
    const meshes: Mesh[] = [];
    scene.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    let disposed = 0;
    for (const m of meshes) m.geometry.addEventListener('dispose', () => disposed++);
    dispose();
    expect(disposed).toBeGreaterThan(0);
    expect(scene.children).toHaveLength(0);
  });
});
