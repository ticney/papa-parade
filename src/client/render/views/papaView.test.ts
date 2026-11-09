import { ISO_YAW_DEG } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { BabySlice, PapaSlice } from '@sim';
import {
  AnimationClip,
  type Object3D,
  Scene,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  browEndsInHead,
  createTestLife,
  createTestPapa,
  TEST_FORELOCK_ROOT_M,
  TEST_FORELOCK_TIP_M,
  TEST_PAPA_BROW_REST_M,
} from '../../../../tests/support/testCharacters.ts';
import type { CharacterAsset } from '../../assets/gltf.ts';
import { createBlobKit } from '../blobShadow.ts';
import { createOutlineKit } from '../materials/outlineHull.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import type { BrowPose } from './brows.ts';
import { PAPA_IDLE_CLIPS } from './characterClips.ts';
import { createCharacterRig, EYELIDS_OPEN_SCALE } from './characterRig.ts';
import { PAPA_EXPRESSIONS, type PapaFace } from './expressions.ts';
import type { LifeInputs } from './lifeLayer.ts';
import { createIdleSlot, idleSlotAt, PAPA_IDLE_SALT } from './papaActing.ts';
import { createPapaView, PAPA_LIFE_BONES, type PapaPose, papaPoseAt } from './papaView.ts';

const TOON_TONES = [96, 178, 255];

function papa(patch: Partial<PapaSlice> = {}): PapaSlice {
  return {
    state: 'idle',
    enteredAt: asSimMs(0),
    xM: 2,
    zM: 1,
    prevXM: 1,
    prevZM: 1,
    headingX: 0,
    headingZ: 1,
    look: { hasMashOnCheek: false, hasHairOnEnd: false, isShirtInsideOut: false },
    path: [],
    pathIndex: 0,
    dirX: 0,
    dirZ: 0,
    isBlocked: false,
    glide: null,
    objectId: null,
    intent: 'none',
    busyUntil: asSimMs(0),
    ...patch,
  };
}

describe('papaPoseAt', () => {
  it('interpolates the position between the last two steps', () => {
    const pose: PapaPose = { xM: 0, zM: 0, yawRad: 0 };
    papaPoseAt(papa(), 0, pose);
    expect([pose.xM, pose.zM]).toEqual([1, 1]);
    papaPoseAt(papa(), 0.5, pose);
    expect([pose.xM, pose.zM]).toEqual([1.5, 1]);
    papaPoseAt(papa(), 1, pose);
    expect([pose.xM, pose.zM]).toEqual([2, 1]);
  });

  it('turns the unit heading into an angle: +z is 0, +x is a quarter turn, -z is a half turn', () => {
    const pose: PapaPose = { xM: 0, zM: 0, yawRad: 9 };
    papaPoseAt(papa({ headingX: 0, headingZ: 1 }), 0, pose);
    expect(pose.yawRad).toBe(0);
    papaPoseAt(papa({ headingX: 1, headingZ: 0 }), 0, pose);
    expect(pose.yawRad).toBeCloseTo(Math.PI / 2, 12);
    papaPoseAt(papa({ headingX: 0, headingZ: -1 }), 0, pose);
    expect(Math.abs(pose.yawRad)).toBeCloseTo(Math.PI, 12);
    papaPoseAt(papa({ headingX: -1, headingZ: 0 }), 0, pose);
    expect(pose.yawRad).toBeCloseTo(-Math.PI / 2, 12);
  });
});

/** Whether a node and all its ancestors are visible: what the renderer would draw. */
function isShown(node: Object3D | null): boolean {
  for (let n = node; n !== null; n = n.parent) if (!n.visible) return false;
  return true;
}

/** The life layer's inputs of a frame: the test feel's `characters` (turn: 250 ms, damping 0.6, cap 10°). */
const LIFE = createTestLife();
const MOTION = {
  clips: [{ clip: 'walk', speedMps: 3 }],
  clipFacing: [
    { clip: 'drink', facing: 'camera' },
    { clip: 'coffee_kick', facing: 'camera' },
    { clip: 'on_phone', facing: 'awayFromBaby' },
  ] as const,
  busyProps: {
    steamSwayDeg: 12,
    steamStretchPct: 15,
    steamPeriodMs: 800,
    blablaTiltDeg: 8,
    blablaBobAmplitudeM: 0.03,
    blablaPeriodMs: 800,
    blablaPlace: { screenOffsetM: 0.4, heightM: 0.8 },
  },
};
const CAMERA_YAW_RAD = (ISO_YAW_DEG * Math.PI) / 180;
const FREE_BABY = { state: 'babble' } as BabySlice;
const CARRIED_BABY = { state: 'carried' } as BabySlice;

function buildView(radiusM = 0.25, prepare?: (asset: CharacterAsset) => void) {
  const scene = new Scene();
  const toon = createToonMaterialCache(TOON_TONES);
  const blobs = createBlobKit();
  const asset = createTestPapa();
  prepare?.(asset);
  const rig = createCharacterRig(
    asset,
    toon,
    createOutlineKit({ widthM: 0.025, skipMaterials: ['art_ink'] }),
    PAPA_LIFE_BONES,
  );
  const view = createPapaView(scene, toon, blobs, radiusM, rig, MOTION);
  return {
    scene,
    toon,
    blobs,
    rig,
    view,
    named: (name: string) => scene.getObjectByName(name) as Object3D,
  };
}

describe('createPapaView', () => {
  it('draws the rig and a flat shadow, and none of the hidden parts', () => {
    const { named } = buildView();
    for (const name of ['papa_body', 'papa_shirt', 'blob_papa']) {
      expect(isShown(named(name)), name).toBe(true);
    }
    for (const name of [
      'papa_mug',
      'papa_handset',
      'papa_hair',
      'papa_look_mash',
      'papa_look_shirt',
      'papa_z',
    ]) {
      expect(isShown(named(name)), name).toBe(false);
    }
  });

  it("never culls his skinned meshes, whose bounds are the rest pose's", () => {
    const { named } = buildView();
    expect(named('papa_body')).toBeInstanceOf(SkinnedMesh);
    expect(named('papa_body').frustumCulled).toBe(false);
  });

  it('puts him on the floor at the interpolated position, turned at once on his first frame', () => {
    const { view, named } = buildView();
    view.update(papa({ headingX: 1, headingZ: 0 }), 0.5);
    expect(named('papa_group').position.toArray()).toEqual([1.5, 0, 1]);
    expect(named('papa').position.y).toBe(0);
    expect(named('papa').rotation.y).toBeCloseTo(Math.PI / 2, 12);
  });

  it('the shadow follows his position but does not turn or rise', () => {
    const { scene, view, named } = buildView();
    view.update(papa({ headingX: 1, headingZ: 0 }), 1);
    const shadow = named('blob_papa');
    scene.updateMatrixWorld(true);
    expect(shadow.rotation.y).toBe(0);
    expect(shadow.position.y).toBeGreaterThan(0);
    expect(shadow.position.y).toBeLessThan(0.05);
    expect(shadow.getWorldPosition(new Vector3()).x).toBe(2);
    expect(shadow.scale.x).toBeGreaterThan(0.5);
  });

  it('keeps the hair hidden until it is raised, scales it with the amount and clamps it', () => {
    const { view, named } = buildView();
    const hair = named('papa_hair');
    expect(hair.visible).toBe(false);
    view.setHair(0.5);
    expect(hair.visible).toBe(true);
    expect(hair.scale.y).toBe(0.5);
    view.setHair(7);
    expect(hair.scale.y).toBe(1);
    view.setHair(-3);
    expect(hair.visible).toBe(false);
  });

  it('tolerates a feel with no radius, and disposes by taking Papa out of the scene and freeing the rig', () => {
    const { scene, view } = buildView(0);
    view.update(papa(), 0);
    expect(scene.getObjectByName('papa')).toBeDefined();
    view.dispose();
    expect(scene.getObjectByName('papa')).toBeUndefined();
    expect(scene.getObjectByName('papa_body')).toBeUndefined();
  });
});

