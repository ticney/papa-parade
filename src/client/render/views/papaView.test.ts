import { asSimMs } from '@shared/time';
import type { BabySlice, PapaSlice } from '@sim';
import { type Object3D, Scene, SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestPapa } from '../../../../tests/support/testCharacters.ts';
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
};
const FREE_BABY = { state: 'babble' } as BabySlice;
const CARRIED_BABY = { state: 'carried' } as BabySlice;

function buildView(radiusM = 0.25) {
  const scene = new Scene();
  const toon = createToonMaterialCache(TOON_TONES);
  const blobs = createBlobKit();
  const rig = createCharacterRig(
    createTestPapa(),
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
    view.setDrinking(true);
    expect(isShown(named('papa_mug'))).toBe(true);
    view.setDrinking(false);
    expect(isShown(named('papa_mug'))).toBe(false);
  });

  it('shows the handset while he is on the phone', () => {
    const { view, named } = buildView();
    expect(isShown(named('papa_handset'))).toBe(false);
    view.setOnPhone(true);
    expect(isShown(named('papa_handset'))).toBe(true);
    view.setOnPhone(false);
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
