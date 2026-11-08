import { asSimMs } from '@shared/time';
import type { BabySlice, PapaSlice } from '@sim';
import { type Mesh, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestBaby, createTestLife } from '../../../../tests/support/testCharacters.ts';
import { createBlobKit } from '../blobShadow.ts';
import { createOutlineKit } from '../materials/outlineHull.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  BABY_CARRIED_HEIGHT_M,
  BABY_LIFE_BONES,
  type BabyPose,
  babyPoseAt,
  createBabyView,
} from './babyView.ts';
import { createCharacterRig } from './characterRig.ts';

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