describe('his animation (story 7.2)', () => {
  it("plays the loop of his state, and the carried one when the baby's state says so", () => {
    const { view } = buildView();
    view.update(papa(), 1);
    view.animate(papa(), FREE_BABY, 10, LIFE);
    expect(view.clipName).toBe('idle');
    view.animate(papa(), CARRIED_BABY, 10, LIFE);
    expect(view.clipName).toBe('carry_idle');
    view.animate(papa({ state: 'walkPath' }), CARRIED_BABY, 10, LIFE);
    expect(view.clipName).toBe('carry_walk');
    view.animate(papa({ state: 'onPhone' }), FREE_BABY, 10, LIFE);
    expect(view.clipName).toBe('on_phone');
  });

  it('holds the mixer on a dt of 0', () => {
    const { view } = buildView();
    view.update(papa(), 1);
    view.animate(papa(), FREE_BABY, 200, LIFE);
    const timeMs = view.mixerTimeMs;
    view.animate(papa(), FREE_BABY, 0, LIFE);
    expect(view.mixerTimeMs).toBe(timeMs);
  });

  it('paces the walk clip by the floor speed read from the sim', () => {
    const { rig, view } = buildView();
    const action = (): number => rig.node('spine').position.y;
    view.update(papa({ state: 'walkPath', prevXM: 0, xM: 0.015 }), 1);
    // 0.015 m in a 10 ms step is 1.5 m/s, half the clip's 3 m/s.
    view.animate(papa({ state: 'walkPath', prevXM: 0, xM: 0.015 }), FREE_BABY, 400, LIFE);
    expect(action()).toBeCloseTo(0.2, 5);
  });

  it("turns his body on its spring, while the pose says the sim's heading at once (story 7.8, D5)", () => {
    const { view, named } = buildView();
    view.update(papa({ headingX: 0, headingZ: 1 }), 1);
    const east = papa({ headingX: 1, headingZ: 0 });
    view.update(east, 1);
    expect(view.pose.yawRad).toBeCloseTo(Math.PI / 2, 12);
    expect(named('papa').rotation.y).toBe(0);
    view.animate(east, FREE_BABY, 120, LIFE);
    const midway = named('papa').rotation.y;
    expect(midway).toBeGreaterThan(0.1);
    expect(midway).toBeLessThan(Math.PI / 2);
    expect(view.bodyYawRad).toBe(midway);
    view.animate(east, FREE_BABY, 0, LIFE);
    expect(named('papa').rotation.y).toBe(midway);
    // It swings past (5 to 10° on a quarter turn), then settles on the heading.
    let peak = 0;
    for (let i = 0; i < 100; i++) {
      view.animate(east, FREE_BABY, 10, LIFE);
      peak = Math.max(peak, named('papa').rotation.y);
    }
    expect((peak - Math.PI / 2) * (180 / Math.PI)).toBeGreaterThanOrEqual(5);
    expect((peak - Math.PI / 2) * (180 / Math.PI)).toBeLessThanOrEqual(10);
    view.animate(east, FREE_BABY, 5000, LIFE);
    expect(named('papa').rotation.y).toBeCloseTo(Math.PI / 2, 9);
    expect(view.pose.yawRad).toBeCloseTo(Math.PI / 2, 12);
  });

  it('turns with no overshoot under reduced motion (story 7.8, D11)', () => {
    const { view, named } = buildView();
    view.update(papa({ headingX: 0, headingZ: 1 }), 1);
    const east = papa({ headingX: 1, headingZ: 0 });
    view.update(east, 1);
    const reduced = createTestLife({ isMotionReduced: true });
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      view.animate(east, FREE_BABY, 10, reduced);
      peak = Math.max(peak, named('papa').rotation.y);
    }
    expect(peak).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    expect(named('papa').rotation.y).toBeCloseTo(Math.PI / 2, 3);
  });

  it('scales the body and not the shadow for the squash, and puts it back on a reset', () => {
    const { view, named } = buildView();
    view.setSquash(1.2, 0.7);
    expect(named('papa').scale.toArray()).toEqual([1.2, 0.7, 1.2]);
    expect(named('blob_papa').scale.y).toBe(1);
    view.resetAnimation();
    expect(named('papa').scale.toArray()).toEqual([1, 1, 1]);
    expect(view.clipName).toBeNull();
  });
});

describe('his look (story 7.2, D2)', () => {
  const look = (patch = {}) => ({
    hasMashOnCheek: false,
    hasHairOnEnd: false,
    isShirtInsideOut: false,
    ...patch,
  });

  it('shows each part on its own', () => {
    const { view, named } = buildView();
    view.setLook(look({ hasMashOnCheek: true }));
    expect(isShown(named('papa_look_mash'))).toBe(true);
    expect(isShown(named('papa_hair'))).toBe(false);
    expect(isShown(named('papa_look_shirt'))).toBe(false);
    expect(isShown(named('papa_shirt'))).toBe(true);
    view.setLook(look({ hasHairOnEnd: true }));
    expect(isShown(named('papa_look_mash'))).toBe(false);
    expect(isShown(named('papa_hair'))).toBe(true);
    view.setLook(look({ isShirtInsideOut: true }));
    expect(isShown(named('papa_hair'))).toBe(false);
    expect(isShown(named('papa_look_shirt'))).toBe(true);
    expect(isShown(named('papa_shirt'))).toBe(false);
    view.setLook(look());
    expect(isShown(named('papa_look_shirt'))).toBe(false);
    expect(isShown(named('papa_shirt'))).toBe(true);
  });

  it('draws the hair at the greater of the gag and the look, so that the gag ending leaves the look up', () => {
    const { view, named } = buildView();
    view.setHair(0.4);
    view.setLook(look({ hasHairOnEnd: true }));
    expect(named('papa_hair').scale.y).toBe(1);
    view.setHair(0);
    expect(isShown(named('papa_hair'))).toBe(true);
    expect(named('papa_hair').scale.y).toBe(1);
    view.setLook(look());
    expect(isShown(named('papa_hair'))).toBe(false);
  });
});

describe('the nap and the coffee (story 1.19)', () => {
  /** How shut the lids are, from the bone: the open scale is a sliver, not 0. */
  const lidsOf = (named: (name: string) => Object3D): number => named('eyelids').scale.y;

  it('draws nothing of it by default: open lids, no « Z », no mug', () => {
    const { named } = buildView();
    expect(lidsOf(named)).toBeLessThan(0.05);
    for (const name of ['papa_z', 'papa_mug']) {
      expect(isShown(named(name)), name).toBe(false);
    }
  });

  it('lowers the eyelids with the amount: scaled down from the top, clamped', () => {
    const { view, named } = buildView();
    view.setEyelids(0.5);
    expect(lidsOf(named)).toBe(0.5);
    view.setEyelids(7);
    expect(lidsOf(named)).toBe(1);
    view.setEyelids(-1);
    expect(lidsOf(named)).toBeLessThan(0.05);
  });

  it('keeps the lids and the accessories on the rig, so they turn with his body', () => {
    const { named } = buildView();
    for (const name of ['eyelids', 'papa_mug']) {
      let isUnderBody = false;
      for (let n: Object3D | null = named(name); n !== null; n = n.parent) {
        if (n === named('papa')) isUnderBody = true;
      }
      expect(isUnderBody, name).toBe(true);
    }
  });

  it('survives the mixer: a clip playing does not reopen the lids', () => {
    const { view, named } = buildView();
    view.update(papa(), 1);
    view.setEyelids(0.7);
    view.animate(papa(), FREE_BABY, 100, LIFE);
    expect(lidsOf(named)).toBe(0.7);
  });

  it('shuts the eyelids and floats a « Z » while he sleeps, and puts them away when he wakes', () => {
    const { view, named } = buildView();
    view.setEyelids(0.2);
    view.setAsleep(true, 0);
    expect(isShown(named('papa_z'))).toBe(true);
    expect(lidsOf(named)).toBe(1);
    const restY = named('papa_z').position.y;
    view.setAsleep(true, 300);
    expect(named('papa_z').position.y).not.toBe(restY);
    view.setAsleep(false, 600);
    expect(isShown(named('papa_z'))).toBe(false);
    // Back to what the telegraph asks for: the amount set before.
    expect(lidsOf(named)).toBe(0.2);
  });

  it('shows the mug while he drinks', () => {
    const { view, named } = buildView();
    view.setDrinking(true, 0, false);
    expect(isShown(named('papa_mug'))).toBe(true);
    view.setDrinking(false, 0, false);
    expect(isShown(named('papa_mug'))).toBe(false);
  });

  it('shows the handset while he is on the phone', () => {
    const { view, named } = buildView();
    expect(isShown(named('papa_handset'))).toBe(false);
    view.setOnPhone(true, 0, false);
    expect(isShown(named('papa_handset'))).toBe(true);
    view.setOnPhone(false, 0, false);
    expect(isShown(named('papa_handset'))).toBe(false);
  });

  it('hides the whole of Papa, the blob shadow included, while he is away, and shows him again after (story 4.3)', () => {
    const { view, named } = buildView();
    for (const name of ['papa', 'blob_papa']) expect(isShown(named(name)), name).toBe(true);
    view.setAway(true);
    for (const name of ['papa', 'blob_papa', 'papa_mug'])
      expect(isShown(named(name)), name).toBe(false);
    view.setAway(false);
    for (const name of ['papa', 'blob_papa']) expect(isShown(named(name)), name).toBe(true);
  });

  it('exposes the pose it drew, interpolated', () => {
    const { view } = buildView();
    view.update(papa(), 0.5);
    expect([view.pose.xM, view.pose.zM]).toEqual([1.5, 1]);
  });
});

