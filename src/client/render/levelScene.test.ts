import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim, type World } from '@sim';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createTestLevelGeometry } from '../../../tests/support/testLevelGeometry.ts';
import { GAG_LIGHTS_DARK_MS, GAG_LIGHTS_FADE_MS, GAG_LIGHTS_MIN_PCT } from './gags.ts';
import { createLevelScene, roomOf } from './levelScene.ts';
import { LIFT_HEIGHT_M, LIFT_MS } from './vfx/liftHop.ts';

const BODIES = { papaRadiusM: 0.25, babyRadiusM: 0.2 };

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
  return {
    geometry,
    ...createLevelScene({ id: 'test_room', geometry, model: buildModel() }, BODIES),
  };
}

// A real world (Papa and the baby at their spawn) whose sim clock the effects tests set by hand.
const effectsWorld = (
  await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel(),
    seed: 1,
  })
).world;

function fakeWorldAt(simMs: number): World {
  effectsWorld.time.sim = asSimMs(simMs);
  return effectsWorld;
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

describe('createLevelScene', () => {
  it('removes the collision, navigation, zone and anchor nodes and keeps the visuals; props are drawn by pooled views at world.props poses', () => {
    const { scene } = build();
    const found = names(scene);
    for (const kept of [
      'floor',
      'sofa',
      'wall_back',
      'prop_mug',
      'blob_mug',
      'papa',
      'blob_papa',
      'baby',
      'baby_gaze',
      'blob_baby',
    ]) {
      expect(found).toContain(kept);
    }
    for (const gone of [
      // The static prop mesh is gone: it is the template of the pooled views now (story 1.15).
      'PROP_mug_01',
      'COL_sofa',
      'NAV_floor',
      'NAV_block_sofa',
      'ZONE_hidden_behind_sofa',
      'ANCHOR_door',
    ]) {
      expect(found).not.toContain(gone);
    }
  });

  describe('the props (story 1.15)', () => {
    const propBody = (scene: { getObjectByName(name: string): Object3D | undefined }) =>
      scene.getObjectByName('prop_mug') as Object3D;

    async function pushedSim() {
      const sim = await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      });
      sim.enqueue({
        type: 'PushProp',
        t: asSimMs(0),
        propId: 'mug_01',
        impulseXNs: 0.72,
        impulseYNs: 0,
        impulseZNs: 0,
      });
      return sim;
    }

    it('has its views ready at creation, hidden, so that nothing is built during play', () => {
      const { scene } = build();
      expect(scene.getObjectsByProperty('name', 'prop_mug')).toHaveLength(1);
      expect(propBody(scene).parent?.visible).toBe(false);
    });

    it('draws a prop at its pose in the world, interpolated, once the world has props', async () => {
      const { scene, update } = build();
      const sim = await pushedSim();
      stepN(sim, 30);
      const mug = sim.world.props[0] as Readonly<World['props'][number]>;
      expect(mug.xM).toBeGreaterThan(mug.prevXM);
      update(sim.world, 0);
      expect(propBody(scene).parent?.visible).toBe(true);
      expect(propBody(scene).position.toArray()).toEqual([mug.prevXM, mug.prevYM, mug.prevZM]);
      update(sim.world, 1);
      expect(propBody(scene).position.toArray()).toEqual([mug.xM, mug.yM, mug.zM]);
      update(sim.world, 0.5);
      expect(propBody(scene).position.x).toBeCloseTo((mug.prevXM + mug.xM) / 2, 12);
    });

    it('moves the view when the prop moves in the world', async () => {
      const { scene, update } = build();
      const sim = await pushedSim();
      update(sim.world, 1);
      const before = propBody(scene).position.x;
      stepN(sim, 30);
      update(sim.world, 1);
      expect(propBody(scene).position.x).toBeGreaterThan(before);
    });

    it('builds no view for a frame with the same world: the scene graph is the same object by object', async () => {
      const { scene, update } = build();
      const sim = await pushedSim();
      stepN(sim, 10);
      update(sim.world, 0);
      const all = (): Object3D[] => {
        const found: Object3D[] = [];
        scene.traverse((node) => found.push(node));
        return found;
      };
      const before = all();
      for (let frame = 0; frame < 20; frame++) update(sim.world, frame / 20);
      const after = all();
      expect(after).toHaveLength(before.length);
      expect(after.every((node, index) => node === before[index])).toBe(true);
    });

    it('squashes a broken prop', () => {
      const { scene, update } = build();
      const world = fakeWorldAt(0);
      const mug = world.props[0] as World['props'][number];
      update(world, 1);
      expect(propBody(scene).scale.y).toBe(1);
      mug.isBroken = true;
      update(world, 1);
      expect(propBody(scene).scale.y).toBeLessThan(1);
      mug.isBroken = false;
    });

    it('warns and draws a plain box for a kind the model has no node for', () => {
      const seen = log.buffer().length;
      const geometry = createTestLevelGeometry('test_room');
      geometry.props.push({
        id: 'vase_01',
        kind: 'vase',
        centerM: [1, 0.15, 0],
        halfExtentsM: [0.08, 0.15, 0.08],
      });
      const { scene } = createLevelScene(
        { id: 'test_room', geometry, model: buildModel() },
        BODIES,
      );
      expect(scene.getObjectByName('prop_vase')).toBeDefined();
      const warnings = log
        .buffer()
        .slice(seen)
        .filter((entry) => entry.level === 'warn');
      expect(warnings.map((entry) => entry.message)).toContainEqual(
        expect.stringContaining('PROP_vase_nn'),
      );
    });

    it('frees the geometry of its templates on dispose', () => {
      const geometry = createTestLevelGeometry('test_room');
      const model = buildModel();
      const template = model.getObjectByName('PROP_mug_01') as Mesh;
      let freed = 0;
      template.geometry.addEventListener('dispose', () => freed++);
      const built = createLevelScene({ id: 'test_room', geometry, model }, BODIES);
      expect(freed).toBe(0);
      built.dispose();
      expect(freed).toBeGreaterThan(0);
    });
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
    const found = names(createLevelScene({ id: 'test_room', geometry, model }, BODIES).scene);
    for (const gone of ['COL_Sofa', 'nav_block_x', 'ZONE_nowhere']) {
      expect(found).not.toContain(gone);
    }
    expect(found).toContain('Sofa_Cube');
    expect(found).toContain('collar');
  });

  it('gives every model mesh, Papa and the baby, a shared toon material of its own colour', () => {
    const { scene } = build();
    const floor = scene.getObjectByName('floor') as Mesh;
    const wall = scene.getObjectByName('wall_back') as Mesh;
    const sofa = scene.getObjectByName('sofa') as Mesh;
    expect(floor.material).toBeInstanceOf(MeshToonMaterial);
    expect(floor.material).toBe(wall.material); // same colour, one material
    expect(sofa.material).not.toBe(floor.material);
    expect((sofa.material as MeshToonMaterial).color.getHex()).toBe(new Color(0x6d3fe0).getHex());
    expect((scene.getObjectByName('papa') as Mesh).material).toBeInstanceOf(MeshToonMaterial);
    expect((scene.getObjectByName('baby') as Mesh).material).toBeInstanceOf(MeshToonMaterial);
    expect((scene.getObjectByName('baby_gaze') as Mesh).material).toBeInstanceOf(MeshToonMaterial);
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

  it('has no probe cube any more', () => {
    expect(names(build().scene)).not.toContain('probe');
  });

  it('moves Papa and the baby with the sim, interpolated, and nothing else', async () => {
    const { scene, update } = build();
    const group = scene.getObjectByName('papa_group');
    const floor = scene.getObjectByName('floor');
    const floorBefore = floor?.position.toArray();
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    const spawn = [sim.world.papa.xM, sim.world.papa.zM];
    update(sim.world, 0);
    expect([group?.position.x, group?.position.z]).toEqual(spawn);

    sim.enqueue({ type: 'Move', t: asSimMs(0), dirX: -1, dirZ: 0 });
    stepN(sim, 5);
    const { prevXM, xM } = sim.world.papa;
    expect(xM).toBeLessThan(prevXM);
    update(sim.world, 0);
    expect(group?.position.x).toBe(prevXM);
    update(sim.world, 0.5);
    expect(group?.position.x).toBeCloseTo((prevXM + xM) / 2, 12);
    update(sim.world, 1);
    expect(group?.position.x).toBe(xM);
    expect(floor?.position.toArray()).toEqual(floorBefore);
  });

  it('draws the baby where the sim has it, interpolated, looking where it crawls', async () => {
    const { scene, update } = build();
    const group = scene.getObjectByName('baby_group');
    const gazeGroup = scene.getObjectByName('baby_gaze_group');
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    const { xM, zM } = sim.world.baby;
    update(sim.world, 0);
    expect([group?.position.x, group?.position.z]).toEqual([xM, zM]);
    // Until it sets off at 1.5 s and has crawled a few steps.
    for (let i = 0; i < 200 && sim.world.baby.state !== 'wander'; i++) sim.step();
    stepN(sim, 5);
    const baby = sim.world.baby;
    expect(baby.state).toBe('wander');
    expect([baby.prevXM, baby.prevZM]).not.toEqual([baby.xM, baby.zM]);
    update(sim.world, 0.5);
    expect(group?.position.x).toBeCloseTo((baby.prevXM + baby.xM) / 2, 12);
    expect(group?.position.z).toBeCloseTo((baby.prevZM + baby.zM) / 2, 12);
    expect(gazeGroup?.rotation.y).toBeCloseTo(Math.atan2(baby.gazeX, baby.gazeZ), 12);
  });

  it('has effects, hidden at rest: no sound wave is visible and nothing is offset', () => {
    const { scene, fx, update } = build();
    expect(typeof fx.soundWave).toBe('function');
    expect(typeof fx.shake).toBe('function');
    expect(typeof fx.gag).toBe('function');
    expect(typeof fx.liftBaby).toBe('function');
    const sim = fakeWorldAt(5000);
    update(sim, 0);
    const waves = scene.getObjectsByProperty('name', 'sound_wave');
    expect(waves.length).toBeGreaterThan(0);
    expect(waves.every((wave) => !wave.visible)).toBe(true);
    expect(scene.getObjectByName('content_root')?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('runs a wave started at t on the interpolated sim clock: it grows with sim time and ends after durationMs', () => {
    const { scene, fx, update } = build();
    const wave = () => scene.getObjectsByProperty('name', 'sound_wave')[0] as Mesh;
    fx.soundWave(1, 2, 0.6, 350, asSimMs(1000));
    update(fakeWorldAt(900), 0);
    expect(wave().visible).toBe(false);
    update(fakeWorldAt(1100), 0);
    expect(wave().visible).toBe(true);
    const early = wave().scale.x;
    // alpha counts: the clock is the sim time plus alpha of a step.
    update(fakeWorldAt(1100), 0.5);
    expect(wave().scale.x).toBeGreaterThan(early);
    update(fakeWorldAt(1200), 0);
    expect(wave().scale.x).toBeGreaterThan(early);
    update(fakeWorldAt(1350), 0);
    expect(wave().visible).toBe(false);
  });

  it('draws the effects from the sim clock alone, so a clock that stands still (pause) draws one picture', () => {
    const { scene, fx, update } = build();
    fx.soundWave(0, 0, 1, 1000, asSimMs(0));
    fx.shake(0.1, 1000, asSimMs(0));
    update(fakeWorldAt(300), 0);
    const wave = scene.getObjectsByProperty('name', 'sound_wave')[0] as Mesh;
    const root = scene.getObjectByName('content_root');
    const frozen = [wave.scale.x, root?.position.x, root?.position.z];
    for (let frame = 0; frame < 5; frame++) update(fakeWorldAt(300), 0);
    expect([wave.scale.x, root?.position.x, root?.position.z]).toEqual(frozen);
    // And it moves only when the clock does.
    update(fakeWorldAt(400), 0);
    expect(wave.scale.x).toBeGreaterThan(frozen[0] as number);
  });

  describe('the gag and the lift', () => {
    const lights = (scene: { children: Object3D[] }) =>
      scene.children.filter(
        (child) => 'isAmbientLight' in child || 'isDirectionalLight' in child,
      ) as unknown as { intensity: number }[];

    it('puts the lights out and back on the sim clock, and raises Papa hair meanwhile', () => {
      const { scene, fx, update } = build();
      const base = lights(scene).map((light) => light.intensity);
      const hair = scene.getObjectByName('papa_hair') as Object3D;
      expect(hair.visible).toBe(false);
      fx.gag('outlet_hair', asSimMs(1000));
      update(fakeWorldAt(1000 + GAG_LIGHTS_FADE_MS + GAG_LIGHTS_DARK_MS / 2), 0);
      lights(scene).forEach((light, i) => {
        expect(light.intensity).toBeCloseTo((base[i] as number) * (GAG_LIGHTS_MIN_PCT / 100), 6);
      });
      expect(hair.visible).toBe(true);
      update(fakeWorldAt(1000 + 5000), 0);
      expect(lights(scene).map((light) => light.intensity)).toEqual(base);
      expect(hair.visible).toBe(false);
    });

    it('hops the baby on the sim clock and puts it back on the floor', () => {
      const { scene, fx, update } = build();
      const body = scene.getObjectByName('baby') as Mesh;
      const floorY = body.position.y;
      fx.liftBaby(asSimMs(2000));
      update(fakeWorldAt(2000 + LIFT_MS / 2), 0);
      expect(body.position.y).toBeCloseTo(floorY + LIFT_HEIGHT_M, 6);
      update(fakeWorldAt(2000 + LIFT_MS), 0);
      expect(body.position.y).toBe(floorY);
    });

    it('resetFx brings the lights, the hair and the baby back at once', () => {
      const { scene, fx, update, resetFx } = build();
      const base = lights(scene).map((light) => light.intensity);
      fx.gag('outlet_hair', asSimMs(0));
      fx.liftBaby(asSimMs(0));
      update(fakeWorldAt(GAG_LIGHTS_FADE_MS + 10), 0);
      resetFx();
      expect(lights(scene).map((light) => light.intensity)).toEqual(base);
      expect((scene.getObjectByName('papa_hair') as Object3D).visible).toBe(false);
      const body = scene.getObjectByName('baby') as Mesh;
      expect(body.position.y).toBe(BODIES.babyRadiusM);
    });
  });

  it('resetFx ends the rings and the shake under way', () => {
    const { scene, fx, update, resetFx } = build();
    fx.soundWave(0, 0, 1, 1000, asSimMs(0));
    fx.shake(0.1, 1000, asSimMs(0));
    update(fakeWorldAt(300), 0);
    const root = scene.getObjectByName('content_root');
    expect([root?.position.x, root?.position.z]).not.toEqual([0, 0]);
    resetFx();
    expect(root?.position.toArray()).toEqual([0, 0, 0]);
    expect(scene.getObjectsByProperty('name', 'sound_wave').every((wave) => !wave.visible)).toBe(
      true,
    );
  });

  it('shakes the content root, not the lights, and is back to exactly zero after', () => {
    const { scene, fx, update } = build();
    const root = scene.getObjectByName('content_root');
    const light = scene.children.find((child) => 'isDirectionalLight' in child);
    const lightAt = light?.position.toArray();
    fx.shake(0.1, 400, asSimMs(1000));
    update(fakeWorldAt(1000), 0);
    expect(root?.position.toArray()).toEqual([0, 0, 0]);
    update(fakeWorldAt(1100), 0);
    expect([root?.position.x, root?.position.z]).not.toEqual([0, 0]);
    expect(light?.position.toArray()).toEqual(lightAt);
    update(fakeWorldAt(1400), 0);
    expect(root?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('frees the ring geometry and its materials on dispose', () => {
    const { scene, dispose } = build();
    const waves = scene.getObjectsByProperty('name', 'sound_wave') as Mesh[];
    let geometries = 0;
    let materials = 0;
    waves[0]?.geometry.addEventListener('dispose', () => geometries++);
    for (const wave of waves) {
      (wave.material as MeshBasicMaterial).addEventListener('dispose', () => materials++);
    }
    dispose();
    expect(geometries).toBe(1);
    expect(materials).toBe(waves.length);
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
