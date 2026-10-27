import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { MS_PER_S, STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import { createTestLevelGeometry } from '../../../tests/support/testLevelGeometry.ts';
import type { PhysicsPort, PropPose } from './physicsPort.ts';
import { createRapierPhysics, initRapier, memoizeLoader } from './rapierPhysics.ts';

const physics = createTestContent().feel.physics;
const STEP_S = STEP_MS / MS_PER_S;

/** The tiny test room (bounds -2..2, 0..2.5, -1.5..1.5) with one mug at `yM`. */
function roomWith(yM: number, kind = 'mug'): LevelGeometry {
  const geometry = createTestLevelGeometry();
  geometry.props = [{ id: 'mug_01', kind, centerM: [0, yM, 0], halfExtentsM: [0.05, 0.05, 0.05] }];
  return geometry;
}

function poseOf(port: PhysicsPort, index = 0): PropPose {
  const pose: PropPose = { xM: 0, yM: 0, zM: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  port.readPose(index, pose);
  return pose;
}

function stepN(port: PhysicsPort, n: number): void {
  for (let i = 0; i < n; i++) port.step();
}

/** Every (prop, other, impulse) reported over `n` steps. */
function impactsOver(port: PhysicsPort, n: number) {
  const impacts: { step: number; propIndex: number; otherIndex: number; impulseNs: number }[] = [];
  for (let step = 0; step < n; step++) {
    port.step();
    port.forEachImpact((propIndex, otherIndex, impulseNs) => {
      impacts.push({ step, propIndex, otherIndex, impulseNs });
    });
  }
  return impacts;
}

describe('initRapier', () => {
  it('initialises once: every call returns the same promise', async () => {
    const first = initRapier();
    const second = initRapier();
    expect(second).toBe(first);
    expect(await first).toBe(await second);
  });
});

describe('memoizeLoader', () => {
  it('runs the loader once and shares its promise', async () => {
    let calls = 0;
    const load = memoizeLoader(async () => ++calls);
    expect(await Promise.all([load(), load()])).toEqual([1, 1]);
    expect(await load()).toBe(1);
    expect(calls).toBe(1);
  });

  it('does not remember a failure: the next call loads again', async () => {
    let calls = 0;
    const load = memoizeLoader(async () => {
      calls++;
      if (calls === 1) throw new Error('chunk fetch dropped');
      return 'loaded';
    });
    await expect(load()).rejects.toThrow('chunk fetch dropped');
    expect(await load()).toBe('loaded');
    expect(await load()).toBe('loaded');
    expect(calls).toBe(2);
  });
});

describe('createRapierPhysics', () => {
  it('steps by exactly one sim step: free fall for 0.5 s of steps is g·t²/2, not what a 1/60 s timestep gives', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(2.4), physics });
    stepN(port, 50);
    // Rapier's solver substeps the timestep, so the fall is the continuous one within 7 mm (the
    // measured gap); a default 1/60 s step would have fallen 3.47 m, a step of 0.0101 s 3 cm more.
    const fallenM = 0.5 * physics.gravityMps2 * (50 * STEP_S) ** 2;
    expect(Math.abs(2.4 - poseOf(port).yM - fallenM)).toBeLessThan(0.01);
    port.dispose();
  });

  it('builds one fixed collider per geometry collider, plus the floor, the four bounds walls and the ceiling', async () => {
    const geometry = roomWith(2);
    const port = await createRapierPhysics({ geometry, physics });
    expect(port.fixedColliderCount).toBe(geometry.colliders.length + 1 + 4 + 1);
    expect(port.propCount).toBe(1);
    port.dispose();
  });

  it('refuses a prop whose kind has no physics entry', async () => {
    await expect(
      createRapierPhysics({ geometry: roomWith(0.05, 'teapot'), physics }),
    ).rejects.toThrow('teapot');
  });

  it('reports one impact above the threshold for a prop dropped from 1 m, and none while it rests', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    const impacts = await impactsOver(port, 600);
    expect(impacts.length).toBeGreaterThanOrEqual(1);
    for (const impact of impacts) {
      expect(impact.impulseNs).toBeGreaterThanOrEqual(physics.impactMinImpulseNs);
      expect(impact.otherIndex).toBe(-1); // the floor
    }
    // The first impact is the fall; the prop sleeps well before 6 s, and nothing comes after.
    expect(impacts[0]?.impulseNs).toBeGreaterThan(physics.impactMinImpulseNs);
    expect(impacts.at(-1)?.step).toBeLessThan(300);
    expect(port.isSleeping(0)).toBe(true);
    expect(poseOf(port).yM).toBeCloseTo(0.05, 1);
    port.dispose();
  });

  it('puts a prop that starts on the floor to rest without a single impact', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(0.05), physics });
    expect(impactsOver(port, 500)).toEqual([]);
    expect(port.isSleeping(0)).toBe(true);
    port.dispose();
  });

  it('reports a contact between two props on both sides, with the partner index', async () => {
    const geometry = roomWith(0.05, 'vase');
    geometry.props = [
      { id: 'vase_01', kind: 'vase', centerM: [0, 0.05, 0], halfExtentsM: [0.05, 0.05, 0.05] },
      { id: 'mug_01', kind: 'mug', centerM: [0, 0.8, 0], halfExtentsM: [0.05, 0.05, 0.05] },
    ];
    const port = await createRapierPhysics({ geometry, physics });
    const impacts = impactsOver(port, 200);
    const mugOnVase = impacts.find((impact) => impact.propIndex === 1 && impact.otherIndex === 0);
    const vaseUnderMug = impacts.find(
      (impact) => impact.propIndex === 0 && impact.otherIndex === 1,
    );
    expect(mugOnVase).toBeDefined();
    expect(vaseUnderMug).toBeDefined();
    expect(vaseUnderMug?.step).toBe(mugOnVase?.step);
    expect(vaseUnderMug?.impulseNs).toBe(mugOnVase?.impulseNs);
    port.dispose();
  });

  it('visits the props in index order', async () => {
    const geometry = roomWith(0.05);
    geometry.props = [
      { id: 'mug_01', kind: 'mug', centerM: [-0.5, 0.6, 0], halfExtentsM: [0.05, 0.05, 0.05] },
      { id: 'mug_02', kind: 'mug', centerM: [0.5, 0.6, 0], halfExtentsM: [0.05, 0.05, 0.05] },
    ];
    const port = await createRapierPhysics({ geometry, physics });
    const order: number[] = [];
    for (let i = 0; i < 100; i++) {
      port.step();
      port.forEachImpact((propIndex) => order.push(propIndex));
    }
    expect(order.slice(0, 2)).toEqual([0, 1]);
    port.dispose();
  });

  it('applyImpulse wakes a sleeping body', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(0.05), physics });
    stepN(port, 500);
    expect(port.isSleeping(0)).toBe(true);
    const before = poseOf(port);
    port.applyImpulse(0, 0.3, 0, 0);
    expect(port.isSleeping(0)).toBe(false);
    stepN(port, 20);
    expect(poseOf(port).xM).toBeGreaterThan(before.xM);
    port.dispose();
  });

  it('keeps a prop pushed with the largest allowed impulse inside the room, whatever the direction', async () => {
    const maxNs = physics.maxPushImpulseNs;
    const [minX, , minZ] = createTestLevelGeometry().boundsMinM;
    const [maxX, maxY, maxZ] = createTestLevelGeometry().boundsMaxM;
    const directions: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0.6, 0.6, 0.529],
    ];
    for (const kind of Object.keys(physics.kinds)) {
      for (const [dx, dy, dz] of directions) {
        const port = await createRapierPhysics({ geometry: roomWith(1.2, kind), physics });
        port.applyImpulse(0, dx * maxNs, dy * maxNs, dz * maxNs);
        for (let i = 0; i < 400; i++) {
          port.step();
          const { xM, yM, zM } = poseOf(port);
          expect(xM, `${kind} ${dx} ${dy} ${dz} x`).toBeGreaterThan(minX);
          expect(xM, `${kind} ${dx} ${dy} ${dz} x`).toBeLessThan(maxX);
          expect(zM, `${kind} ${dx} ${dy} ${dz} z`).toBeGreaterThan(minZ);
          expect(zM, `${kind} ${dx} ${dy} ${dz} z`).toBeLessThan(maxZ);
          expect(yM, `${kind} ${dx} ${dy} ${dz} y`).toBeGreaterThan(0);
          expect(yM, `${kind} ${dx} ${dy} ${dz} y`).toBeLessThan(maxY);
        }
        port.dispose();
      }
    }
  });

  it('closes the room with a ceiling: a prop shot straight up comes back down', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(1.2), physics });
    // 12 m/s up would reach 7 m under gravity alone, in a room 2.5 m high.
    port.applyImpulse(0, 0.3 * 12, 0, 0);
    let highestM = 0;
    for (let i = 0; i < 300; i++) {
      port.step();
      highestM = Math.max(highestM, poseOf(port).yM);
    }
    expect(highestM).toBeLessThan(createTestLevelGeometry().boundsMaxM[1]);
    expect(poseOf(port).yM).toBeLessThan(1.2);
    port.dispose();
  });

  it('snapshot → restore → N steps gives the same poses as N steps without the round trip', async () => {
    const direct = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    const resumed = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    stepN(direct, 30);
    stepN(resumed, 30);
    const bytes = resumed.snapshot();
    stepN(resumed, 10); // diverge, then come back
    resumed.restore(bytes);
    expect(poseOf(resumed)).toEqual(poseOf(direct));
    stepN(direct, 120);
    stepN(resumed, 120);
    expect(poseOf(resumed)).toEqual(poseOf(direct));
    direct.dispose();
    resumed.dispose();
  });

  it('restores a snapshot into another port built from the same level', async () => {
    const first = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    const second = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    stepN(first, 40);
    second.restore(first.snapshot());
    stepN(first, 100);
    stepN(second, 100);
    expect(poseOf(second)).toEqual(poseOf(first));
    first.dispose();
    second.dispose();
  });

  it('refuses garbage and a snapshot of another level, and keeps running as before', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    stepN(port, 20);
    const before = poseOf(port);
    expect(() => port.restore(new Uint8Array(0))).toThrow();
    expect(() => port.restore(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
    const otherGeometry = roomWith(1.05);
    otherGeometry.props = [];
    const other = await createRapierPhysics({ geometry: otherGeometry, physics });
    expect(() => port.restore(other.snapshot())).toThrow('does not fit');
    expect(poseOf(port)).toEqual(before);
    port.step();
    expect(poseOf(port).yM).toBeLessThan(before.yM);
    other.dispose();
    port.dispose();
  });

  it('throws on any call after dispose, and disposing twice is fine', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    port.dispose();
    port.dispose();
    expect(() => port.step()).toThrow('disposed');
    expect(() => port.applyImpulse(0, 1, 0, 0)).toThrow('disposed');
    expect(() => port.isSleeping(0)).toThrow('disposed');
    expect(() => poseOf(port)).toThrow('disposed');
    expect(() => port.forEachImpact(() => {})).toThrow('disposed');
    expect(() => port.snapshot()).toThrow('disposed');
    expect(() => port.restore(new Uint8Array(4))).toThrow('disposed');
  });

  it('refuses a prop index that does not exist', async () => {
    const port = await createRapierPhysics({ geometry: roomWith(1.05), physics });
    expect(() => port.isSleeping(1)).toThrow('no prop');
    expect(() => port.isSleeping(-1)).toThrow('no prop');
    port.dispose();
  });
});