describe('his facing (story 2.13, D5)', () => {
  // Long enough for the turn spring to settle on its target exactly (story 7.8).
  const settle = (view: ReturnType<typeof buildView>['view'], p: PapaSlice, baby: BabySlice) => {
    view.animate(p, baby, 5000, LIFE);
    view.animate(p, baby, 5000, LIFE);
  };

  it("turns to face the camera while he drinks, and his heading stays the sim's", () => {
    const { view, named } = buildView();
    const drinking = papa({ state: 'drink', headingX: 0, headingZ: -1 });
    view.update(drinking, 1);
    settle(view, drinking, FREE_BABY);
    expect(view.bodyYawRad).toBeCloseTo(CAMERA_YAW_RAD, 12);
    expect(named('papa').rotation.y).toBeCloseTo(CAMERA_YAW_RAD, 12);
    // The pose, what every marker reads, still says the heading.
    expect(Math.abs(view.pose.yawRad)).toBeCloseTo(Math.PI, 12);
  });

  it('turns his back to the baby while he is on the phone', () => {
    const { view } = buildView();
    const calling = papa({ state: 'onPhone', xM: 2, zM: 1, headingX: 0, headingZ: 1 });
    const baby = { state: 'wander', xM: 0, zM: 1 } as BabySlice;
    view.update(calling, 1);
    settle(view, calling, baby);
    // The baby is 2 m to his -x side: his back is to it, so he faces +x.
    expect(view.bodyYawRad).toBeCloseTo(Math.PI / 2, 12);
    const elsewhere = { state: 'wander', xM: 2, zM: 4 } as BabySlice;
    settle(view, calling, elsewhere);
    expect(view.bodyYawRad).toBeCloseTo(Math.PI, 12);
  });

  it('goes back to his heading while the baby is carried or hiding', () => {
    const { view } = buildView();
    const calling = papa({ state: 'onPhone', headingX: 0, headingZ: 1 });
    view.update(calling, 1);
    for (const state of ['carried', 'mischiefSilent']) {
      const baby = { state, xM: 0, zM: 1 } as BabySlice;
      settle(view, calling, baby);
      expect(view.bodyYawRad, state).toBeCloseTo(0, 12);
    }
  });

  it('keeps the camera facing for the kick, a one-shot over his idle loop', () => {
    const { view } = buildView();
    const idle = papa({ headingX: 0, headingZ: 1 });
    view.update(idle, 1);
    settle(view, idle, FREE_BABY);
    expect(view.bodyYawRad).toBeCloseTo(0, 12);
    view.playOnce('coffee_kick', 100);
    view.animate(idle, FREE_BABY, 10, LIFE);
    expect(view.clipName).toBe('coffee_kick');
    // 800 ms settles the 250 ms spring to within a degree, and leaves more than the 150 ms return of the
    // fixture's 1 s clip.
    view.animate(idle, FREE_BABY, 800, LIFE);
    expect(view.clipName).toBe('coffee_kick');
    expect(Math.abs(view.bodyYawRad - CAMERA_YAW_RAD)).toBeLessThan(Math.PI / 180);
  });

  it('turns on its spring, and a pause holds the turn', () => {
    const { view } = buildView();
    const drinking = papa({ state: 'drink', headingX: 0, headingZ: 1 });
    view.update(drinking, 1);
    view.animate(drinking, FREE_BABY, 0, LIFE);
    expect(view.bodyYawRad).toBe(0);
    view.animate(drinking, FREE_BABY, 62.5, LIFE);
    const turned = view.bodyYawRad;
    expect(turned).toBeGreaterThan(0);
    expect(turned).toBeLessThan(CAMERA_YAW_RAD);
    view.animate(drinking, FREE_BABY, 0, LIFE);
    expect(view.bodyYawRad).toBe(turned);
  });
});

describe('the steam and the bla-bla (story 2.13, D3, D4)', () => {
  const LOOK = { sway: MOTION.busyProps.steamSwayDeg, tilt: MOTION.busyProps.blablaTiltDeg };

  it('sways the steam on the sim clock while he drinks: the same clock, the same sway', () => {
    const { view, named } = buildView();
    view.setDrinking(true, 200, false); // a quarter of the 800 ms period: the sine's peak
    expect(view.steamSwayDeg).toBeCloseTo(LOOK.sway, 10);
    expect(named('papa_mug_steam').rotation.z).toBeCloseTo((LOOK.sway * Math.PI) / 180, 10);
    expect(named('papa_mug_steam').scale.y).toBeCloseTo(
      1 + MOTION.busyProps.steamStretchPct / 100,
      10,
    );
    view.setDrinking(true, 200, false);
    expect(view.steamSwayDeg).toBeCloseTo(LOOK.sway, 10);
    view.setDrinking(true, 600, false);
    expect(view.steamSwayDeg).toBeCloseTo(-LOOK.sway, 10);
  });

  it('holds the steam at its rest transform under reduced motion, still shown', () => {
    // The file's own transform of the steam is its rest, read when the view is made.
    const { view, named } = buildView(0.25, (asset) => {
      const node = asset.scene.getObjectByName('papa_mug_steam') as Object3D;
      node.rotation.z = 0.25;
      node.scale.y = 1.5;
    });
    const steam = named('papa_mug_steam');
    view.setDrinking(true, 200, true);
    expect(isShown(steam)).toBe(true);
    expect(view.steamSwayDeg).toBe(0);
    expect(steam.rotation.z).toBeCloseTo(0.25, 10);
    expect(steam.scale.y).toBeCloseTo(1.5, 10);
  });

  it('hides the steam with the mug and writes nothing while it is hidden', () => {
    const { view, named } = buildView();
    const steam = named('papa_mug_steam');
    view.setDrinking(true, 200, false);
    view.setDrinking(false, 400, false);
    expect(isShown(steam)).toBe(false);
    expect(view.steamSwayDeg).toBe(0);
    const before = steam.rotation.z;
    view.setDrinking(false, 600, false);
    expect(steam.rotation.z).toBe(before);
  });

  it('shows the bla-bla bubble exactly while he is on the phone, in the group that never turns', () => {
    const { view, named } = buildView();
    const bubble = named('papa_blabla');
    expect(isShown(bubble)).toBe(false);
    expect(bubble.parent).toBe(named('papa_group'));
    view.setOnPhone(true, 0, false);
    expect(isShown(bubble)).toBe(true);
    view.setOnPhone(false, 0, false);
    expect(isShown(bubble)).toBe(false);
    // It is not under his body, which turns, nor under the rig.
    for (let n: Object3D | null = bubble; n !== null; n = n.parent) {
      expect(n).not.toBe(named('papa'));
    }
  });

  it('stands the bubble at his side toward the screen side the data gives, facing the camera', () => {
    const { view, named } = buildView();
    const bubble = named('papa_blabla');
    view.setOnPhone(true, 0, true);
    const { screenOffsetM, heightM } = MOTION.busyProps.blablaPlace;
    // Screen right for the camera at ISO_YAW_DEG is (cos, -sin) on the floor.
    expect(bubble.position.x).toBeCloseTo(screenOffsetM * Math.cos(CAMERA_YAW_RAD), 10);
    expect(bubble.position.z).toBeCloseTo(-screenOffsetM * Math.sin(CAMERA_YAW_RAD), 10);
    expect(bubble.position.y).toBeCloseTo(heightM, 10);
    expect(bubble.rotation.y).toBeCloseTo(CAMERA_YAW_RAD, 10);
  });

  it('wobbles the bubble on the sim clock: a tilt and a bob, and the turn of his body does not move it', () => {
    const { view, named } = buildView();
    const bubble = named('papa_blabla');
    view.setOnPhone(true, 200, false);
    expect(view.blablaTiltDeg).toBeCloseTo(LOOK.tilt, 10);
    expect(bubble.rotation.z).toBeCloseTo((LOOK.tilt * Math.PI) / 180, 10);
    expect(bubble.position.y).toBeCloseTo(
      MOTION.busyProps.blablaPlace.heightM + MOTION.busyProps.blablaBobAmplitudeM,
      10,
    );
    view.setOnPhone(true, 600, false);
    expect(view.blablaTiltDeg).toBeCloseTo(-LOOK.tilt, 10);
    // His body turning leaves the bubble where it is.
    const calling = papa({ state: 'onPhone', headingX: 1, headingZ: 0 });
    view.update(calling, 1);
    const before = bubble.position.clone();
    view.animate(calling, { state: 'wander', xM: 9, zM: 9 } as BabySlice, 1000, LIFE);
    expect(bubble.position.toArray()).toEqual(before.toArray());
  });

  it('holds the bubble at its rest transform under reduced motion, still shown', () => {
    const { view, named } = buildView();
    const bubble = named('papa_blabla');
    view.setOnPhone(true, 200, true);
    expect(isShown(bubble)).toBe(true);
    expect(view.blablaTiltDeg).toBe(0);
    expect(bubble.rotation.z).toBe(0);
    expect(bubble.position.y).toBeCloseTo(MOTION.busyProps.blablaPlace.heightM, 10);
  });

  it('takes the bubble away with him when he leaves the room', () => {
    const { view, named } = buildView();
    view.setOnPhone(true, 0, false);
    view.setAway(true);
    expect(isShown(named('papa_blabla'))).toBe(false);
    view.setAway(false);
    expect(isShown(named('papa_blabla'))).toBe(true);
  });

  it('frees the geometry of the bubble, which the rig no longer reaches, and its outline hull', () => {
    const { view, named } = buildView();
    const geometries: { dispose(): void }[] = [];
    named('papa_blabla').traverse((node) => {
      if ('geometry' in node)
        geometries.push((node as unknown as { geometry: { dispose(): void } }).geometry);
    });
    expect(geometries.length).toBeGreaterThan(0);
    let freed = 0;
    for (const geometry of geometries) {
      const original = geometry.dispose.bind(geometry);
      geometry.dispose = () => {
        freed += 1;
        original();
      };
    }
    view.dispose();
    expect(freed).toBe(geometries.length);
  });
});

