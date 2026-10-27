import { asSimMs } from '@shared/time';
import type { BabySlice } from '@sim';
import { Mesh, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createBlobKit } from '../blobShadow.ts';
import { PALETTE } from '../materials/palette.ts';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import { type BabyPose, babyPoseAt, createBabyView } from './babyView.ts';

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
  function build(radiusM = 0.2) {
    const scene = new Scene();
    const toon = createToonMaterialCache();
    const blobs = createBlobKit();
    const view = createBabyView(scene, toon, blobs, radiusM);
    return { scene, toon, blobs, view };
  }

  it('adds a sphere of the feel’s radius, a gaze marker and a flat shadow: three meshes', () => {
    const { scene } = build(0.2);
    const meshes: Mesh[] = [];
    scene.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    expect(meshes.map((m) => m.name).sort()).toEqual(['baby', 'baby_gaze', 'blob_baby']);
    const body = scene.getObjectByName('baby') as Mesh;
    body.geometry.computeBoundingBox();
    const size = body.geometry.boundingBox?.getSize(new Vector3());
    // A low-poly ball: its extent is the diameter on at least the axes of its vertices.
    expect(size?.y).toBeCloseTo(0.4, 5);
  });

  it('is white with an ink marker, from the shared toon cache', () => {
    const { scene, toon } = build();
    const hex = (name: string) =>
      (
        (scene.getObjectByName(name) as Mesh).material as unknown as {
          color: { getHex(): number };
        }
      ).color.getHex();
    expect(hex('baby')).toBe(PALETTE.paper);
    expect(hex('baby_gaze')).toBe(PALETTE.ink);
    expect(toon.size).toBe(2);
  });

  it('rests on the floor at the interpolated position', () => {
    const { scene, view } = build(0.2);
    view.update(baby(), 0.5);
    const group = scene.getObjectByName('baby_group');
    const body = scene.getObjectByName('baby') as Mesh;
    expect(group?.position.toArray()).toEqual([1.5, 0, 1]);
    expect(body.position.y).toBe(0.2);
  });

  it('turns only the gaze marker toward the gaze: the body and the shadow keep their orientation', () => {
    const { scene, view } = build();
    view.update(baby({ gazeX: 1, gazeZ: 0 }), 1);
    scene.updateMatrixWorld(true);
    expect((scene.getObjectByName('baby_gaze_group') as Mesh).rotation.y).toBeCloseTo(
      Math.PI / 2,
      12,
    );
    expect((scene.getObjectByName('baby') as Mesh).rotation.y).toBe(0);
    expect((scene.getObjectByName('blob_baby') as Mesh).rotation.y).toBe(0);
    // The marker points along +x once turned: its tip is further along x than the body's centre.
    const marker = (scene.getObjectByName('baby_gaze') as Mesh).getWorldPosition(new Vector3());
    expect(marker.x).toBeGreaterThan(2);
    expect(marker.z).toBeCloseTo(1, 12);
  });

  it('lifts the body and its gaze marker, not the shadow, and puts them back', () => {
    const { scene, view } = build(0.2);
    view.update(baby(), 1);
    view.setLiftM(0.3);
    const body = scene.getObjectByName('baby') as Mesh;
    const gazeGroup = scene.getObjectByName('baby_gaze_group') as Mesh;
    const shadowY = (scene.getObjectByName('blob_baby') as Mesh).position.y;
    expect(body.position.y).toBeCloseTo(0.5, 12);
    expect(gazeGroup.position.y).toBeCloseTo(0.5, 12);
    expect((scene.getObjectByName('blob_baby') as Mesh).position.y).toBe(shadowY);
    view.setLiftM(0);
    expect(body.position.y).toBe(0.2);
    expect(gazeGroup.position.y).toBe(0.2);
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

  it('tolerates a feel with no radius, and disposes its geometries and takes the baby out of the scene', () => {
    const { scene, view } = build(0);
    view.update(baby(), 0);
    const body = scene.getObjectByName('baby') as Mesh;
    const gaze = scene.getObjectByName('baby_gaze') as Mesh;
    let disposed = 0;
    body.geometry.addEventListener('dispose', () => disposed++);
    gaze.geometry.addEventListener('dispose', () => disposed++);
    view.dispose();
    expect(disposed).toBe(2);
    expect(scene.getObjectByName('baby')).toBeUndefined();
  });
});
