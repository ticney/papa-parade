import { PROVISIONAL_ROOM_DEPTH_M, PROVISIONAL_ROOM_WIDTH_M, STEP_MS } from '@shared/constants';
import { createSim } from '@sim';
import { Mesh, type PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestContent, stepN } from '../../../tests/support/testContent.ts';
import { createProvisionalScene } from './provisionalScene.ts';

async function worldAfter(steps: number) {
  const sim = await createSim({ content: createTestContent(), seed: 1 });
  stepN(sim, steps);
  return sim.world;
}

describe('createProvisionalScene', () => {
  it('has a floor the size of the provisional room, a grid and a probe cube', () => {
    const { scene } = createProvisionalScene();
    const floor = scene.getObjectByName('floor');
    expect(floor).toBeInstanceOf(Mesh);
    expect(scene.getObjectByName('grid')).toBeDefined();
    expect(scene.getObjectByName('probe')).toBeInstanceOf(Mesh);
    const geometry = (floor as Mesh<PlaneGeometry>).geometry;
    expect(geometry.parameters.width).toBe(PROVISIONAL_ROOM_WIDTH_M);
    expect(geometry.parameters.height).toBe(PROVISIONAL_ROOM_DEPTH_M);
  });

  it('moves the probe with the sim clock and nothing else', async () => {
    const { scene, update } = createProvisionalScene();
    const probe = scene.getObjectByName('probe');
    const [at0, at25, at26] = await Promise.all([worldAfter(0), worldAfter(25), worldAfter(26)]);

    update(at0, 0);
    const startX = probe?.position.x;
    update(at25, 0);
    expect(probe?.position.x).not.toBe(startX);

    // The same continuous clock gives the same place, however it is split between step and alpha.
    update(at25, 1);
    const fromAlpha = probe?.position.x;
    update(at26, 0);
    expect(probe?.position.x).toBeCloseTo(fromAlpha as number, 9);
    update(at25, 0.5);
    const middle = probe?.position.x as number;
    update(at25, 0.5);
    expect(probe?.position.x).toBe(middle);
  });

  it('interpolates inside a step: alpha moves the probe by a fraction of one step', async () => {
    const { scene, update } = createProvisionalScene();
    const probe = scene.getObjectByName('probe');
    const [now, next] = await Promise.all([worldAfter(25), worldAfter(26)]);
    update(now, 0);
    const from = probe?.position.x as number;
    update(next, 0);
    const to = probe?.position.x as number;
    update(now, 0.5);
    const halfway = probe?.position.x as number;
    expect(STEP_MS).toBeGreaterThan(0);
    expect(Math.abs(halfway - from)).toBeLessThan(Math.abs(to - from) + 1e-9);
    expect(halfway).toBeCloseTo((from + to) / 2, 3);
  });

  it('keeps the probe on the floor and inside the room, and adds nothing per update', async () => {
    const { scene, update } = createProvisionalScene();
    const probe = scene.getObjectByName('probe') as Mesh;
    const childrenBefore = scene.children.length;
    for (const steps of [0, 77, 140, 333, 500, 1234, 4000]) {
      update(await worldAfter(steps), 0.3);
      expect(Math.abs(probe.position.x)).toBeLessThanOrEqual(PROVISIONAL_ROOM_WIDTH_M / 2);
      expect(Math.abs(probe.position.z)).toBeLessThanOrEqual(PROVISIONAL_ROOM_DEPTH_M / 2);
      expect(probe.position.y).toBeGreaterThanOrEqual(0);
    }
    expect(scene.children.length).toBe(childrenBefore);
  });
});