describe('his life layer (story 7.8)', () => {
  const DEG = Math.PI / 180;
  /** Where his torso's top points: the spine bone's up, in his body's frame (+z forward, +x his left). */
  const spineUp = (named: (name: string) => Object3D): Vector3 =>
    new Vector3(0, 1, 0).applyQuaternion(named('spine').quaternion);
  const headForward = (named: (name: string) => Object3D): Vector3 =>
    new Vector3(0, 0, 1).applyQuaternion(named('head').quaternion);
  const STILL_AT_0 = { xM: 0, zM: 0, prevXM: 0, prevZM: 0 };

  it('stoops him forward at fatigue 100, by stoop.maxDeg, and leaves his eyelids open (D9)', () => {
    const { view, named } = buildView();
    const tired = createTestLife({ fatigue: 100, isMotionReduced: true });
    view.update(papa(), 1);
    view.setEyelids(0);
    view.animate(papa(), FREE_BABY, 16, tired);
    expect(view.stoopDeg).toBe(tired.characters.stoop.maxDeg);
    const up = spineUp(named);
    // A positive pitch about X leans his top forward, toward +z (D3).
    expect(up.z).toBeGreaterThan(0);
    expect(Math.atan2(up.z, up.y) / DEG).toBeCloseTo(tired.characters.stoop.maxDeg, 6);
    expect(named('eyelids').scale.y).toBeLessThan(0.05);
    view.animate(papa(), FREE_BABY, 16, createTestLife({ fatigue: 0, isMotionReduced: true }));
    expect(spineUp(named).z).toBeCloseTo(0, 9);
  });

  it('breathes on the sim clock, holds on a frozen one, and holds his breath (D7)', () => {
    const { view } = buildView();
    view.update(papa(), 1);
    const life = createTestLife();
    view.animate(papa(), FREE_BABY, life.characters.breath.periodMs / 4, life);
    expect(view.breathDeg).toBeCloseTo(life.characters.breath.papaAmplitudeDeg, 6);
    view.animate(papa(), FREE_BABY, 0, life);
    expect(view.breathDeg).toBeCloseTo(life.characters.breath.papaAmplitudeDeg, 6);
    const held = createTestLife({ isBreathHeld: true });
    for (let i = 0; i < 100; i++) view.animate(papa(), FREE_BABY, 10, held);
    expect(Math.abs(view.breathDeg)).toBe(0);
  });

  it('quickens his breath above the catastrophe alert', () => {
    const { view } = buildView();
    view.update(papa(), 1);
    const alert = createTestLife({ isAlert: true });
    // A quarter of the alarmed period is the sine's peak.
    view.animate(papa(), FREE_BABY, alert.characters.breath.alertPeriodMs / 4, alert);
    expect(view.breathDeg).toBeCloseTo(alert.characters.breath.papaAmplitudeDeg, 6);
  });

  it('leans into a glide start, and has no lean nor breath under reduced motion (D6, D11)', () => {
    const { view } = buildView();
    const still = papa({ state: 'idle', prevXM: 2, xM: 2 });
    const gliding = papa({ state: 'glide', prevXM: 2, xM: 2.05 });
    view.update(still, 1);
    view.animate(still, FREE_BABY, 100, createTestLife());
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      view.animate(gliding, FREE_BABY, 10, createTestLife());
      peak = Math.max(peak, view.leanDeg);
    }
    expect(peak).toBeGreaterThan(5);
    const reduced = createTestLife({ isMotionReduced: true });
    view.animate(gliding, FREE_BABY, 10, reduced);
    expect(view.leanDeg).toBe(0);
    expect(view.leanRollDeg).toBe(0);
    expect(view.breathDeg).toBe(0);
  });

  it('pins the lean on the rig: forward into a start, toward his left into a left turn (D3, D6)', () => {
    // Held breath: the torso moves by the lean alone.
    const life = createTestLife({ isBreathHeld: true });
    const start = buildView();
    const still = papa({ state: 'idle', prevXM: 2, xM: 2 });
    start.view.update(still, 1);
    start.view.animate(still, FREE_BABY, 100, life);
    const gliding = papa({ state: 'glide', prevXM: 2, xM: 2.05 });
    for (let i = 0; i < 6; i++) start.view.animate(gliding, FREE_BABY, 10, life);
    // A positive pitch about X leans the top forward, toward +z; breathing and stoop are 0.
    expect(start.view.leanDeg).toBeGreaterThan(0);
    expect(spineUp(start.named).z).toBeGreaterThan(0);

    const turn = buildView();
    const north = papa({ headingX: 0, headingZ: 1 });
    turn.view.update(north, 1);
    turn.view.animate(north, FREE_BABY, 100, life);
    // Turning toward +x, his left: the body spring's velocity is positive, so the roll is negative
    // and the top of his torso leans toward +x.
    const east = papa({ headingX: 1, headingZ: 0 });
    turn.view.update(east, 1);
    for (let i = 0; i < 6; i++) turn.view.animate(east, FREE_BABY, 10, life);
    expect(turn.view.leanRollDeg).toBeLessThan(0);
    expect(spineUp(turn.named).x).toBeGreaterThan(0);
  });

  it('turns his head toward the baby he sees, within maxYawDeg, then ahead (D8)', () => {
    const { view, named } = buildView();
    view.update(papa(STILL_AT_0), 1);
    const life = createTestLife({ babyXM: 1, babyZM: 1, isMotionReduced: true });
    life.gazeSight.isBabyShown = true;
    view.animate(papa(STILL_AT_0), FREE_BABY, 3000, life);
    expect(view.gazeKind).toBe('baby');
    expect(view.headYawDeg).toBeCloseTo(45, 4);
    // A positive yaw about Y turns his head toward his left, +x (D3).
    expect(headForward(named).x).toBeGreaterThan(0);
    life.gazeSight.isBabyShown = false;
    view.animate(papa(STILL_AT_0), FREE_BABY, 3000, life);
    expect(view.gazeKind).toBe('ahead');
    expect(view.headYawDeg).toBeCloseTo(0, 4);
  });

  it('looks at the threat, not the baby, while he responds', () => {
    const { view } = buildView();
    view.update(papa(STILL_AT_0), 1);
    const life = createTestLife({ babyXM: 1, babyZM: 1, isResponding: true });
    life.gazeSight.isBabyShown = true;
    life.gazeSight.hasThreat = true;
    life.gazeSight.threatXM = -1;
    life.gazeSight.threatZM = 1;
    view.animate(papa(STILL_AT_0), FREE_BABY, 3000, life);
    expect(view.gazeKind).toBe('threat');
    expect(view.headYawDeg).toBeCloseTo(-45, 4);
  });

  it('starts at rest after a reset, and gives the same pose for the same frames (D12, the architecture test greps the rest)', () => {
    const run = () => {
      const { view, named } = buildView();
      view.update(papa({ headingX: 1, headingZ: 0 }), 1);
      const life = createTestLife({ fatigue: 40 });
      for (let i = 0; i < 37; i++) {
        view.animate(papa({ state: 'walkPath', xM: 2 + 0.01 * i }), FREE_BABY, 16, life);
      }
      return { view, spine: named('spine').quaternion.toArray(), yaw: view.bodyYawRad };
    };
    const a = run();
    const b = run();
    expect(b.spine).toEqual(a.spine);
    expect(b.yaw).toBe(a.yaw);
    a.view.resetAnimation();
    expect(a.view.leanDeg).toBe(0);
    expect(a.view.breathDeg).toBe(0);
    expect(a.view.headYawDeg).toBe(0);
  });
});

