import { asSimMs } from '@shared/time';
import type { PapaSlice } from '@sim';
import { type Box3, Mesh, type Object3D, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createBlobKit } from '../blobShadow.ts';
import { PALETTE } from '../materials/palette.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { createPapaView, PAPA_HEIGHT_M, type PapaPose, papaPoseAt } from './papaView.ts';

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

describe('createPapaView', () => {
  function build(radiusM = 0.25) {
    const scene = new Scene();
    const toon = createToonMaterialCache();
    const blobs = createBlobKit();
    const view = createPapaView(scene, toon, blobs, radiusM);
    return { scene, toon, blobs, view };
  }

  it('adds a cube 2 × radius wide and a flat shadow, two meshes in all', () => {
    const { scene } = build(0.25);
    const meshes: Mesh[] = [];
    scene.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    // The hair (hidden spikes) comes with the cube: it is not a draw call until a gag raises it.
    expect(
      meshes
        .filter((m) => isShown(m))
        .map((m) => m.name)
        .sort(),
    ).toEqual(['blob_papa', 'papa']);
    const cube = scene.getObjectByName('papa') as Mesh;
    cube.geometry.computeBoundingBox();
    const size = cube.geometry.boundingBox?.getSize(new Vector3());
    // Float32 vertex data: millimetre precision is plenty.
    expect(size?.x).toBeCloseTo(0.5, 5);
    expect(size?.z).toBeCloseTo(0.5, 5);
    expect(size?.y).toBeCloseTo(PAPA_HEIGHT_M, 5);
  });

  it('is drawn in the palette, with a shared toon material, not in a signal colour', () => {
    const { scene, toon } = build();
    const cube = scene.getObjectByName('papa') as Mesh;
    expect((cube.material as unknown as { color: { getHex(): number } }).color.getHex()).toBe(
      PALETTE.primary,
    );
    expect(toon.size).toBe(3); // the cube, the ink (hair, eyelids, « Z ») and the paper of the mug
  });

  it('puts the cube on the floor at the interpolated position, turned toward where he walks', () => {
    const { scene, view } = build();
    view.update(papa({ headingX: 1, headingZ: 0 }), 0.5);
    const group = scene.getObjectByName('papa_group');
    const cube = scene.getObjectByName('papa') as Mesh;
    expect(group?.position.toArray()).toEqual([1.5, 0, 1]);
    expect(cube.position.y).toBe(PAPA_HEIGHT_M / 2);
    expect(cube.rotation.y).toBeCloseTo(Math.PI / 2, 12);
  });

  it('the shadow follows his position but does not turn or rise', () => {
    const { scene, view } = build();
    view.update(papa({ headingX: 1, headingZ: 0 }), 1);
    const shadow = scene.getObjectByName('blob_papa') as Mesh;
    scene.updateMatrixWorld(true);
    expect(shadow.rotation.y).toBe(0);
    expect(shadow.position.y).toBeGreaterThan(0);
    expect(shadow.position.y).toBeLessThan(0.05);
    expect(shadow.getWorldPosition(new Vector3()).x).toBe(2);
    expect(shadow.scale.x).toBeGreaterThan(0.5);
  });

  it('keeps the hair hidden until it is raised, scales it with the amount and clamps it', () => {
    const { scene, view } = build();
    const hair = scene.getObjectByName('papa_hair');
    const spikes = hair?.children ?? [];
    expect(spikes.length).toBeGreaterThan(1);
    expect(hair?.visible).toBe(false);
    view.setHair(0.5);
    expect(hair?.visible).toBe(true);
    expect(hair?.scale.y).toBe(0.5);
    view.setHair(7);
    expect(hair?.scale.y).toBe(1);
    view.setHair(-3);
    expect(hair?.visible).toBe(false);
  });

  it('puts the hair on top of the cube, over its width, with one shared geometry', () => {
    const { scene } = build(0.25);
    const hair = scene.getObjectByName('papa_hair');
    expect(hair?.position.y).toBe(PAPA_HEIGHT_M);
    const geometries = new Set((hair?.children ?? []).map((spike) => (spike as Mesh).geometry));
    expect(geometries.size).toBe(1);
    for (const spike of hair?.children ?? []) {
      expect(Math.abs(spike.position.x)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(spike.position.z)).toBeLessThanOrEqual(0.25);
    }
  });

  it('tolerates a feel with no radius, and disposes by taking Papa out of the scene', () => {
    const { scene, view } = build(0);
    view.update(papa(), 0);
    expect(scene.getObjectByName('papa')).toBeDefined();
    view.dispose();
    expect(scene.getObjectByName('papa')).toBeUndefined();
  });
});

