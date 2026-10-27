import { asSimMs } from '@shared/time';
import type { PapaSlice } from '@sim';
import { Mesh, type Object3D, Scene, Vector3 } from 'three';
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
    expect(toon.size).toBe(2); // the cube and the ink of the hair
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