describe('his forelock (story 7.9, D7)', () => {
  const reachMs = LIFE.characters.forelock.reachMs;
  const maxDeg = LIFE.characters.forelock.maxDeg;
  const at = (xM: number, zM = 1) => papa({ xM, zM, prevXM: xM, prevZM: zM });
  /** Where the tip is drawn, in the world, and where a rigid lock would hold it. */
  const tips = (named: (name: string) => Object3D) => {
    named('papa_group').updateMatrixWorld(true);
    const drawn = named('papa_forelock_tip').getWorldPosition(new Vector3());
    // The lock's root is off the head's origin: the rigid tip is the root plus the marker, in the head's axes.
    const rigid = new Vector3(...TEST_FORELOCK_ROOT_M)
      .add(new Vector3(...TEST_FORELOCK_TIP_M))
      .applyMatrix4(named('head').matrixWorld);
    return { drawn, rigid };
  };
  /** Papa at x, his head still: frames of 10 ms for `ms`. */
  const hold = (
    view: ReturnType<typeof buildView>['view'],
    xM: number,
    ms: number,
    life = LIFE,
  ) => {
    view.update(at(xM), 1);
    for (let t = 0; t < ms; t += 10) view.animate(at(xM), FREE_BABY, 10, life);
  };

  it('rests on its first frame, with no swing', () => {
    const { view } = buildView();
    view.update(at(2), 1);
    view.animate(at(2), FREE_BABY, 10, LIFE);
    expect(view.forelockDeg).toBe(0);
  });

  it('trails a head that moves toward +x on the side of -x, then settles back to rest', () => {
    const { view, named } = buildView();
    hold(view, 2, 100);
    // A step of 2 cm: the swing stays under the cap, and its ring decays to under 2 % in five reach times.
    view.update(at(2.02), 1);
    view.animate(at(2.02), FREE_BABY, 30, LIFE);
    const { drawn, rigid } = tips(named);
    expect(view.forelockDeg).toBeGreaterThan(1);
    expect(view.forelockDeg).toBeLessThan(maxDeg);
    expect(drawn.x, 'the tip is left behind, toward -x').toBeLessThan(rigid.x);
    hold(view, 2.02, 5 * reachMs);
    expect(view.forelockDeg).toBeLessThan(0.5);
    // At rest the drawn tip is the rigid one, to the millimetre: no constant bias from a wrong frame or sign.
    const settled = tips(named);
    expect(settled.drawn.distanceTo(settled.rigid)).toBeLessThan(1e-3);
  });

  it('hangs on its rigid tip from the first frame, the lock root being off the head origin', () => {
    const { view, named } = buildView();
    hold(view, 2, 20);
    const { drawn, rigid } = tips(named);
    expect(drawn.distanceTo(rigid)).toBeLessThan(1e-6);
    expect(view.forelockDeg).toBe(0);
  });

  it('turns at most maxDeg, however far the head jumps', () => {
    const { view } = buildView();
    hold(view, 2, 100);
    let most = 0;
    view.update(at(7), 1);
    for (let i = 0; i < 30; i++) {
      view.animate(at(7), FREE_BABY, 10, LIFE);
      most = Math.max(most, view.forelockDeg);
    }
    expect(most).toBeGreaterThan(maxDeg - 1e-6);
    expect(most).toBeLessThanOrEqual(maxDeg + 1e-6);
  });

  it('does not swing when the room itself moves (a screen shake moves the scene he stands in)', () => {
    const { view, scene } = buildView();
    hold(view, 2, 100);
    scene.position.x += 0.3;
    for (let i = 0; i < 10; i++) view.animate(at(2), FREE_BABY, 10, LIFE);
    expect(view.forelockDeg).toBeLessThan(1e-6);
  });

  it('stays at rest under reduced motion', () => {
    const { view } = buildView();
    const reduced = createTestLife({ isMotionReduced: true });
    hold(view, 2, 100, reduced);
    view.update(at(3), 1);
    for (let i = 0; i < 10; i++) view.animate(at(3), FREE_BABY, 10, reduced);
    expect(view.forelockDeg).toBe(0);
  });

  it('holds on a dtMs of 0', () => {
    const { view } = buildView();
    hold(view, 2, 100);
    view.update(at(2.1), 1);
    view.animate(at(2.1), FREE_BABY, 40, LIFE);
    const swung = view.forelockDeg;
    expect(swung).toBeGreaterThan(0);
    view.animate(at(2.1), FREE_BABY, 0, LIFE);
    view.animate(at(2.1), FREE_BABY, 0, LIFE);
    expect(view.forelockDeg).toBe(swung);
  });

  it('starts at rest after a restart (and a replay moment) and after a return from away, wherever he is', () => {
    const restart = buildView();
    hold(restart.view, 2, 100);
    restart.view.resetAnimation();
    restart.view.update(at(5), 1);
    restart.view.animate(at(5), FREE_BABY, 10, LIFE);
    expect(restart.view.forelockDeg).toBe(0);

    const away = buildView();
    hold(away.view, 2, 100);
    away.view.setAway(true);
    away.view.setAway(true);
    away.view.update(at(5), 1);
    away.view.setAway(false);
    away.view.animate(at(5), FREE_BABY, 10, LIFE);
    expect(away.view.forelockDeg).toBe(0);
  });

  it('settles at rest under a held turn of the head: it follows the gaze, it does not stay behind', () => {
    const { view } = buildView();
    view.update(at(0, 0), 1);
    const life = createTestLife({ babyXM: 1, babyZM: 1 });
    life.gazeSight.isBabyShown = true;
    let most = 0;
    for (let i = 0; i < 300; i++) {
      view.animate(at(0, 0), FREE_BABY, 10, life);
      most = Math.max(most, view.forelockDeg);
    }
    expect(view.headYawDeg).toBeCloseTo(45, 1);
    expect(most, 'the turn swung it').toBeGreaterThan(0.5);
    expect(view.forelockDeg).toBeLessThan(0.5);
  });

  it('gives the same lock for the same frames', () => {
    const run = () => {
      const { view } = buildView();
      hold(view, 2, 50);
      for (let i = 0; i < 23; i++) {
        view.update(at(2 + 0.02 * i), 1);
        view.animate(at(2 + 0.02 * i), FREE_BABY, 16, LIFE);
      }
      return view.forelockDeg;
    };
    expect(run()).toBe(run());
  });
});

