import { asSimMs } from '@shared/time';
import type { BabySlice, PapaSlice } from '@sim';
import { type Mesh, type Object3D, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  browEndsInHead,
  createTestBaby,
  createTestLife,
  TEST_BABY_BROW_REST_M,
} from '../../../../tests/support/testCharacters.ts';
import { createBlobKit } from '../blobShadow.ts';
import { createOutlineKit } from '../materials/outlineHull.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { BABY_IDLE_SALT } from './babyActing.ts';
import {
  BABY_CARRIED_HEIGHT_M,
  BABY_LIFE_BONES,
  type BabyPose,
  babyPoseAt,
  createBabyView,
} from './babyView.ts';
import { createCharacterRig } from './characterRig.ts';
import { BABY_EXPRESSIONS, type BabyFace } from './expressions.ts';
import type { LifeInputs } from './lifeLayer.ts';
import { createIdleSlot, idleSlotAt } from './papaActing.ts';

const TOON_TONES = [96, 178, 255];

function baby(patch: Partial<BabySlice> = {}): BabySlice {
  return {
    state: 'wander',
    enteredAt: asSimMs(0),
    xM: 2,
    zM: 1,
    prevXM: 1,
    prevZM: 1,
    headingX: 0,
    headingZ: 1,
    gazeX: 0,
    gazeZ: 1,
    path: [],
    pathIndex: 0,
    wanderAt: asSimMs(0),
    babbling: true,
    targetThreatId: null,
    approachSpeedMps: 0,
    cryStartedAt: null,
    cryEndsAt: null,
    downstairsUntil: null,
    ...patch,
  };
}