describe('the nap and the coffee (story 1.19)', () => {
  function build() {
    const scene = new Scene();
    const view = createPapaView(scene, createToonMaterialCache(), createBlobKit(), 0.25);
    return { scene, view, named: (name: string) => scene.getObjectByName(name) as Object3D };
  }

  it('draws nothing of it by default: no eyelids, no « Z », no mug (they are hidden at rest)', () => {
    const { named } = build();
    for (const name of ['papa_eyelids', 'papa_z', 'papa_mug']) {
      expect(isShown(named(name)), name).toBe(false);
    }
  });

  it('lowers the eyelids with the amount: hidden at 0, scaled down from the top, clamped', () => {
    const { view, named } = build();
    view.setEyelids(0.5);
    expect(isShown(named('papa_eyelids'))).toBe(true);
    expect(named('papa_eyelids').scale.y).toBe(0.5);
    view.setEyelids(7);
    expect(named('papa_eyelids').scale.y).toBe(1);
    view.setEyelids(-1);
    expect(isShown(named('papa_eyelids'))).toBe(false);
  });

  it('puts the eyelids on the cube, so they turn with his heading', () => {
    const { scene, view, named } = build();
    view.update(papa({ headingX: 1, headingZ: 0 }), 1);
    const cube = scene.getObjectByName('papa') as Mesh;
    expect(named('papa_eyelids').parent).toBe(cube);
    expect(named('papa_mug').parent).toBe(cube);
  });

  it('shuts the eyelids and floats a « Z » while he sleeps, and puts them away when he wakes', () => {
    const { view, named } = build();
    view.setEyelids(0.2);
    view.setAsleep(true, 0);
    expect(isShown(named('papa_z'))).toBe(true);
    expect(named('papa_eyelids').scale.y).toBe(1);
    const restY = named('papa_z').position.y;
    view.setAsleep(true, 300);
    expect(named('papa_z').position.y).not.toBe(restY);
    view.setAsleep(false, 600);
    expect(isShown(named('papa_z'))).toBe(false);
    // Back to what the telegraph asks for: the amount set before.
    expect(named('papa_eyelids').scale.y).toBe(0.2);
  });

  it('shows the mug while he drinks', () => {
    const { view, named } = build();
    view.setDrinking(true);
    expect(isShown(named('papa_mug'))).toBe(true);
    view.setDrinking(false);
    expect(isShown(named('papa_mug'))).toBe(false);
  });

  it('shows the handset while he is on the phone', () => {
    const { view, named } = build();
    expect(isShown(named('papa_handset'))).toBe(false);
    view.setOnPhone(true);
    expect(isShown(named('papa_handset'))).toBe(true);
    view.setOnPhone(false);
    expect(isShown(named('papa_handset'))).toBe(false);
  });

  it('holds the handset against the side of his head: touching the cube, and not above it', () => {
    const { named } = build();
    const cube = named('papa') as Mesh;
    const handset = named('papa_handset') as Mesh;
    cube.geometry.computeBoundingBox();
    handset.geometry.computeBoundingBox();
    const head = cube.geometry.boundingBox as Box3;
    const held = (handset.geometry.boundingBox as Box3).clone().translate(handset.position);
    // Float32 vertex data: a tenth of a millimetre is plenty.
    expect(held.max.x).toBeCloseTo(head.min.x, 4);
    expect(held.max.y).toBeLessThanOrEqual(head.max.y + 1e-4);
    expect(held.min.y).toBeGreaterThanOrEqual(head.min.y - 1e-4);
  });

  it('exposes the pose it drew, interpolated', () => {
    const { view } = build();
    view.update(papa(), 0.5);
    expect([view.pose.xM, view.pose.zM]).toEqual([1.5, 1]);
  });
});