describe('his brows (story 7.10)', () => {
  const at = (xM: number, zM = 1) => papa({ xM, zM, prevXM: xM, prevZM: zM });
  const HALF_BAR_M = 0.035;
  const [RX, RY, RZ] = TEST_PAPA_BROW_REST_M;
  /** His face held at `expression` for `frames` frames of `dtMs`, the rest of the life layer busy. */
  const drive = (
    view: ReturnType<typeof buildView>['view'],
    expression: PapaFace,
    frames: number,
    dtMs: number,
    life = createTestLife({ fatigue: 80, isAlert: true, babyXM: 1, babyZM: 2 }),
  ) => {
    life.papaExpression = expression;
    for (let i = 0; i < frames; i++) {
      view.update(at(2), 1);
      view.animate(at(2), FREE_BABY, dtMs, life);
    }
    return life;
  };
  const snapshot = (named: (name: string) => Object3D) =>
    ['brow_l', 'brow_r'].flatMap((name) => [
      ...named(name).position.toArray(),
      ...named(name).quaternion.toArray(),
      ...named(name).scale.toArray(),
    ]);

  it('at neutral, both brows sit at their rest, at browScalePct', () => {
    const { view, named } = buildView();
    const life = drive(view, 'neutral', 30, 16);
    const scale = life.characters.expressions.papa.browScalePct / 100;
    expect(named('brow_l').position.toArray()).toEqual([RX, RY, RZ]);
    expect(named('brow_r').position.toArray()).toEqual([-RX, RY, RZ]);
    for (const name of ['brow_l', 'brow_r']) {
      expect(named(name).quaternion.toArray(), name).toEqual([0, 0, 0, 1]);
      expect(named(name).scale.toArray(), name).toEqual([scale, scale, scale]);
    }
    expect(view.browTiltDeg).toBe(0);
  });

  it.each(PAPA_EXPRESSIONS)('%s brings both brows to their rest plus its pose', (expression) => {
    const { view, named } = buildView();
    const life = drive(view, expression, 100, 10);
    const pose: BrowPose = life.characters.expressions.papa.poses[expression];
    const left = named('brow_l').position;
    const right = named('brow_r').position;
    expect(left.x).toBeCloseTo(RX - pose.inwardOffsetM, 9);
    expect(left.y).toBeCloseTo(RY + pose.raiseOffsetM + pose.skewOffsetM, 9);
    expect(right.x).toBeCloseTo(-RX + pose.inwardOffsetM, 9);
    expect(right.y).toBeCloseTo(RY + pose.raiseOffsetM - pose.skewOffsetM, 9);
    expect(left.z).toBe(RZ);
    expect(view.browTiltDeg).toBeCloseTo(pose.tiltDeg, 6);
  });

  it("pins the signs of D2 on world points of each brow's two ends", () => {
    const { view, named, scene } = buildView();
    const life = createTestLife();
    const poses = life.characters.expressions.papa.poses;
    const read = (pose: BrowPose) => {
      poses.firm = pose;
      drive(view, 'firm', 100, 10, life);
      scene.updateMatrixWorld(true);
      return {
        l: browEndsInHead(named('head'), named('brow_l'), HALF_BAR_M),
        r: browEndsInHead(named('head'), named('brow_r'), HALF_BAR_M),
      };
    };
    const zero = { raiseOffsetM: 0, tiltDeg: 0, inwardOffsetM: 0, skewOffsetM: 0 };
    const tilted = read({ ...zero, tiltDeg: 20 });
    for (const side of [tilted.l, tilted.r])
      expect(side.inner.y).toBeGreaterThan(side.outer.y + 0.01);
    const frown = read({ ...zero, tiltDeg: -20 });
    for (const side of [frown.l, frown.r]) expect(side.inner.y).toBeLessThan(side.outer.y - 0.01);
    const knot = read({ ...zero, inwardOffsetM: 0.01 });
    expect(knot.l.centre.x).toBeCloseTo(RX - 0.01, 9);
    expect(knot.r.centre.x).toBeCloseTo(-RX + 0.01, 9);
    const cocked = read({ ...zero, skewOffsetM: 0.01 });
    // His left brow is `brow_l`, at +x in his head's axes: it goes up.
    expect(cocked.l.centre.x).toBeGreaterThan(0);
    expect(cocked.l.centre.y).toBeCloseTo(RY + 0.01, 9);
    expect(cocked.r.centre.y).toBeCloseTo(RY - 0.01, 9);
    const raised = read({ ...zero, raiseOffsetM: 0.02 });
    expect(raised.l.centre.y).toBeCloseTo(RY + 0.02, 9);
    expect(raised.r.centre.y).toBeCloseTo(RY + 0.02, 9);
  });

  it('no expression moves his lids or his eyes (AC 4)', () => {
    for (const expression of PAPA_EXPRESSIONS) {
      const { view, named } = buildView();
      const eyes = named('eyes');
      const eyesBefore = [
        ...eyes.position.toArray(),
        ...eyes.quaternion.toArray(),
        ...eyes.scale.toArray(),
      ];
      drive(view, expression, 60, 16);
      expect(view.eyelidsPct, expression).toBe(0);
      expect(named('eyelids').scale.y, expression).toBe(EYELIDS_OPEN_SCALE);
      expect([
        ...eyes.position.toArray(),
        ...eyes.quaternion.toArray(),
        ...eyes.scale.toArray(),
      ]).toEqual(eyesBefore);
    }
  });

  it('gives the same pose under reduced motion', () => {
    const a = buildView();
    const b = buildView();
    drive(a.view, 'tired', 40, 16);
    drive(b.view, 'tired', 40, 16, createTestLife({ fatigue: 80, isMotionReduced: true }));
    expect(snapshot(b.named)).toEqual(snapshot(a.named));
  });

  it('snaps on the first frame, and resetAnimation puts them at rest at once', () => {
    const { view, named } = buildView();
    drive(view, 'surprised', 1, 16);
    const pose = createTestLife().characters.expressions.papa.poses.surprised;
    expect(view.browTiltDeg).toBe(pose.tiltDeg);
    view.resetAnimation();
    expect(view.browTiltDeg).toBe(0);
    expect(named('brow_l').position.toArray()).toEqual([RX, RY, RZ]);
    expect(named('brow_l').quaternion.toArray()).toEqual([0, 0, 0, 1]);
    // The first frame after it snaps on the expression, with no blend (D9).
    drive(view, 'firm', 1, 16);
    expect(view.browTiltDeg).toBe(createTestLife().characters.expressions.papa.poses.firm.tiltDeg);
  });

  it('gives the same brows for 1, 3 or 7 frames over the same span', () => {
    const run = (frames: number) => {
      const { view, named } = buildView();
      drive(view, 'neutral', 1, 16);
      drive(view, 'proud', frames, 63 / frames);
      return snapshot(named);
    };
    const one = run(1);
    for (const frames of [3, 7]) {
      const many = run(frames);
      for (const [i, value] of many.entries()) expect(value).toBeCloseTo(one[i] as number, 9);
    }
  });
});

