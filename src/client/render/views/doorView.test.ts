import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { createToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  createDoorView,
  type DoorLook,
  doorOpenAngleDegAt,
  doorPlacementOf,
  doorYawRadAt,
} from './doorView.ts';

const LOOK: DoorLook = {
  openMs: 700,
  openAngleDeg: 100,
  widthM: 0.9,
  heightM: 2,
  thicknessM: 0.05,
};

describe('doorPlacementOf (story 3.5, D7)', () => {
  it('lies parallel to the back wall in the salon, hinged at its low-x end, opening into the room', () => {
    // The salon: bounds x -4.2..4.9, z -3.2..3, the door anchor at (2.9, -2.8).
    const placement = doorPlacementOf(2.9, -2.8, -4.2, -3.2, 4.9, 3, LOOK.widthM);
    expect(placement.inward).toEqual({ x: 0, z: 1 });
    expect(placement.tangent).toEqual({ x: 1, z: 0 });
    expect(placement.hingeXM).toBeCloseTo(2.9 - 0.45, 10);
    expect(placement.hingeZM).toBeCloseTo(-2.8, 10);
  });

  it('picks the nearest wall of the bounds, whichever it is', () => {
    const cases: [number, number, { x: number; z: number }][] = [
      [-3.9, 0, { x: 1, z: 0 }],
      [3.9, 0, { x: -1, z: 0 }],
      [0, -2.9, { x: 0, z: 1 }],
      [0, 2.9, { x: 0, z: -1 }],
    ];
    for (const [x, z, inward] of cases) {
      const placement = doorPlacementOf(x, z, -4, -3, 4, 3, 1);
      expect(placement.inward, `${x},${z}`).toEqual(inward);
      // The panel is perpendicular to the way in, and the pair is a unit one.
      expect(
        placement.tangent.x * placement.inward.x + placement.tangent.z * placement.inward.z,
      ).toBeCloseTo(0, 12);
      expect(Math.hypot(placement.tangent.x, placement.tangent.z)).toBe(1);
    }
  });
});

describe('doorOpenAngleDegAt', () => {
  it('stays shut with no rush, and until the rush starts', () => {
    expect(doorOpenAngleDegAt(null, 99_999, LOOK, false)).toBe(0);
    expect(doorOpenAngleDegAt(5000, 4999, LOOK, false)).toBe(0);
    expect(doorOpenAngleDegAt(5000, 5000, LOOK, false)).toBe(0);
  });

  it('swings open over openMs, smoothly and monotonically, and stays open', () => {
    const angles = [0, 0.25, 0.5, 0.75, 1].map((p) =>
      doorOpenAngleDegAt(5000, 5000 + p * LOOK.openMs, LOOK, false),
    );
    expect(angles[2]).toBeCloseTo(LOOK.openAngleDeg / 2, 10);
    expect(angles[4]).toBe(LOOK.openAngleDeg);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] as number).toBeGreaterThan(angles[i - 1] as number);
    }
    expect(doorOpenAngleDegAt(5000, 5000 + LOOK.openMs * 40, LOOK, false)).toBe(LOOK.openAngleDeg);
  });

  it('jumps open at the start of the rush under reduced motion, but never without a rush', () => {
    expect(doorOpenAngleDegAt(5000, 5000, LOOK, true)).toBe(LOOK.openAngleDeg);
    expect(doorOpenAngleDegAt(5000, 4000, LOOK, true)).toBe(0);
    expect(doorOpenAngleDegAt(null, 5000, LOOK, true)).toBe(0);
  });

  it('is a function of the clock alone: a clock that stands still holds the door', () => {
    expect(doorOpenAngleDegAt(5000, 5300, LOOK, false)).toBe(
      doorOpenAngleDegAt(5000, 5300, LOOK, false),
    );
  });
});

describe('doorYawRadAt', () => {
  const back = doorPlacementOf(2.9, -2.8, -4.2, -3.2, 4.9, 3, 0.9);

  it('is 0 when shut and swings the panel towards the room when open', () => {
    expect(doorYawRadAt(back, 0)).toBe(0);
    // three.js: +x turns to -z for a positive yaw, so a door that opens towards +z has a negative one.
    expect(doorYawRadAt(back, 90)).toBeCloseTo(-Math.PI / 2, 10);
    const yaw = doorYawRadAt(back, 100);
    expect(yaw).toBeLessThan(0);
    // The panel's direction is (cos yaw, -sin yaw): into the room is +z.
    expect(-Math.sin(yaw)).toBeGreaterThan(0);
  });

  it('opens towards the room on every wall', () => {
    for (const [x, z] of [
      [-3.9, 0],
      [3.9, 0],
      [0, -2.9],
      [0, 2.9],
    ] as const) {
      const placement = doorPlacementOf(x, z, -4, -3, 4, 3, 1);
      const yaw = doorYawRadAt(placement, 60);
      const dirX = Math.cos(yaw);
      const dirZ = -Math.sin(yaw);
      expect(dirX * placement.inward.x + dirZ * placement.inward.z).toBeGreaterThan(0);
    }
  });
});

describe('createDoorView', () => {
  it('stands one closed panel at the hinge, and turns it on update', () => {
    const parent = new Group();
    const toon = createToonMaterialCache();
    const placement = doorPlacementOf(2.9, -2.8, -4.2, -3.2, 4.9, 3, LOOK.widthM);
    const view = createDoorView(parent, toon, LOOK, placement);
    expect(parent.children).toHaveLength(1);
    expect(view.object.position.x).toBeCloseTo(placement.hingeXM, 10);
    expect(view.object.position.z).toBeCloseTo(placement.hingeZM, 10);
    expect(view.object.rotation.y).toBe(0);
    view.update(null, 9000, false);
    expect(view.openAngleDeg).toBe(0);
    view.update(5000, 5000 + LOOK.openMs, false);
    expect(view.openAngleDeg).toBe(LOOK.openAngleDeg);
    expect(view.object.rotation.y).toBeCloseTo(doorYawRadAt(placement, LOOK.openAngleDeg), 10);
    toon.dispose();
  });
});
