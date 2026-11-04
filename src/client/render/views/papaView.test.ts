import { ISO_YAW_DEG } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { BabySlice, PapaSlice } from '@sim';
import { type Object3D, Scene, SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestPapa } from '../../../../tests/support/testCharacters.ts';
import type { CharacterAsset } from '../../assets/gltf.ts';
import { createBlobKit } from '../blobShadow.ts';
import { createOutlineKit } from '../materials/outlineHull.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { createCharacterRig } from './characterRig.ts';
import { createPapaView, type PapaPose, papaPoseAt } from './papaView.ts';

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

const CROSS_FADE_MS = 100;
const MOTION = {
  turnRateDegPerSec: 360,
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
    CROSS_FADE_MS,
    createOutlineKit({ widthM: 0.025, skipMaterials: ['art_ink'] }),
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
    view.animate(papa(), FREE_BABY, 10);
    expect(view.clipName).toBe('idle');
    view.animate(papa(), CARRIED_BABY, 10);
    expect(view.clipName).toBe('carry_idle');
    view.animate(papa({ state: 'walkPath' }), CARRIED_BABY, 10);
    expect(view.clipName).toBe('carry_walk');
    view.animate(papa({ state: 'onPhone' }), FREE_BABY, 10);
    expect(view.clipName).toBe('on_phone');
  });

  it('holds the mixer on a dt of 0', () => {
    const { view } = buildView();
    view.update(papa(), 1);
    view.animate(papa(), FREE_BABY, 200);
    const timeMs = view.mixerTimeMs;
    view.animate(papa(), FREE_BABY, 0);
    expect(view.mixerTimeMs).toBe(timeMs);
  });

  it('paces the walk clip by the floor speed read from the sim', () => {
    const { rig, view } = buildView();
    const action = (): number => rig.node('spine').position.y;
    view.update(papa({ state: 'walkPath', prevXM: 0, xM: 0.015 }), 1);
    // 0.015 m in a 10 ms step is 1.5 m/s, half the clip's 3 m/s.
    view.animate(papa({ state: 'walkPath', prevXM: 0, xM: 0.015 }), FREE_BABY, 400);
    expect(action()).toBeCloseTo(0.2, 5);
  });

  it("turns his body by the shortest arc at the turn rate, while the pose says the sim's heading at once", () => {
    const { view, named } = buildView();
    view.update(papa({ headingX: 0, headingZ: 1 }), 1);
    const east = papa({ headingX: 1, headingZ: 0 });
    view.update(east, 1);
    expect(view.pose.yawRad).toBeCloseTo(Math.PI / 2, 12);
    expect(named('papa').rotation.y).toBe(0);
    view.animate(east, FREE_BABY, 125); // 360 °/s for 125 ms is 45°
    expect(named('papa').rotation.y).toBeCloseTo(Math.PI / 4, 12);
    view.animate(east, FREE_BABY, 0);
    expect(named('papa').rotation.y).toBeCloseTo(Math.PI / 4, 12);
    view.animate(east, FREE_BABY, 1000);
    expect(named('papa').rotation.y).toBeCloseTo(Math.PI / 2, 12);
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
    view.animate(papa(), FREE_BABY, 100);
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
  const settle = (view: ReturnType<typeof buildView>['view'], p: PapaSlice, baby: BabySlice) => {
    view.animate(p, baby, 1000);
    view.animate(p, baby, 1000);
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
    view.playOnce('coffee_kick');
    view.animate(idle, FREE_BABY, 10);
    expect(view.clipName).toBe('coffee_kick');
    // 200 ms is more than the 125 ms the 45° take, and less than the fixture's 1 s clip.
    view.animate(idle, FREE_BABY, 200);
    expect(view.clipName).toBe('coffee_kick');
    expect(view.bodyYawRad).toBeCloseTo(CAMERA_YAW_RAD, 12);
  });

  it('turns at the turn rate, and a pause holds the turn', () => {
    const { view } = buildView();
    const drinking = papa({ state: 'drink', headingX: 0, headingZ: 1 });
    view.update(drinking, 1);
    view.animate(drinking, FREE_BABY, 0);
    expect(view.bodyYawRad).toBe(0);
    view.animate(drinking, FREE_BABY, 62.5); // 360 °/s for 62.5 ms is 22.5°
    expect(view.bodyYawRad).toBeCloseTo(CAMERA_YAW_RAD / 2, 12);
    view.animate(drinking, FREE_BABY, 0);
    expect(view.bodyYawRad).toBeCloseTo(CAMERA_YAW_RAD / 2, 12);
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
    view.animate(calling, { state: 'wander', xM: 9, zM: 9 } as BabySlice, 1000);
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