describe('his first wave: start, brake, tiptoe, cheeks, idles (story 7.11)', () => {
  /** One view and one life, driven frame by frame on the sim's step clock. */
  function stage(patch: Partial<LifeInputs> = {}) {
    const built = buildView();
    const life = createTestLife({ levelSeed: 1, ...patch });
    let simMs = 0;
    /** Frames of `dtMs` until `untilMs`, Papa as `p` (his `enteredAt` included), recording each new acting clip. */
    const run = (
      p: PapaSlice,
      untilMs: number,
      dtMs = 10,
      baby: BabySlice = FREE_BABY,
    ): { atMs: number; clip: string }[] => {
      const started: { atMs: number; clip: string }[] = [];
      let last = built.view.actingClip;
      while (simMs < untilMs) {
        simMs = Math.min(untilMs, simMs + dtMs);
        life.simMs = simMs;
        built.view.update(p, 1);
        built.view.animate(p, baby, dtMs, life);
        const now = built.view.actingClip;
        if (now !== null && now !== last) started.push({ atMs: simMs, clip: now });
        last = now;
      }
      return started;
    };
    const frame = (p: PapaSlice, dtMs = 10, baby: BabySlice = FREE_BABY): void => {
      simMs += dtMs;
      life.simMs = simMs;
      built.view.animate(p, baby, dtMs, life);
    };
    return { ...built, life, run, frame, now: () => simMs };
  }
  const at = (state: PapaSlice['state'], enteredAt: number) =>
    papa({ state, enteredAt: asSimMs(enteredAt) });

  /** The slots a still spell begun at `stillSinceAt` has up to `untilMs`, for the stage's seed. */
  const slotsUntil = (stillSinceAt: number, untilMs: number, life: LifeInputs) => {
    const slots: { startAt: number; clip: string }[] = [];
    const slot = createIdleSlot();
    for (let t = stillSinceAt; t <= untilMs; t += 10) {
      idleSlotAt(
        life.levelSeed,
        PAPA_IDLE_SALT,
        stillSinceAt,
        t,
        life.characters.idles,
        PAPA_IDLE_CLIPS.length,
        slot,
      );
      if (slot.index >= 0 && slots.length === slot.index) {
        slots.push({ startAt: slot.startAt, clip: PAPA_IDLE_CLIPS[slot.variant] as string });
      }
    }
    return slots;
  };

  describe('the start and the brake (D3, D4)', () => {
    it('starts a walk with walk_start after he stood still long enough, fading in over startMs', () => {
      const { run, frame, view, rig, life } = stage();
      run(at('idle', 0), 1000);
      frame(at('walkPath', 1000), 0);
      expect(view.clipName).toBe('walk_start');
      expect(view.actingClip).toBe('walk_start');
      frame(at('walkPath', 1000), life.characters.fades.startMs / 2);
      expect(rig.weightOf('walk_start')).toBeGreaterThan(0);
      expect(rig.weightOf('walk_start')).toBeLessThan(1);
    });

    it('starts none after a stop shorter than startMinStillMs', () => {
      const { run, frame, view, life } = stage();
      run(at('walkPath', 0), 1000);
      const shortMs = life.characters.startStop.startMinStillMs - 10;
      run(at('idle', 1000), 1000 + shortMs);
      frame(at('walkPath', 1000 + shortMs), 10);
      expect(view.clipName).toBe('walk');
    });

    it('brakes a walk into idle with walk_stop, and none after a walk shorter than brakeMinTravelMs', () => {
      const long = stage();
      long.run(at('idle', 0), 1000);
      long.run(at('walkPath', 1000), 2000);
      long.frame(at('idle', 2000));
      expect(long.view.clipName).toBe('walk_stop');
      const short = stage();
      short.run(at('idle', 0), 1000);
      const walkMs = short.life.characters.startStop.brakeMinTravelMs - 10;
      short.run(at('walkPath', 1000), 1000 + walkMs);
      short.frame(at('idle', 1000 + walkMs));
      expect(short.view.clipName).toBe('idle');
    });

    it('plays none into a pick-up, out of a glide, carrying the baby, in the guard or under reduced motion', () => {
      const cases: [string, Partial<LifeInputs>, PapaSlice['state'], BabySlice][] = [
        ['a pick-up', {}, 'pickingUp', FREE_BABY],
        ['carrying', {}, 'idle', CARRIED_BABY],
        ['the guard', { isSignalOnly: true }, 'idle', FREE_BABY],
        ['reduced motion', { isMotionReduced: true }, 'idle', FREE_BABY],
      ];
      for (const [name, patch, arrival, baby] of cases) {
        const { run, frame, view } = stage(patch);
        run(at('idle', 0), 1000, 10, baby);
        run(at('walkPath', 1000), 2000, 10, baby);
        expect(view.actingClip, `${name}: start`).toBeNull();
        frame(at(arrival, 2000), 10, baby);
        expect(view.actingClip, `${name}: brake`).toBeNull();
      }
      const glide = stage();
      glide.run(at('idle', 0), 1000);
      glide.run(at('glide', 1000), 1500);
      expect(glide.view.actingClip).toBeNull();
      glide.frame(at('idle', 1500));
      expect(glide.view.actingClip).toBeNull();
    });

    it('moves him nowhere: his drawn position is the sim’s, start or not', () => {
      const { view, frame, run } = stage();
      run(at('idle', 0), 1000);
      const walking = papa({ state: 'walkPath', enteredAt: asSimMs(1000), xM: 3, prevXM: 2.97 });
      view.update(walking, 0.5);
      frame(walking);
      expect(view.clipName).toBe('walk_start');
      expect(view.pose.xM).toBeCloseTo(2.985, 9);
    });
  });

  describe('the tiptoe and the cheeks (D5, D6)', () => {
    it('walks on tiptoe in a stealth step, with no start, and nothing tiptoes outside one', () => {
      const stealth = stage({ isStealth: true, isSignalOnly: true });
      stealth.run(at('idle', 0), 1000);
      stealth.frame(at('walkPath', 1000));
      expect(stealth.view.clipName).toBe('tiptoe');
      const plain = stage();
      plain.run(at('walkPath', 0), 3000);
      expect(plain.view.clipName).toBe('walk');
    });

    it('puffs his cheeks while he holds his breath, under reduced motion too, and only then', () => {
      const { view, frame, life, named } = stage({ isStealth: true, isSignalOnly: true });
      frame(at('walkPath', 0));
      expect(view.isCheeksShown).toBe(false);
      expect(isShown(named('papa_cheeks'))).toBe(false);
      life.isBreathHeld = true;
      frame(at('walkPath', 0));
      expect(view.isCheeksShown).toBe(true);
      expect(isShown(named('papa_cheeks'))).toBe(true);
      life.isMotionReduced = true;
      frame(at('walkPath', 0));
      expect(view.isCheeksShown).toBe(true);
      life.isBreathHeld = false;
      frame(at('walkPath', 0));
      expect(isShown(named('papa_cheeks'))).toBe(false);
    });

    it('hangs the cheeks on his head', () => {
      const { named } = stage();
      expect(named('papa_cheeks').parent?.name).toBe('head');
    });
  });

  describe('the idles (D8, D9)', () => {
    it('plays each slot of the seed in the frame that reaches it, the variant it draws', () => {
      const { run, life } = stage();
      const played = run(at('idle', 0), 40_000);
      const slots = slotsUntil(0, 40_000, life);
      expect(slots.length).toBeGreaterThanOrEqual(5);
      expect(played.map((p) => p.clip)).toEqual(slots.map((s) => s.clip));
      for (const [i, p] of played.entries()) {
        const slotAt = (slots[i] as { startAt: number }).startAt;
        expect(p.atMs).toBeGreaterThanOrEqual(slotAt);
        expect(p.atMs - slotAt).toBeLessThan(10);
      }
      expect((played[0] as { atMs: number }).atMs).toBeGreaterThanOrEqual(
        life.characters.idles.firstAfterMs,
      );
    });

    it('plays the same idles at the same slots for 1, 3 or 7 frames over the same span', () => {
      const runOf = (dtMs: number) => {
        const { run } = stage();
        return run(at('idle', 0), 42_000, dtMs).map((p) => p.clip);
      };
      const one = runOf(10);
      expect(runOf(30)).toEqual(one);
      expect(runOf(70)).toEqual(one);
    });

    it('starts nothing on a dtMs of 0, and the slot is seen by the next frame that moves', () => {
      const { run, frame, view, life } = stage();
      run(at('idle', 0), 3990);
      life.simMs = 4500;
      view.animate(at('idle', 0), FREE_BABY, 0, life);
      expect(view.actingClip).toBeNull();
      frame(at('idle', 0), 10);
      expect(view.actingClip).not.toBeNull();
    });

    it('starts none in the first frame after a restart, and resetAnimation cuts the one under way', () => {
      const { run, view, life } = stage();
      run(at('idle', 0), 4100);
      expect(view.actingClip).not.toBeNull();
      view.resetAnimation();
      expect(view.actingClip).toBeNull();
      expect(view.clipName).toBeNull();
      // A replay of the same moment: the slot of 4000 ms is behind the first frame, so it shows nothing.
      life.simMs = 4110;
      view.animate(at('idle', 0), FREE_BABY, 16, life);
      expect(view.actingClip).toBeNull();
    });

    it.each([
      ['in the guard (a duel or stealth step)', { isSignalOnly: true }, 'idle', FREE_BABY],
      ['under reduced motion', { isMotionReduced: true }, 'idle', FREE_BABY],
      ['with the baby in his arms', {}, 'idle', CARRIED_BABY],
      ['at a chore station', {}, 'chore', FREE_BABY],
    ] as const)('plays none %s', (_name, patch, state, baby) => {
      const { run, view } = stage(patch);
      expect(run(at(state, 0), 30_000, 10, baby)).toEqual([]);
      expect(view.actingClip).toBeNull();
    });

    it.each([
      ['the guard begins', (life: LifeInputs) => Object.assign(life, { isSignalOnly: true })],
      ['motion is reduced', (life: LifeInputs) => Object.assign(life, { isMotionReduced: true })],
    ])('cuts the idle under way when %s', (_name, change) => {
      const { run, frame, view, life } = stage();
      run(at('idle', 0), 4100);
      expect(view.actingClip).not.toBeNull();
      change(life);
      frame(at('idle', 0));
      expect(view.actingClip).toBeNull();
      expect(view.clipName).toBe('idle');
    });

    it('cuts the idle under way when the baby is picked up, and when Papa leaves `idle` on the same loop', () => {
      const carried = stage();
      carried.run(at('idle', 0), 4100);
      carried.frame(at('idle', 0), 10, CARRIED_BABY);
      expect(carried.view.actingClip).toBeNull();
      expect(carried.view.clipName).toBe('carry_idle');
      const picking = stage();
      picking.run(at('idle', 0), 4100);
      picking.frame(at('pickingUp', 4100));
      expect(picking.view.actingClip).toBeNull();
      // A pick-up has its own gesture since story 7.12 (D3): the idle gives way to it.
      expect(picking.view.clipName).toBe('pick_up');
    });

    it('skips a slot that comes while another one-shot plays, and the next comes on time', () => {
      const { run, view, life } = stage();
      const slots = slotsUntil(0, 30_000, life);
      const first = slots[0] as { startAt: number };
      run(at('idle', 0), first.startAt - 50);
      view.playOnce('coffee_kick', 100);
      const played = run(at('idle', 0), 30_000);
      expect(played.map((p) => p.clip)).toEqual(slots.slice(1).map((s) => s.clip));
    });

    it('cuts an idle at once on cutActing, the idle loop fading in over otherMs', () => {
      const { run, view, rig, frame, life } = stage();
      life.characters.fades.otherMs = 200;
      life.characters.fades.startMs = 40;
      run(at('idle', 0), 4100);
      const idle = view.actingClip as string;
      view.cutActing(life.characters.fades);
      expect(view.clipName).toBe('idle');
      expect(view.actingClip).toBeNull();
      frame(at('idle', 0), 100);
      expect(rig.weightOf('idle')).toBeGreaterThan(0);
      expect(rig.weightOf('idle')).toBeLessThan(1);
      expect(rig.weightOf(idle)).toBeGreaterThan(0);
    });

    it('cuts a start at once on cutActing, the walk fading in over startMs', () => {
      const { run, view, rig, frame, life } = stage();
      life.characters.fades.otherMs = 200;
      life.characters.fades.startMs = 40;
      run(at('idle', 0), 1000);
      frame(at('walkPath', 1000));
      expect(view.actingClip).toBe('walk_start');
      view.cutActing(life.characters.fades);
      expect(view.clipName).toBe('walk');
      frame(at('walkPath', 1000), 50);
      expect(rig.weightOf('walk')).toBe(1);
    });

    it('cuts an idle on a change of loop, which may then start a walk', () => {
      const { run, frame, view } = stage();
      run(at('idle', 0), 4100);
      const idle = view.actingClip;
      expect(idle).not.toBeNull();
      frame(at('walkPath', 4110));
      expect(view.clipName).not.toBe(idle);
      expect(view.clipName).toBe('walk_start');
    });

    it('leaves an event one-shot alone: cutActing cuts only an acting one', () => {
      const { view, frame, life } = stage();
      frame(at('idle', 0));
      view.playOnce('coffee_kick', 100);
      view.cutActing(life.characters.fades);
      expect(view.clipName).toBe('coffee_kick');
    });
  });
});