describe('babyPoseAt', () => {
  it('interpolates the position between the last two steps', () => {
    const pose: BabyPose = { xM: 0, zM: 0, yawRad: 0 };
    babyPoseAt(baby(), 0, pose);
    expect([pose.xM, pose.zM]).toEqual([1, 1]);
    babyPoseAt(baby(), 0.5, pose);
    expect([pose.xM, pose.zM]).toEqual([1.5, 1]);
    babyPoseAt(baby(), 1, pose);
    expect([pose.xM, pose.zM]).toEqual([2, 1]);
  });

  it('turns the unit gaze into an angle: +z is 0, +x is a quarter turn, -x minus a quarter turn', () => {
    const pose: BabyPose = { xM: 0, zM: 0, yawRad: 9 };
    babyPoseAt(baby({ gazeX: 0, gazeZ: 1 }), 0, pose);
    expect(pose.yawRad).toBe(0);
    babyPoseAt(baby({ gazeX: 1, gazeZ: 0 }), 0, pose);
    expect(pose.yawRad).toBeCloseTo(Math.PI / 2, 12);
    babyPoseAt(baby({ gazeX: -1, gazeZ: 0 }), 0, pose);
    expect(pose.yawRad).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('follows the gaze, not the heading', () => {
    const pose: BabyPose = { xM: 0, zM: 0, yawRad: 0 };
    babyPoseAt(baby({ headingX: 1, headingZ: 0, gazeX: 0, gazeZ: 1 }), 0, pose);
    expect(pose.yawRad).toBe(0);
  });
});

describe('createBabyView', () => {
  const MOTION = { clips: [{ clip: 'crawl', speedMps: 0.6 }] };
  const LIFE = createTestLife();

  function build(radiusM = 0.2) {
    const scene = new Scene();
    const toon = createToonMaterialCache(TOON_TONES);
    const rig = createCharacterRig(
      createTestBaby(),
      toon,
      createOutlineKit({ widthM: 0.025, skipMaterials: ['art_ink'] }),
      BABY_LIFE_BONES,
    );
    const view = createBabyView(scene, createBlobKit(), radiusM, rig, MOTION);
    return { scene, toon, rig, view };
  }

  describe('his brows (story 7.10)', () => {
    const [RX, RY, RZ] = TEST_BABY_BROW_REST_M;
    const named = (scene: Scene, name: string) => scene.getObjectByName(name) as Object3D;
    const drive = (
      view: ReturnType<typeof build>['view'],
      expression: BabyFace,
      frames: number,
      dtMs: number,
      life = createTestLife({ fatigue: 80, isAlert: true, isResponding: true, babyXM: 1 }),
    ) => {
      life.babyExpression = expression;
      for (let i = 0; i < frames; i++) {
        const crawling = baby({ gazeX: Math.sin(i / 7), gazeZ: Math.cos(i / 7) });
        view.update(crawling, 1);
        view.animate(crawling, dtMs, life);
      }
      return life;
    };
    const snapshot = (scene: Scene) =>
      ['brow_l', 'brow_r'].flatMap((name) => [
        ...named(scene, name).position.toArray(),
        ...named(scene, name).quaternion.toArray(),
        ...named(scene, name).scale.toArray(),
      ]);

    it('at neutral, both brows sit at their rest, at browScalePct', () => {
      const { scene, view } = build();
      const life = drive(view, 'neutral', 30, 16);
      const scale = life.characters.expressions.baby.browScalePct / 100;
      expect(named(scene, 'brow_l').position.toArray()).toEqual([RX, RY, RZ]);
      expect(named(scene, 'brow_r').position.toArray()).toEqual([-RX, RY, RZ]);
      for (const name of ['brow_l', 'brow_r']) {
        expect(named(scene, name).quaternion.toArray(), name).toEqual([0, 0, 0, 1]);
        expect(named(scene, name).scale.toArray(), name).toEqual([scale, scale, scale]);
      }
    });

    it.each(BABY_EXPRESSIONS)('%s brings both brows to their rest plus its pose', (expression) => {
      const { scene, view } = build();
      const life = drive(view, expression, 100, 10);
      const pose = life.characters.expressions.baby.poses[expression];
      const left = named(scene, 'brow_l').position;
      const right = named(scene, 'brow_r').position;
      expect(left.x).toBeCloseTo(RX - pose.inwardOffsetM, 9);
      expect(left.y).toBeCloseTo(RY + pose.raiseOffsetM + pose.skewOffsetM, 9);
      expect(right.x).toBeCloseTo(-RX + pose.inwardOffsetM, 9);
      expect(right.y).toBeCloseTo(RY + pose.raiseOffsetM - pose.skewOffsetM, 9);
      expect(view.browTiltDeg).toBeCloseTo(pose.tiltDeg, 6);
    });

    it("pins the signs of D2 on world points of each brow's two ends", () => {
      const { scene, view } = build();
      const life = createTestLife();
      const poses = life.characters.expressions.baby.poses;
      const read = (pose: typeof poses.sulky) => {
        poses.sulky = pose;
        drive(view, 'sulky', 100, 10, life);
        scene.updateMatrixWorld(true);
        const head = named(scene, 'head');
        return {
          l: browEndsInHead(head, named(scene, 'brow_l'), 0.033),
          r: browEndsInHead(head, named(scene, 'brow_r'), 0.033),
        };
      };
      const zero = { raiseOffsetM: 0, tiltDeg: 0, inwardOffsetM: 0, skewOffsetM: 0 };
      const tilted = read({ ...zero, tiltDeg: 20 });
      for (const side of [tilted.l, tilted.r]) {
        expect(side.inner.y).toBeGreaterThan(side.outer.y + 0.01);
      }
      const frown = read({ ...zero, tiltDeg: -20 });
      for (const side of [frown.l, frown.r]) expect(side.inner.y).toBeLessThan(side.outer.y - 0.01);
      const knot = read({ ...zero, inwardOffsetM: 0.01 });
      expect(knot.l.centre.x).toBeCloseTo(RX - 0.01, 9);
      expect(knot.r.centre.x).toBeCloseTo(-RX + 0.01, 9);
      const cocked = read({ ...zero, skewOffsetM: 0.01 });
      expect(cocked.l.centre.x).toBeGreaterThan(0);
      expect(cocked.l.centre.y).toBeCloseTo(RY + 0.01, 9);
      expect(cocked.r.centre.y).toBeCloseTo(RY - 0.01, 9);
    });

    it("no expression writes his lids: they stay the duel signals' (D1)", () => {
      for (const expression of BABY_EXPRESSIONS) {
        const { scene, view } = build();
        view.setEyelids(0.5);
        drive(view, expression, 60, 16);
        expect(named(scene, 'eyelids').scale.y, expression).toBe(0.5);
      }
    });

    it('gives the same pose under reduced motion', () => {
      const a = build();
      const b = build();
      drive(a.view, 'sleepy', 40, 16);
      drive(b.view, 'sleepy', 40, 16, createTestLife({ isMotionReduced: true }));
      expect(snapshot(b.scene)).toEqual(snapshot(a.scene));
    });

    it('resetAnimation puts them at rest at once; the next frame snaps', () => {
      const { scene, view } = build();
      drive(view, 'delighted', 1, 16);
      const poses = createTestLife().characters.expressions.baby.poses;
      expect(view.browTiltDeg).toBe(poses.delighted.tiltDeg);
      view.resetAnimation();
      expect(view.browTiltDeg).toBe(0);
      expect(named(scene, 'brow_r').position.toArray()).toEqual([-RX, RY, RZ]);
      drive(view, 'sulky', 1, 16);
      expect(view.browTiltDeg).toBe(poses.sulky.tiltDeg);
    });

    it('gives the same brows for 1, 3 or 7 frames over the same span', () => {
      const run = (frames: number) => {
        const { scene, view } = build();
        drive(view, 'neutral', 1, 16);
        const life = createTestLife({ babyExpression: 'focused' });
        for (let i = 0; i < frames; i++) {
          view.update(baby(), 1);
          view.animate(baby(), 63 / frames, life);
        }
        return snapshot(scene);
      };
      const one = run(1);
      for (const frames of [3, 7]) {
        for (const [i, value] of run(frames).entries()) {
          expect(value).toBeCloseTo(one[i] as number, 9);
        }
      }
    });
  });

  it('draws the rig and a flat shadow, never culling his skinned mesh', () => {
    const { scene } = build(0.2);
    expect(scene.getObjectByName('baby_body')?.frustumCulled).toBe(false);
    expect(scene.getObjectByName('blob_baby')).toBeDefined();
  });

  it('rests on the floor at the interpolated position: his feet at y = 0', () => {
    const { scene, view } = build(0.2);
    view.update(baby(), 0.5);
    const group = scene.getObjectByName('baby_group');
    const body = scene.getObjectByName('baby') as Mesh;
    expect(group?.position.toArray()).toEqual([1.5, 0, 1]);
    expect(body.position.y).toBe(0);
  });

  it('turns the head to the gaze at once, and the body on its spring; the shadow keeps its orientation', () => {
    const { scene, view } = build();
    view.update(baby({ gazeX: 0, gazeZ: 1 }), 1);
    const looking = baby({ gazeX: 1, gazeZ: 0 });
    view.update(looking, 1);
    const body = scene.getObjectByName('baby') as Mesh;
    const head = scene.getObjectByName('head') as Mesh;
    view.animate(looking, 120, LIFE);
    expect(body.rotation.y).toBeGreaterThan(0.1);
    expect(body.rotation.y).toBeLessThan(Math.PI / 2);
    expect(view.bodyYawRad).toBe(body.rotation.y);
    // Body and head together are the gaze: it never waits for the body, nor swings with it (story 7.8).
    expect(body.rotation.y + head.rotation.y).toBeCloseTo(Math.PI / 2, 12);
    for (let i = 0; i < 30; i++) {
      view.animate(looking, 10, LIFE);
      expect(body.rotation.y + head.rotation.y).toBeCloseTo(Math.PI / 2, 12);
    }
    expect((scene.getObjectByName('blob_baby') as Mesh).rotation.y).toBe(0);
    view.animate(looking, 5000, LIFE);
    expect(body.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    expect(head.rotation.y).toBeCloseTo(0, 9);
  });

  it('swings past a 90° turn by at most overshootMaxDeg and settles; under reduced motion it never passes (D5, D11)', () => {
    const peakYawOf = (life: ReturnType<typeof createTestLife>): number => {
      const { scene, view } = build();
      view.update(baby({ gazeX: 0, gazeZ: 1 }), 1);
      const looking = baby({ gazeX: 1, gazeZ: 0 });
      view.update(looking, 1);
      const body = scene.getObjectByName('baby') as Mesh;
      let peak = 0;
      for (let i = 0; i < 100; i++) {
        view.animate(looking, 10, life);
        peak = Math.max(peak, body.rotation.y);
      }
      expect(body.rotation.y).toBeCloseTo(Math.PI / 2, 2);
      return peak;
    };
    const { overshootMaxDeg } = LIFE.characters.turn;
    const overshootDeg = (peak: number): number => (peak * 180) / Math.PI - 90;
    expect(overshootDeg(peakYawOf(LIFE))).toBeGreaterThan(1);
    expect(overshootDeg(peakYawOf(LIFE))).toBeLessThanOrEqual(overshootMaxDeg + 1e-6);
    expect(overshootDeg(peakYawOf(createTestLife({ isMotionReduced: true })))).toBeLessThan(1e-6);
  });

  it('breathes over his clip on the sim clock, and not under reduced motion (story 7.8)', () => {
    const { view } = build();
    view.update(baby(), 1);
    view.animate(baby(), LIFE.characters.breath.periodMs / 4, LIFE);
    expect(view.breathDeg).toBeCloseTo(LIFE.characters.breath.babyAmplitudeDeg, 6);
    view.animate(baby(), 0, LIFE);
    expect(view.breathDeg).toBeCloseTo(LIFE.characters.breath.babyAmplitudeDeg, 6);
    view.animate(baby(), 10, createTestLife({ isMotionReduced: true }));
    expect(view.breathDeg).toBe(0);
  });

  it('plays the loop of his state, and his cry over any of them', () => {
    const { view } = build();
    view.update(baby(), 1);
    view.animate(baby({ state: 'wander' }), 10, LIFE);
    expect(view.clipName).toBe('crawl');
    view.animate(baby({ state: 'targetLocked' }), 10, LIFE);
    expect(view.clipName).toBe('locked');
    view.animate(baby({ state: 'wander', cryEndsAt: asSimMs(9000) }), 10, LIFE);
    expect(view.clipName).toBe('cry');
  });

  it('moves his lids from the bone, clamped, and leaves them to the code when a clip plays', () => {
    const { scene, view } = build();
    const lids = scene.getObjectByName('eyelids') as Mesh;
    expect(lids.scale.y).toBeLessThan(0.05);
    view.setEyelids(1);
    view.update(baby(), 1);
    view.animate(baby(), 100, LIFE);
    expect(lids.scale.y).toBe(1);
    view.setEyelids(0.5);
    expect(lids.scale.y).toBe(0.5);
    view.resetAnimation();
    expect(lids.scale.y).toBeLessThan(0.05);
  });

  it('scales the body and not the shadow for the squash', () => {
    const { scene, view } = build();
    view.setSquash(1.1, 0.8);
    expect((scene.getObjectByName('baby') as Mesh).scale.toArray()).toEqual([1.1, 0.8, 1.1]);
    expect((scene.getObjectByName('blob_baby') as Mesh).scale.y).toBe(1);
  });

  it('lifts the body, not the shadow, and puts it back', () => {
    const { scene, view } = build(0.2);
    view.update(baby(), 1);
    view.setLiftM(0.3);
    const body = scene.getObjectByName('baby') as Mesh;
    const shadowY = (scene.getObjectByName('blob_baby') as Mesh).position.y;
    expect(body.position.y).toBeCloseTo(0.3, 12);
    expect((scene.getObjectByName('blob_baby') as Mesh).position.y).toBe(shadowY);
    view.setLiftM(0);
    expect(body.position.y).toBe(0);
  });

  it('offsets the whole view by the slide, across updates, and puts it back', () => {
    const { scene, view } = build();
    const group = scene.getObjectByName('baby_group') as Mesh;
    view.update(baby(), 1);
    const home = group.position.clone();
    view.setSlideM(0.3, -0.2);
    expect(group.position.x).toBeCloseTo(home.x + 0.3, 12);
    expect(group.position.z).toBeCloseTo(home.z - 0.2, 12);
    // The next frame's update keeps it.
    view.update(baby(), 1);
    expect(group.position.x).toBeCloseTo(home.x + 0.3, 12);
    expect(group.position.z).toBeCloseTo(home.z - 0.2, 12);
    view.setSlideM(0, 0);
    expect(group.position.x).toBeCloseTo(home.x, 12);
    expect(group.position.z).toBeCloseTo(home.z, 12);
    view.update(baby(), 1);
    expect(group.position.x).toBe(home.x);
  });

  it('the shadow follows the position but does not rise', () => {
    const { scene, view } = build();
    view.update(baby(), 1);
    const shadow = scene.getObjectByName('blob_baby') as Mesh;
    scene.updateMatrixWorld(true);
    expect(shadow.position.y).toBeGreaterThan(0);
    expect(shadow.position.y).toBeLessThan(0.05);
    expect(shadow.getWorldPosition(new Vector3()).x).toBe(2);
  });

  it('tolerates a feel with no radius, and disposes the rig and takes the baby out of the scene', () => {
    const { scene, view } = build(0);
    view.update(baby(), 0);
    const mesh = scene.getObjectByName('baby_body') as Mesh;
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => disposed++);
    view.dispose();
    expect(disposed).toBe(1);
    expect(scene.getObjectByName('baby')).toBeUndefined();
  });

  describe('in Papa’s arms (story 4.1)', () => {
    const papaAt = (patch: Partial<PapaSlice> = {}) =>
      ({ prevXM: 4, prevZM: 2, xM: 6, zM: 2, headingX: 1, headingZ: 0, ...patch }) as PapaSlice;
    const carried = () => baby({ state: 'carried', gazeX: 1, gazeZ: 0 });

    it('rides Papa’s interpolated pose, a little in front of him, lifted to his chest', () => {
      const { scene, view } = build(0.2);
      view.update(carried(), 0.5, papaAt());
      const group = scene.getObjectByName('baby_group');
      const body = scene.getObjectByName('baby') as Mesh;
      // Papa is at x = 5 halfway through the step; the baby is held in front of him along +x.
      expect(group?.position.x).toBeGreaterThan(5);
      expect(group?.position.x).toBeLessThan(5.6);
      expect(group?.position.z).toBeCloseTo(2, 12);
      expect(body.position.y + 0.2).toBeCloseTo(BABY_CARRIED_HEIGHT_M, 12);
    });

    it('keeps the shadow on the floor, under the baby and not under Papa', () => {
      const { scene, view } = build(0.2);
      view.update(carried(), 1, papaAt());
      scene.updateMatrixWorld(true);
      const shadow = scene.getObjectByName('blob_baby') as Mesh;
      const body = scene.getObjectByName('baby') as Mesh;
      const shadowAt = shadow.getWorldPosition(new Vector3());
      const bodyAt = body.getWorldPosition(new Vector3());
      // On the floor while the body is lifted to the chest, and it follows the group in x and z.
      expect(shadowAt.y).toBeLessThan(0.05);
      expect(bodyAt.y + 0.2).toBeCloseTo(BABY_CARRIED_HEIGHT_M, 12);
      expect(shadowAt.x).toBeCloseTo(bodyAt.x, 12);
      expect(shadowAt.z).toBeCloseTo(bodyAt.z, 12);
      expect(shadowAt.x).toBeGreaterThan(6);
    });

    it('composes with the hop: the two lifts add, and neither overwrites the other', () => {
      const { scene, view } = build(0.2);
      const body = scene.getObjectByName('baby') as Mesh;
      view.update(carried(), 1, papaAt());
      view.setLiftM(0.3);
      expect(body.position.y + 0.2).toBeCloseTo(BABY_CARRIED_HEIGHT_M + 0.3, 12);
      // The next frame's update must not drop the hop...
      view.update(carried(), 1, papaAt());
      expect(body.position.y + 0.2).toBeCloseTo(BABY_CARRIED_HEIGHT_M + 0.3, 12);
      // ...and the hop ending leaves the carry.
      view.setLiftM(0);
      expect(body.position.y + 0.2).toBeCloseTo(BABY_CARRIED_HEIGHT_M, 12);
    });

    it('puts him back on the floor, at his own pose, once he is put down', () => {
      const { scene, view } = build(0.2);
      const body = scene.getObjectByName('baby') as Mesh;
      view.update(carried(), 1, papaAt());
      view.update(baby(), 1, papaAt());
      expect(body.position.y).toBe(0);
      expect(scene.getObjectByName('baby_group')?.position.toArray()).toEqual([2, 0, 1]);
    });

    it('falls back to the baby’s own pose when no Papa is given', () => {
      const { scene, view } = build(0.2);
      view.update(carried(), 1);
      expect(scene.getObjectByName('baby_group')?.position.z).toBeCloseTo(1, 12);
      expect((scene.getObjectByName('baby') as Mesh).position.y + 0.2).toBeCloseTo(
        BABY_CARRIED_HEIGHT_M,
        12,
      );
    });
  });
});

describe('his pause, sit-down and claps (story 7.12)', () => {
  const MOTION = { clips: [{ clip: 'crawl', speedMps: 0.6 }] };

  /** One view and one life, driven frame by frame on the sim's step clock; records each new acting clip. */
  function stage(patch: Partial<LifeInputs> = {}) {
    const rig = createCharacterRig(
      createTestBaby(),
      createToonMaterialCache(TOON_TONES),
      createOutlineKit({ widthM: 0.025, skipMaterials: ['art_ink'] }),
      BABY_LIFE_BONES,
    );
    const view = createBabyView(new Scene(), createBlobKit(), 0.2, rig, MOTION);
    const life = createTestLife({ levelSeed: 1, ...patch });
    let simMs = 0;
    const run = (b: BabySlice, untilMs: number, dtMs = 10): { atMs: number; clip: string }[] => {
      const started: { atMs: number; clip: string }[] = [];
      let last = view.actingClip;
      while (simMs < untilMs) {
        simMs = Math.min(untilMs, simMs + dtMs);
        life.simMs = simMs;
        view.update(b, 1);
        view.animate(b, dtMs, life);
        const now = view.actingClip;
        if (now !== null && now !== last) started.push({ atMs: simMs, clip: now });
        last = now;
      }
      return started;
    };
    const frame = (b: BabySlice, dtMs = 10): void => {
      simMs += dtMs;
      life.simMs = simMs;
      view.animate(b, dtMs, life);
    };
    return { rig, view, life, run, frame };
  }
  /** Stopped (`babble`) at `enteredAt`, standing still. */
  const stopped = (enteredAt = 0, patch: Partial<BabySlice> = {}) =>
    baby({ state: 'babble', enteredAt: asSimMs(enteredAt), prevXM: 2, prevZM: 1, ...patch });
  const crawling = (enteredAt: number) => baby({ state: 'wander', enteredAt: asSimMs(enteredAt) });

  it('pauses on all fours after he stops, then sits at exactly afterMs, playing the sit-down (D7)', () => {
    const { run, frame, view, life } = stage();
    const afterMs = life.characters.babySit.afterMs;
    run(stopped(0), afterMs - 10);
    expect(view.clipName).toBe('crawl_pause');
    expect(view.actingClip).toBeNull();
    frame(stopped(0));
    expect(view.actingClip).toBe('sit_down');
    expect(view.clipName).toBe('sit_down');
  });

  it('sits at once, with no sit-down, with afterMs 0 after a stop he did not crawl into', () => {
    const { run, view, life } = stage();
    life.characters.babySit.afterMs = 0;
    run(stopped(0), 50);
    expect(view.clipName).toBe('babble');
    expect(view.actingClip).toBeNull();
  });

  it('sits down straight from his crawl with afterMs 0', () => {
    const { run, frame, view, life } = stage();
    life.characters.babySit.afterMs = 0;
    run(crawling(0), 500);
    expect(view.clipName).toBe('crawl');
    frame(stopped(500));
    expect(view.actingClip).toBe('sit_down');
  });

  it.each([
    ['in the guard', { isSignalOnly: true }, {}, 'babble'],
    ['under reduced motion', { isMotionReduced: true }, {}, 'babble'],
    ['while he cries', {}, { cryEndsAt: asSimMs(90_000) }, 'cry'],
  ] as const)(
    'keeps his loop from the first frame %s: no pause, no sit-down, no clap',
    (_n, patch, babyPatch, loop) => {
      const { run, view } = stage(patch);
      const played = run(stopped(0, babyPatch), 12_000);
      expect(view.clipName).toBe(loop);
      expect(played).toEqual([]);
    },
  );

  it('never goes back on all fours when the guard ends within his pause: the stop seats him for good', () => {
    const { run, frame, view, life } = stage();
    run(stopped(0), 100);
    expect(view.clipName).toBe('crawl_pause');
    life.isSignalOnly = true;
    frame(stopped(0));
    expect(view.clipName).toBe('babble');
    life.isSignalOnly = false;
    frame(stopped(0));
    expect(view.clipName).toBe('babble');
    expect(view.actingClip).toBeNull();
  });

  it.each([
    ['downstairs', baby({ state: 'downstairs', enteredAt: asSimMs(0) })],
    ['carried', baby({ state: 'carried', enteredAt: asSimMs(0) })],
    ['locked on a target', baby({ state: 'targetLocked', enteredAt: asSimMs(0) })],
  ])('plays no pause, sit-down or clap %s', (_n, b) => {
    const { run, view } = stage();
    expect(run(b, 12_000)).toEqual([]);
    expect(view.clipName).not.toBe('crawl_pause');
  });

  it.each([
    ['mid sit-down', 650],
    ['mid clap', 0],
  ])(
    'cuts his acting in the frame the sim sets him off %s, the crawl fading in over startMs',
    (_n, atMs) => {
      const { run, frame, view, rig, life } = stage();
      const target =
        atMs > 0 ? atMs : (slotsOf(life, 0, 12_000)[0] as { startAt: number }).startAt + 100;
      run(stopped(0), target);
      expect(view.actingClip).toBe(atMs > 0 ? 'sit_down' : 'clap');
      frame(crawling(target), 0);
      expect(view.actingClip).toBeNull();
      expect(view.clipName).toBe('crawl');
      frame(crawling(target), life.characters.fades.startMs / 2);
      expect(rig.weightOf('crawl')).toBeGreaterThan(0);
      expect(rig.weightOf('crawl')).toBeLessThan(1);
    },
  );

  /** The clap slots of a stop begun at `stillSinceAt`, for the stage's seed. */
  const slotsOf = (life: LifeInputs, stillSinceAt: number, untilMs: number) => {
    const slots: { startAt: number }[] = [];
    const slot = createIdleSlot();
    for (let t = stillSinceAt; t <= untilMs; t += 10) {
      idleSlotAt(
        life.levelSeed,
        BABY_IDLE_SALT,
        stillSinceAt,
        t,
        life.characters.babyIdles,
        1,
        slot,
      );
      if (slot.index >= 0 && slots.length === slot.index) slots.push({ startAt: slot.startAt });
    }
    return slots;
  };

  it('claps at the slots of his cadence, from firstAfterMs after he stopped (D8)', () => {
    const { run, life } = stage();
    const slots = slotsOf(life, 0, 12_000);
    expect(slots.length).toBeGreaterThan(2);
    expect((slots[0] as { startAt: number }).startAt).toBe(life.characters.babyIdles.firstAfterMs);
    const played = run(stopped(0), 12_000).filter((p) => p.clip === 'clap');
    // Each slot is seen by the first 10 ms frame whose step clock reaches it.
    expect(played.map((p) => Math.ceil(p.atMs / 10))).toEqual(
      slots.map((s) => Math.ceil(s.startAt / 10)),
    );
  });

  it('claps at the same slots for 1, 3 or 7 frames over the same span', () => {
    const claps = (dtMs: number) => {
      const { run, life } = stage();
      const slots = slotsOf(life, 0, 12_000);
      const played = run(stopped(0), 12_000, dtMs).filter((p) => p.clip === 'clap');
      // Each clap is seen by the first frame whose step clock reaches its slot.
      return played.map((p, i) => {
        const slot = slots[i];
        expect(slot, `clap ${i} has a slot`).toBeDefined();
        const { startAt } = slot as { startAt: number };
        expect(p.atMs).toBeGreaterThanOrEqual(startAt);
        expect(p.atMs).toBeLessThan(startAt + dtMs);
        return startAt;
      });
    };
    const one = claps(10);
    expect(one.length).toBeGreaterThan(0);
    expect(claps(30)).toEqual(one);
    expect(claps(70)).toEqual(one);
  });

  it('starts nothing on a frame of dtMs 0, and leaves the slot to the next frame', () => {
    const { run, frame, view, life } = stage();
    const first = (slotsOf(life, 0, 12_000)[0] as { startAt: number }).startAt;
    run(stopped(0), first - 10);
    life.simMs = first + 10;
    view.animate(stopped(0), 0, life);
    expect(view.actingClip).toBeNull();
    frame(stopped(0), 20);
    expect(view.actingClip).toBe('clap');
  });

  it('starts over on resetAnimation: no clip of his under way, the pause again', () => {
    const { run, view, life } = stage();
    run(stopped(0), 700);
    expect(view.actingClip).toBe('sit_down');
    view.resetAnimation();
    expect(view.actingClip).toBeNull();
    life.simMs = 0;
    view.animate(stopped(0), 0, life);
    expect(view.clipName).toBe('crawl_pause');
  });
});
