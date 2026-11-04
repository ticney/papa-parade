import { STEP_MS } from '@shared/constants';
import { log } from '@shared/log';
import { asRealMs, asSimMs, type RealMs } from '@shared/time';
import { createSim, type SimEvent, type World } from '@sim';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  type MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  Object3D,
  type Skeleton,
  SkinnedMesh,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestCharacters } from '../../../tests/support/testCharacters.ts';
import {
  createTestContent,
  createTestFeedback,
  createTestGeometry,
  createTestLevel,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createTestLevelGeometry } from '../../../tests/support/testLevelGeometry.ts';
import {
  GAG_DOWNSTAIRS_DROP_M,
  GAG_LIGHTS_DARK_MS,
  GAG_LIGHTS_FADE_MS,
  GAG_LIGHTS_MIN_PCT,
  GAG_SLIDE_BACK_MS,
  GAG_SLIDE_M,
  GAG_SLIDE_OUT_MS,
} from './gags.ts';
import { createLevelScene, eyelidsAmountAt, roomOf, type SceneBodies } from './levelScene.ts';
import { LIFT_HEIGHT_M, LIFT_MS } from './vfx/liftHop.ts';

const BODIES = {
  papaRadiusM: 0.25,
  babyRadiusM: 0.2,
  microSleepDefId: null,
  layDownDefIds: [] as string[],
  anchorThreatDefIds: [] as string[],
  laidHeightM: 0.3,
  characters: {
    crossFadeMs: 100,
    turnRateDegPerSec: 720,
    squash: [
      { event: 'PapaBlocked', character: 'papa', amountPct: -20, durationMs: 200 },
      { event: 'BabyWoke', character: 'baby', amountPct: 20, durationMs: 200 },
    ],
    clipSpeeds: [],
  } as SceneBodies['characters'],
  door: { openMs: 700, openAngleDeg: 100, widthM: 0.9, heightM: 2, thicknessM: 0.05 },
  render: createTestFeedback().render,
  isMotionReduced: () => false,
};

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
  const level = createLevelScene(
    { id: 'test_room', geometry, model: buildModel(), characters: createTestCharacters() },
    BODIES,
  );
  return {
    geometry,
    ...level,
    // Most tests do not care about the real clock: it stays at 0 unless they pass one.
    update: (world: World, alpha: number, nowReal: RealMs = asRealMs(0)) =>
      level.update(world, alpha, nowReal),
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

// The world is shared by the tests of this file: a rush a test starts must not leak into the next one,
// also when one of its assertions fails.
afterEach(() => {
  effectsWorld.flow.finalRushAt = null;
});

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
      'baby_body',
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
        { id: 'test_room', geometry, model: buildModel(), characters: createTestCharacters() },
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
      // A second node of the same kind is taken out of the scene but is never a template, so no
      // pooled view shares its geometry: only the scene's explicit loop over the taken nodes frees it.
      const spare = mesh('PROP_mug_01', 0x8a80a8);
      model.add(spare);
      const template = model.getObjectByName('PROP_mug_01') as Mesh;
      expect(template).not.toBe(spare);
      let spareFreed = 0;
      let templateFreed = 0;
      spare.geometry.addEventListener('dispose', () => spareFreed++);
      template.geometry.addEventListener('dispose', () => templateFreed++);
      const built = createLevelScene(
        { id: 'test_room', geometry, model, characters: createTestCharacters() },
        BODIES,
      );
      expect(spareFreed + templateFreed).toBe(0);
      built.dispose();
      expect(spareFreed).toBeGreaterThan(0);
      expect(templateFreed).toBeGreaterThan(0);
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
    const found = names(
      createLevelScene(
        { id: 'test_room', geometry, model, characters: createTestCharacters() },
        BODIES,
      ).scene,
    );
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
    expect((scene.getObjectByName('papa_body') as Mesh).material).toBeInstanceOf(MeshToonMaterial);
    expect((scene.getObjectByName('baby_body') as Mesh).material).toBeInstanceOf(MeshToonMaterial);
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

  it("shows Papa's handset exactly while the world says he is on the phone (story 1.20)", () => {
    const { scene, update } = build();
    const handset = scene.getObjectByName('papa_handset');
    const mug = scene.getObjectByName('papa_mug');
    const world = fakeWorldAt(0);
    const state = world.papa.state;
    try {
      update(world, 0);
      expect(handset?.visible).toBe(false);
      world.papa.state = 'onPhone';
      update(world, 0);
      expect(handset?.visible).toBe(true);
      expect(mug?.visible).toBe(false);
      world.papa.state = 'drink';
      update(world, 0);
      expect(handset?.visible).toBe(false);
      expect(mug?.visible).toBe(true);
      world.papa.state = 'idle';
      update(world, 0);
      expect(handset?.visible).toBe(false);
    } finally {
      world.papa.state = state;
    }
  });

  it('draws the baby where the sim has it, interpolated, looking where it crawls', async () => {
    const { scene, update } = build();
    const group = scene.getObjectByName('baby_group');
    const body = scene.getObjectByName('baby');
    const head = scene.getObjectByName('baby')?.getObjectByName('head');
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
    // The body turns at its own pace; with the head on top, the gaze never waits.
    expect((body?.rotation.y ?? 0) + (head?.rotation.y ?? 0)).toBeCloseTo(
      Math.atan2(baby.gazeX, baby.gazeZ),
      12,
    );
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

  it('draws the rings from the sim clock alone, so a clock that stands still (pause) draws one picture', () => {
    const { scene, fx, update } = build();
    fx.soundWave(0, 0, 1, 1000, asSimMs(0));
    update(fakeWorldAt(300), 0);
    const wave = scene.getObjectsByProperty('name', 'sound_wave')[0] as Mesh;
    const frozen = wave.scale.x;
    for (let frame = 0; frame < 5; frame++) update(fakeWorldAt(300), 0);
    expect(wave.scale.x).toBe(frozen);
    // And it moves only when the clock does.
    update(fakeWorldAt(400), 0);
    expect(wave.scale.x).toBeGreaterThan(frozen);
  });

  it('shakes and bursts on the real clock: they move while the sim clock stands still (hitstop)', () => {
    const { scene, fx, update, realFxState } = build();
    const root = scene.getObjectByName('content_root');
    const world = fakeWorldAt(300);
    fx.shake(0.1, 200, 14, asRealMs(1000));
    fx.particles('spark', 6, 2, 300, 0.05, 1, 1, asRealMs(1000));
    update(world, 0, asRealMs(1020));
    const first = root?.position.x;
    expect(first).not.toBe(0);
    expect(realFxState().particlesAlive).toBe(6);
    // The sim clock has not moved (a hitstop frame): the shake still has.
    update(world, 0, asRealMs(1060));
    expect(root?.position.x).not.toBe(first);
    expect(realFxState().shakeOffsetXM).toBe(root?.position.x);
    // Over: back to exactly zero, no particle left.
    update(world, 0, asRealMs(1400));
    expect(root?.position.toArray()).toEqual([0, 0, 0]);
    expect(realFxState()).toEqual({
      shakeOffsetXM: 0,
      shakeOffsetZM: 0,
      particlesAlive: 0,
      babyLayDownPct: 0,
      papaClip: 'idle',
      babyClip: 'babble',
      papaMixerMs: 0,
      doorOpenDeg: 0,
      dangerTintsShown: 0,
      lightsFactor: 1,
      mischiefDecals: 0,
    });
  });

  it('puts the particles under the content root and frees them with the scene', () => {
    const { scene, fx, update, resetFx, realFxState } = build();
    expect(scene.getObjectByName('content_root')?.getObjectByName('particles')).toBeDefined();
    fx.particles('puff', 4, 1, 500, 0.1, 0, 0, asRealMs(0));
    update(fakeWorldAt(0), 0, asRealMs(10));
    expect(realFxState().particlesAlive).toBe(4);
    resetFx();
    expect(realFxState().particlesAlive).toBe(0);
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

    /** Runs `test` with the baby `downstairs` in the shared world, and puts him back after (also when it fails). */
    const withBabyState = (state: World['baby']['state'], test: () => void): void => {
      const before = effectsWorld.baby.state;
      effectsWorld.baby.state = state;
      try {
        test();
      } finally {
        effectsWorld.baby.state = before;
      }
    };

    it('puts the baby at the bottom of the stairs and keeps him there while the sim says downstairs, then brings him back (story 3.15)', () => {
      const { scene, fx, update } = build();
      const group = scene.getObjectByName('baby_group') as Object3D;
      const body = scene.getObjectByName('baby') as Mesh;
      update(fakeWorldAt(0), 0);
      const home = group.position.clone();
      const floorY = body.position.y;
      withBabyState('downstairs', () => {
        fx.gag('stairs_slide', asSimMs(1000), false, 1, 0);
        // Long after the slide out: still there, lower than the floor.
        update(fakeWorldAt(1000 + GAG_SLIDE_OUT_MS + 5000), 0);
        expect(group.position.x).toBeCloseTo(home.x + GAG_SLIDE_M, 6);
        expect(group.position.z).toBeCloseTo(home.z, 6);
        expect(body.position.y).toBeCloseTo(floorY - GAG_DOWNSTAIRS_DROP_M, 6);
      });
      // He climbed back (or was carried up): out of `downstairs`, he comes back.
      withBabyState('babble', () => {
        const leftAt = 1000 + GAG_SLIDE_OUT_MS + 5000;
        // The frame that sees him out of `downstairs` starts the way back; it is over BACK ms later.
        update(fakeWorldAt(leftAt + 10), 0);
        expect(group.position.x).toBeGreaterThan(home.x);
        update(fakeWorldAt(leftAt + 10 + GAG_SLIDE_BACK_MS), 0);
        expect(group.position.x).toBeCloseTo(home.x, 6);
        expect(body.position.y).toBeCloseTo(floorY, 6);
      });
    });

    it('shows the baby at the bottom of the stairs without the slide when motion is reduced', () => {
      const { scene, fx, update } = build();
      const group = scene.getObjectByName('baby_group') as Object3D;
      update(fakeWorldAt(0), 0);
      const home = group.position.clone();
      withBabyState('downstairs', () => {
        fx.gag('stairs_slide', asSimMs(1000), true, 1, 0);
        // The very next frame: no ease, he is already there.
        update(fakeWorldAt(1010), 0);
        expect(group.position.x).toBeCloseTo(home.x + GAG_SLIDE_M, 6);
      });
      withBabyState('babble', () => {
        update(fakeWorldAt(1020), 0);
        expect(group.position.x).toBeCloseTo(home.x, 6);
      });
    });

    it('puts a baby found downstairs with no gag seen at the bottom at once (a restored game)', () => {
      const { scene, update } = build();
      const group = scene.getObjectByName('baby_group') as Object3D;
      update(fakeWorldAt(0), 0);
      const home = group.position.clone();
      withBabyState('downstairs', () => {
        update(fakeWorldAt(50), 0);
        const movedM = Math.hypot(group.position.x - home.x, group.position.z - home.z);
        expect(movedM).toBeCloseTo(GAG_SLIDE_M, 6);
      });
      withBabyState('babble', () => update(fakeWorldAt(60), 0));
    });

    it('slides the baby in place: its position vector and the scene are the same objects every frame', () => {
      const { scene, fx, update } = build();
      const group = scene.getObjectByName('baby_group') as Object3D;
      update(fakeWorldAt(0), 0);
      const { position } = group;
      const children = [...scene.children];
      const babyChildren = [...group.children];
      withBabyState('downstairs', () => {
        fx.gag('stairs_slide', asSimMs(1000), false, 0.6, 0.8);
        for (let ms = 1000; ms <= 1000 + GAG_SLIDE_OUT_MS + 20; ms += 20) {
          update(fakeWorldAt(ms), 0);
          expect(group.position).toBe(position);
        }
      });
      withBabyState('babble', () => update(fakeWorldAt(3000), 0));
      expect(scene.children).toEqual(children);
      expect(group.children).toEqual(babyChildren);
    });

    it('draws the baby carried up in Papa arms like a carried baby, and not at the bottom of the stairs', () => {
      const { scene, update } = build();
      const body = scene.getObjectByName('baby') as Mesh;
      update(fakeWorldAt(0), 0);
      const floorY = body.position.y;
      withBabyState('carriedUp', () => {
        update(fakeWorldAt(100), 0);
        expect(body.position.y).toBeGreaterThan(floorY);
      });
      withBabyState('babble', () => update(fakeWorldAt(200), 0));
    });

    it('fades only the 3D lights to feel.fx.dim.lightsPct over fadeMs while the sim holds the pénombre, and back after (story 3.15)', () => {
      const { scene, update } = build();
      const base = lights(scene).map((light) => light.intensity);
      const { lightsPct, fadeMs } = effectsWorld.feel.fx.dim;
      const wasUntil = effectsWorld.afterEffects.dimUntil;
      try {
        effectsWorld.afterEffects.dimUntil = asSimMs(100_000);
        update(fakeWorldAt(0), 0);
        update(fakeWorldAt(fadeMs / 2), 0);
        const half = lights(scene).map((light) => light.intensity);
        half.forEach((value, i) => {
          expect(value).toBeLessThan(base[i] as number);
          expect(value).toBeGreaterThan((base[i] as number) * (lightsPct / 100));
        });
        update(fakeWorldAt(fadeMs * 4), 0);
        lights(scene).forEach((light, i) => {
          expect(light.intensity).toBeCloseTo((base[i] as number) * (lightsPct / 100), 6);
        });
        // The sim ended it (dimUntil back to 0): the light comes back over fadeMs.
        effectsWorld.afterEffects.dimUntil = asSimMs(0);
        update(fakeWorldAt(fadeMs * 4 + 10), 0);
        expect(lights(scene)[0]?.intensity).toBeGreaterThan(
          (base[0] as number) * (lightsPct / 100),
        );
        update(fakeWorldAt(fadeMs * 10), 0);
        expect(lights(scene).map((light) => light.intensity)).toEqual(base);
      } finally {
        effectsWorld.afterEffects.dimUntil = wasUntil;
      }
    });

    it('keeps the outlet flash and the pénombre together: the room is as dark as the darker of the two', () => {
      const { scene, fx, update } = build();
      const base = lights(scene).map((light) => light.intensity);
      const { lightsPct, fadeMs } = effectsWorld.feel.fx.dim;
      const wasUntil = effectsWorld.afterEffects.dimUntil;
      try {
        effectsWorld.afterEffects.dimUntil = asSimMs(100_000);
        update(fakeWorldAt(0), 0);
        update(fakeWorldAt(fadeMs * 4), 0);
        // The flash is darker than the pénombre (25 % < 40 %) while it lasts, and gives way after it.
        fx.gag('outlet_hair', asSimMs(fadeMs * 4));
        update(fakeWorldAt(fadeMs * 4 + GAG_LIGHTS_FADE_MS + GAG_LIGHTS_DARK_MS / 2), 0);
        expect(lights(scene)[0]?.intensity).toBeCloseTo(
          ((base[0] as number) * Math.min(GAG_LIGHTS_MIN_PCT, lightsPct)) / 100,
          6,
        );
        update(fakeWorldAt(fadeMs * 4 + 5000), 0);
        expect(lights(scene)[0]?.intensity).toBeCloseTo((base[0] as number) * (lightsPct / 100), 6);
      } finally {
        effectsWorld.afterEffects.dimUntil = wasUntil;
      }
    });

    it('raises Papa hair for as long as he is electrified', () => {
      const { scene, update } = build();
      const hair = scene.getObjectByName('papa_hair') as Object3D;
      const before = effectsWorld.papa.state;
      try {
        effectsWorld.papa.state = 'electrified';
        update(fakeWorldAt(0), 0);
        update(fakeWorldAt(5000), 0);
        expect(hair.visible).toBe(true);
        effectsWorld.papa.state = 'idle';
        update(fakeWorldAt(5010), 0);
        expect(hair.visible).toBe(false);
      } finally {
        effectsWorld.papa.state = before;
      }
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
      expect(body.position.y).toBe(0);
    });
  });

  it('resetFx ends the rings and the shake under way', () => {
    const { scene, fx, update, resetFx } = build();
    fx.soundWave(0, 0, 1, 1000, asSimMs(0));
    fx.shake(0.1, 1000, 14, asRealMs(0));
    update(fakeWorldAt(300), 0, asRealMs(300));
    const root = scene.getObjectByName('content_root');
    expect([root?.position.x, root?.position.z]).not.toEqual([0, 0]);
    resetFx();
    expect(root?.position.toArray()).toEqual([0, 0, 0]);
    expect(scene.getObjectsByProperty('name', 'sound_wave').every((wave) => !wave.visible)).toBe(
      true,
    );
  });

  it('stands a closed door panel in the room that swings open from the rush start on the sim clock (story 3.5)', () => {
    const { scene, update, realFxState } = build();
    const panels = scene.getObjectsByProperty('name', 'door_panel');
    expect(panels).toHaveLength(1);
    const world = fakeWorldAt(1000);
    world.flow.finalRushAt = null;
    update(world, 0);
    expect(realFxState().doorOpenDeg).toBe(0);
    const closedYaw = panels[0]?.rotation.y;
    // The rush starts at 2000: the door is part open at 2350, open from 2700 on, and stays open.
    world.flow.finalRushAt = asSimMs(2000);
    update(fakeWorldAt(1999), 0);
    expect(realFxState().doorOpenDeg).toBe(0);
    update(fakeWorldAt(2350), 0);
    expect(realFxState().doorOpenDeg).toBeGreaterThan(0);
    expect(realFxState().doorOpenDeg).toBeLessThan(BODIES.door.openAngleDeg);
    update(fakeWorldAt(2700), 0);
    expect(realFxState().doorOpenDeg).toBe(BODIES.door.openAngleDeg);
    update(fakeWorldAt(60_000), 0);
    expect(realFxState().doorOpenDeg).toBe(BODIES.door.openAngleDeg);
    expect(panels[0]?.rotation.y).not.toBeCloseTo(closedYaw ?? 0, 3);
  });

  it('holds the door while the sim clock stands still, and keeps it open through resetFx', () => {
    const { update, resetFx, realFxState } = build();
    const world = fakeWorldAt(2200);
    world.flow.finalRushAt = asSimMs(2000);
    update(world, 0);
    const half = realFxState().doorOpenDeg;
    update(world, 0, asRealMs(5000));
    expect(realFxState().doorOpenDeg).toBe(half);
    resetFx();
    expect(realFxState().doorOpenDeg).toBe(half);
  });

  it('jumps the door open under reduced motion', () => {
    const level = createLevelScene(
      {
        id: 'test_room',
        geometry: createTestLevelGeometry('test_room'),
        model: buildModel(),
        characters: createTestCharacters(),
      },
      { ...BODIES, isMotionReduced: () => true },
    );
    const world = fakeWorldAt(2000);
    world.flow.finalRushAt = asSimMs(2000);
    level.update(world, 0, asRealMs(0));
    expect(level.realFxState().doorOpenDeg).toBe(BODIES.door.openAngleDeg);
    level.dispose();
  });

  it('shakes the content root, not the lights, and is back to exactly zero after', () => {
    const { scene, fx, update } = build();
    const root = scene.getObjectByName('content_root');
    const light = scene.children.find((child) => 'isDirectionalLight' in child);
    const lightAt = light?.position.toArray();
    fx.shake(0.1, 400, 14, asRealMs(1000));
    update(fakeWorldAt(1000), 0, asRealMs(1000));
    expect(root?.position.toArray()).toEqual([0, 0, 0]);
    update(fakeWorldAt(1000), 0, asRealMs(1100));
    expect([root?.position.x, root?.position.z]).not.toEqual([0, 0]);
    expect(light?.position.toArray()).toEqual(lightAt);
    update(fakeWorldAt(1000), 0, asRealMs(1400));
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

describe('the final look (story 7.3)', () => {
  const rowOf = (ambientIntensity: number, sunIntensity: number) => ({
    ambientColor: '#C4CEFF',
    ambientIntensity,
    sunColor: '#DCE2FF',
    sunIntensity,
  });
  const lit = (ambient: number, sun: number) => {
    const geometry = createTestLevelGeometry('test_room');
    const level = createLevelScene(
      { id: 'test_room', geometry, model: buildModel(), characters: createTestCharacters() },
      {
        ...BODIES,
        render: {
          ...BODIES.render,
          lights: { ...BODIES.render.lights, byLevel: { test_room: rowOf(ambient, sun) } },
        },
      },
    );
    const lights = level.scene.children.filter(
      (child) => 'isAmbientLight' in child || 'isDirectionalLight' in child,
    ) as unknown as { intensity: number; color: Color }[];
    return { level, lights };
  };

  it('lights a level with its own row, and with the default row otherwise', () => {
    const { lights } = lit(0.7, 1.2);
    expect(lights.map((light) => light.intensity)).toEqual([0.7, 1.2]);
    expect(lights[0]?.color.getHexString()).toBe('c4ceff');
    const { scene } = build();
    const others = scene.children.filter(
      (child) => 'isAmbientLight' in child || 'isDirectionalLight' in child,
    ) as unknown as { intensity: number }[];
    expect(others.map((light) => light.intensity)).toEqual([1.1, 2.04]);
  });

  it("dims the level's own lights during the outlet gag, not the salon's", () => {
    const { level, lights } = lit(0.7, 1.2);
    level.fx.gag('outlet_hair', asSimMs(1000));
    level.update(fakeWorldAt(1000 + GAG_LIGHTS_FADE_MS + GAG_LIGHTS_DARK_MS / 2), 0, asRealMs(0));
    expect(lights[0]?.intensity).toBeCloseTo(0.7 * (GAG_LIGHTS_MIN_PCT / 100), 6);
    expect(lights[1]?.intensity).toBeCloseTo(1.2 * (GAG_LIGHTS_MIN_PCT / 100), 6);
  });

  it('gives Papa, the baby and a prop a hull, and the furniture none', () => {
    const { scene } = build();
    const hulls: string[] = [];
    scene.traverse((node) => {
      if (node.name.startsWith('outline_')) hulls.push(node.parent?.name ?? '');
    });
    expect(hulls.length).toBeGreaterThan(0);
    expect(hulls).toContain('papa_body');
    expect(hulls).toContain('baby_body');
    const sofa = scene.getObjectByName('sofa') as Mesh;
    expect(sofa.children).toHaveLength(0);
    const prop = scene.getObjectByName('prop_mug') as Object3D;
    expect(prop.getObjectByProperty('name', 'outline_PROP_mug_01')).toBeDefined();
  });

  it('gives each hull the depth test, so that nothing shows through a wall (AC 3)', () => {
    const { scene } = build();
    let count = 0;
    scene.traverse((node) => {
      if (node instanceof Mesh && node.name.startsWith('outline_')) {
        const material = node.material as {
          depthTest: boolean;
          depthWrite: boolean;
          transparent: boolean;
        };
        expect(material.depthTest).toBe(true);
        expect(material.depthWrite).toBe(true);
        expect(material.transparent).toBe(false);
        count++;
      }
    });
    expect(count).toBeGreaterThan(0);
  });

  // The kit's own `dispose` (both materials) is pinned in `outlineHull.test.ts`; here the scene's
  // disposal reaches the hulls' materials too, so a hull is found first and freed with the scene.
  it('frees the hull materials with the scene', () => {
    const { scene, dispose } = build();
    const materials = new Set<MeshBasicMaterial>();
    scene.traverse((node) => {
      if (node instanceof Mesh && node.name.startsWith('outline_')) {
        materials.add(node.material as unknown as MeshBasicMaterial);
      }
    });
    expect(materials.size).toBeGreaterThan(0);
    const freed = new Set<MeshBasicMaterial>();
    for (const material of materials)
      material.addEventListener('dispose', () => freed.add(material));
    dispose();
    expect(freed).toEqual(materials);
  });
});

describe('the characters on the sim clock (story 7.2)', () => {
  const blocked = (t: number): SimEvent => ({ type: 'PapaBlocked', t: asSimMs(t), xM: 0, zM: 0 });

  it('advances the mixers by the sim clock alone: a clock that stands still holds them, whatever the real clock', () => {
    const { update, realFxState } = build();
    update(fakeWorldAt(1000), 0, asRealMs(0));
    expect(realFxState().papaMixerMs).toBe(0);
    update(fakeWorldAt(1100), 0, asRealMs(16));
    expect(realFxState().papaMixerMs).toBeCloseTo(100, 6);
    // A hitstop or a pause: frames keep coming, the real clock runs, the sim's does not.
    for (let frame = 0; frame < 5; frame++) update(fakeWorldAt(1100), 0, asRealMs(100 * frame));
    expect(realFxState().papaMixerMs).toBeCloseTo(100, 6);
    // A slow-mo is a sim clock that advances less per frame.
    update(fakeWorldAt(1110), 0, asRealMs(600));
    expect(realFxState().papaMixerMs).toBeCloseTo(110, 6);
  });

  it('counts alpha, and never runs a clip backwards when alpha steps back', () => {
    const { update, realFxState } = build();
    update(fakeWorldAt(1000), 0.5);
    update(fakeWorldAt(1000), 0.9);
    const at = realFxState().papaMixerMs;
    expect(at).toBeCloseTo(0.4 * STEP_MS, 6);
    update(fakeWorldAt(1000), 0.1);
    expect(realFxState().papaMixerMs).toBe(at);
  });

  it('starts over after a reset: clips and clock', () => {
    const { update, resetFx, realFxState, fx } = build();
    update(fakeWorldAt(1000), 0);
    update(fakeWorldAt(1500), 0);
    fx.playCharacterEvent(blocked(1500), fakeWorldAt(1500), false);
    resetFx();
    expect(realFxState().papaClip).toBeNull();
    expect(realFxState().papaMixerMs).toBe(0);
    update(fakeWorldAt(9000), 0);
    expect(realFxState().papaClip).toBe('idle');
    expect(realFxState().papaMixerMs).toBe(0);
  });

  it("plays a one-shot from an event, then the state's loop", () => {
    const { update, realFxState, fx } = build();
    update(fakeWorldAt(1000), 0);
    fx.playCharacterEvent(blocked(1000), fakeWorldAt(1000), false);
    update(fakeWorldAt(1010), 0);
    expect(realFxState().papaClip).toBe('stumble');
    update(fakeWorldAt(3000), 0);
    expect(realFxState().papaClip).toBe('idle');
  });

  it('plays the response clip it is told, and none for a Do Nothing', () => {
    const { update, realFxState, fx } = build();
    update(fakeWorldAt(1000), 0);
    fx.playResponseClip('nothing', 'success');
    expect(realFxState().papaClip).toBe('idle');
    fx.playResponseClip('parry', 'perfect');
    expect(realFxState().papaClip).toBe('respond_perfect');
  });

  it('squashes on the sim clock from the data, and is back to exactly 1', () => {
    const { scene, update, fx } = build();
    const body = scene.getObjectByName('papa') as Object3D;
    update(fakeWorldAt(1000), 0);
    fx.playCharacterEvent(blocked(1000), fakeWorldAt(1000), false);
    update(fakeWorldAt(1040), 0);
    expect(body.scale.y).toBeLessThan(1);
    expect(body.scale.x).toBeGreaterThan(1);
    const held = body.scale.y;
    update(fakeWorldAt(1040), 0);
    expect(body.scale.y).toBe(held);
    update(fakeWorldAt(1200), 0);
    expect(body.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('keeps the squash at rest and the clip under reduced motion', () => {
    const { scene, update, fx, realFxState } = build();
    const body = scene.getObjectByName('papa') as Object3D;
    update(fakeWorldAt(1000), 0);
    fx.playCharacterEvent(blocked(1000), fakeWorldAt(1000), true);
    update(fakeWorldAt(1040), 0);
    expect(body.scale.toArray()).toEqual([1, 1, 1]);
    expect(realFxState().papaClip).toBe('stumble');
  });

  it("never stops a glide for a gag: his loop goes on, the baby's clip plays", () => {
    const { update, realFxState, fx } = build();
    const world = fakeWorldAt(1000);
    const state = world.papa.state;
    const gag: SimEvent = {
      type: 'GagTriggered',
      t: asSimMs(1000),
      threatId: 1,
      gag: 'table_object_fall',
      reason: 'late',
    };
    try {
      world.papa.state = 'glide';
      update(world, 0);
      fx.playCharacterEvent(gag, world, false);
      expect(realFxState().papaClip).toBe('glide');
      expect(realFxState().babyClip).toBe('laugh');
    } finally {
      world.papa.state = state;
    }
  });

  it("moves the baby's lids on what the player is told: the feint, the signal, the gag", () => {
    const { scene, update, fx } = build();
    const lids = scene.getObjectByName('baby')?.getObjectByName('eyelids') as Object3D;
    const world = fakeWorldAt(1000);
    update(world, 0);
    const open = lids.scale.y;
    fx.playCharacterEvent({ type: 'WaitFeintGiven', t: asSimMs(1000), threatId: 1 }, world, false);
    expect(lids.scale.y).toBe(0.5);
    fx.playCharacterEvent({ type: 'WaitSignalGiven', t: asSimMs(1000), threatId: 1 }, world, false);
    expect(lids.scale.y).toBe(1);
    fx.playCharacterEvent(
      { type: 'GagTriggered', t: asSimMs(1000), threatId: 1, gag: 'baby_sat_up', reason: 'early' },
      world,
      false,
    );
    expect(lids.scale.y).toBe(open);
  });

  it('shows the look through the scene', () => {
    const { scene, setPapaLook } = build();
    setPapaLook({ hasMashOnCheek: true, hasHairOnEnd: false, isShirtInsideOut: false });
    expect(scene.getObjectByName('papa_look_mash')?.visible).toBe(true);
  });

  it("frees each skeleton on dispose: the bone texture is not a mesh's", () => {
    const { scene, dispose } = build();
    const skeletons: Skeleton[] = [];
    scene.traverse((node) => {
      if (node instanceof SkinnedMesh) skeletons.push(node.skeleton);
    });
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
    const spies = skeletons.map((skeleton) => vi.spyOn(skeleton, 'dispose'));
    dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

describe('eyelidsAmountAt (story 1.19)', () => {
  const MICRO = 'papa_microsleep';
  const micro = (state: string, enteredAt = 1000, windowOpenAt = 2200, defId = MICRO) =>
    ({ state, enteredAt, windowOpenAt, anchorId: 'papa', defId }) as never;
  const worldOf = (...threats: unknown[]) => ({ threats }) as never;

  it('lowers with the progress of the telegraph, from its entry to the opening of the window', () => {
    expect(eyelidsAmountAt(worldOf(micro('telegraph')), 1000, MICRO)).toBe(0);
    expect(eyelidsAmountAt(worldOf(micro('telegraph')), 1600, MICRO)).toBeCloseTo(0.5, 12);
    expect(eyelidsAmountAt(worldOf(micro('telegraph')), 2200, MICRO)).toBe(1);
    expect(eyelidsAmountAt(worldOf(micro('telegraph')), 9999, MICRO)).toBe(1);
    expect(eyelidsAmountAt(worldOf(micro('telegraph')), 0, MICRO)).toBe(0);
  });

  it('stays shut while the window is open, and open in any other state', () => {
    expect(eyelidsAmountAt(worldOf(micro('windowOpen')), 3000, MICRO)).toBe(1);
    for (const state of ['idle', 'resolved', 'gag']) {
      expect(eyelidsAmountAt(worldOf(micro(state)), 3000, MICRO), state).toBe(0);
    }
  });

  it('ignores the threats that stand on an anchor, and a level with no micro-sleep', () => {
    const outlet = {
      state: 'windowOpen',
      enteredAt: 0,
      windowOpenAt: 1,
      anchorId: 'outlet_01',
      defId: 'outlet',
    };
    expect(eyelidsAmountAt(worldOf(outlet), 5, MICRO)).toBe(0);
    expect(eyelidsAmountAt(worldOf(), 5, MICRO)).toBe(0);
    expect(eyelidsAmountAt(worldOf(micro('windowOpen')), 3000, null)).toBe(0);
  });

  it('does not read the telegraph of another threat on Papa (the duel’s signal time, story 4.6)', () => {
    // Two worlds whose duel threat signals at 2200 vs 6000: Papa's eyelids are the same (open).
    const duelSoon = micro('telegraph', 1000, 2200, 'bedtime_eyes');
    const duelLate = micro('telegraph', 1000, 6000, 'bedtime_eyes');
    expect(eyelidsAmountAt(worldOf(duelSoon), 1600, MICRO)).toBe(0);
    expect(eyelidsAmountAt(worldOf(duelLate), 1600, MICRO)).toBe(0);
    // The micro-sleep after it in the list is still found.
    const sleepy = micro('telegraph', 1000, 2200);
    expect(eyelidsAmountAt(worldOf(duelLate, sleepy), 1600, MICRO)).toBeCloseTo(0.5, 12);
  });
});