describe('the second half of his first wave: stir, pick-up, sigh (story 7.12)', () => {
  /** Papa standing still at (1, 1): no travel, so the loops play at their own pace. */
  const still = (patch: Partial<PapaSlice> = {}) =>
    papa({ xM: 1, zM: 1, prevXM: 1, prevZM: 1, ...patch });

  it("plays the station's loop at a chore, and idle at a station that has none (D2)", () => {
    const { view } = buildView();
    const life = createTestLife({ papaChoreClip: 'stir_pot' });
    view.update(still({ state: 'chore' }), 1);
    view.animate(still({ state: 'chore' }), FREE_BABY, 10, life);
    expect(view.clipName).toBe('stir_pot');
    const dishwasher = buildView();
    const none = createTestLife({ papaChoreClip: null });
    dishwasher.view.update(still({ state: 'chore' }), 1);
    dishwasher.view.animate(still({ state: 'chore' }), FREE_BABY, 10, none);
    expect(dishwasher.view.clipName).toBe('idle');
  });

  /**
   * The pick-up's own progress after `elapsedMs` of a `spanMs` busy span: a fixture whose `pick_up` (1 s) moves
   * the pelvis from x 0 to 1, which no other clip keys, so its value is the clip's played share.
   */
  const pickUpShareAfter = (spanMs: number, elapsedMs: number): number => {
    const { view, rig } = buildView(0.25, (asset) => {
      const index = asset.animations.findIndex((clip) => clip.name === 'pick_up');
      asset.animations[index] = new AnimationClip('pick_up', 1, [
        new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 0, 0, 1, 0, 0]),
      ]);
    });
    const life = createTestLife();
    const p = still({ state: 'pickingUp', enteredAt: asSimMs(0), busyUntil: asSimMs(spanMs) });
    view.update(p, 1);
    for (let t = 0; t < elapsedMs; t += 10) view.animate(p, FREE_BABY, 10, life);
    expect(view.clipName).toBe('pick_up');
    expect(rig.durationMsOf('pick_up')).toBe(1000);
    return rig.node('pelvis').position.x;
  };

  it('plays one cycle of the pick-up over the sim busy span (D3)', () => {
    // A 1,000 ms clip over a 1,000 ms span: halfway at 500 ms; over 2,000 ms, a quarter.
    expect(pickUpShareAfter(1000, 500)).toBeCloseTo(0.5, 1);
    expect(pickUpShareAfter(2000, 500)).toBeCloseTo(0.25, 1);
    expect(pickUpShareAfter(2000, 1500)).toBeCloseTo(0.75, 1);
  });

  it('plays the sigh as an acting one-shot, and a tap, a state change or the baby in his arms cuts it', () => {
    const fades = createTestLife().characters.fades;
    const cases: [string, (b: ReturnType<typeof buildView>) => void][] = [
      ['a tap', (b) => b.view.cutActing(fades)],
      ['a state change', (b) => b.view.animate(still({ state: 'walkPath' }), FREE_BABY, 10, LIFE)],
      ['the baby in his arms', (b) => b.view.animate(still(), CARRIED_BABY, 10, LIFE)],
      [
        'the guard',
        (b) => b.view.animate(still(), FREE_BABY, 10, createTestLife({ isSignalOnly: true })),
      ],
    ];
    for (const [name, cut] of cases) {
      const b = buildView();
      b.view.update(still(), 1);
      b.view.animate(still(), FREE_BABY, 10, LIFE);
      b.view.playActing('sigh_relief', fades.otherMs);
      b.view.animate(still(), FREE_BABY, 10, LIFE);
      expect(b.view.actingClip, name).toBe('sigh_relief');
      expect(b.view.clipName, name).toBe('sigh_relief');
      cut(b);
      expect(b.view.actingClip, name).toBeNull();
      expect(b.view.clipName, name).not.toBe('sigh_relief');
    }
  });

  it('keeps the sigh under reduced motion: a reaction carries a clip, as a response pose does', () => {
    const { view } = buildView();
    const reduced = createTestLife({ isMotionReduced: true });
    view.update(still(), 1);
    view.animate(still(), FREE_BABY, 10, reduced);
    view.playActing('sigh_relief', reduced.characters.fades.otherMs);
    view.animate(still(), FREE_BABY, 10, reduced);
    expect(view.actingClip).toBe('sigh_relief');
    expect(view.oneShotName).toBe('sigh_relief');
  });
});
