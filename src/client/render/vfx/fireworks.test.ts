import { readFileSync } from 'node:fs';
import type { CelebrationSettings } from '@content/schemas/feedback';
import { FIREWORK_POOL_SIZE, REDUCED_MOTION_PARTICLE_KEEP_PCT } from '@shared/constants';
import { Color, Group, type InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestFeedback } from '../../../../tests/support/testContent.ts';
import {
  createFireworks,
  FIREWORK_TOKEN_HEX,
  fireworkAreaOf,
  fireworkSparksOf,
  sparkCountOf,
} from './fireworks.ts';

const SETTINGS: CelebrationSettings['fireworks'] = {
  bursts: [
    { atMs: 0, xPct: 0, zPct: 0, heightM: 2, sparks: 10 },
    { atMs: 500, xPct: 100, zPct: 50, heightM: 3, sparks: 6 },
  ],
  areaHalfM: 3,
  speedMps: 2,
  lifeMs: 1000,
  sizeM: 0.1,
  colorTokens: ['primary', 'gauge-calm', 'paper'],
};
const ROOM = { minXM: -4, minZM: -2, maxXM: 4, maxZM: 6 };

function build() {
  const parent = new Group();
  const fireworks = createFireworks(parent);
  const mesh = parent.children[0] as InstancedMesh;
  return { parent, fireworks, mesh };
}

const matrixOf = (mesh: InstancedMesh, index: number) => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix;
};
const scaleOf = (mesh: InstancedMesh, index: number) =>
  new Vector3().setFromMatrixScale(matrixOf(mesh, index));
const positionOf = (mesh: InstancedMesh, index: number) =>
  new Vector3().setFromMatrixPosition(matrixOf(mesh, index));
const colourOf = (mesh: InstancedMesh, index: number) => {
  const colour = new Color();
  mesh.getColorAt(index, colour);
  return colour.getHex();
};

describe('createFireworks (story 7.4)', () => {
  it('is one instanced mesh of its own pool, hidden and drawing nothing at rest', () => {
    const { parent, fireworks, mesh } = build();
    expect(parent.children).toHaveLength(1);
    expect(mesh.name).toBe('fireworks');
    expect(mesh.instanceMatrix.count).toBe(FIREWORK_POOL_SIZE);
    expect(mesh.visible).toBe(false);
    fireworks.update(1000);
    expect(mesh.count).toBe(0);
    expect(fireworks.aliveCount).toBe(0);
    expect(fireworks.endsAtReal).toBeNull();
  });

  it('gives every instance a colour before the first render (three draws black otherwise)', () => {
    const { mesh } = build();
    expect(mesh.instanceColor).not.toBeNull();
    expect(colourOf(mesh, FIREWORK_POOL_SIZE - 1)).toBe(FIREWORK_TOKEN_HEX.paper);
  });

  it('bursts each burst at its atMs, over the room by xPct and zPct, at its height', () => {
    const { fireworks, mesh } = build();
    fireworks.start(SETTINGS, ROOM, 1000, false);
    expect(mesh.visible).toBe(true);
    expect(fireworks.aliveCount).toBe(16);
    expect(fireworks.endsAtReal).toBe(1000 + 500 + 1000);
    fireworks.update(1000);
    // The first burst is at the room's min corner, the second waits.
    for (let i = 0; i < 10; i++) {
      const position = positionOf(mesh, i);
      expect([position.x, position.y, position.z]).toEqual([-4, 2, -2]);
      expect(scaleOf(mesh, i).x).toBeCloseTo(0.1, 6);
    }
    for (let i = 10; i < 16; i++) expect(scaleOf(mesh, i).x).toBe(0);
    fireworks.update(1500);
    const second = positionOf(mesh, 10);
    expect([second.x, second.y, second.z]).toEqual([4, 3, 2]);
  });

  it('spreads a burst over a whole sphere: as many sparks go down as up', () => {
    const { fireworks, mesh } = build();
    fireworks.start(SETTINGS, ROOM, 0, false);
    fireworks.update(100);
    let up = 0;
    let down = 0;
    for (let i = 0; i < 10; i++) {
      const y = positionOf(mesh, i).y - 2;
      if (y > 0.01) up++;
      if (y < -0.01) down++;
    }
    expect(up).toBeGreaterThanOrEqual(4);
    expect(down).toBeGreaterThanOrEqual(4);
  });

  it('shrinks each spark over lifeMs and clears itself when the last one dies', () => {
    const { fireworks, mesh } = build();
    fireworks.start(SETTINGS, ROOM, 0, false);
    fireworks.update(500);
    expect(scaleOf(mesh, 0).x).toBeCloseTo(0.05, 5);
    fireworks.update(1200);
    expect(scaleOf(mesh, 0).x).toBe(0);
    expect(fireworks.aliveCount).toBe(6);
    fireworks.update(1500);
    expect(fireworks.aliveCount).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(fireworks.endsAtReal).toBeNull();
  });

  it('colours the sparks from the tokens in turn', () => {
    const { fireworks, mesh } = build();
    fireworks.start(SETTINGS, ROOM, 0, false);
    expect([colourOf(mesh, 0), colourOf(mesh, 1), colourOf(mesh, 2), colourOf(mesh, 3)]).toEqual([
      FIREWORK_TOKEN_HEX.primary,
      FIREWORK_TOKEN_HEX['gauge-calm'],
      FIREWORK_TOKEN_HEX.paper,
      FIREWORK_TOKEN_HEX.primary,
    ]);
    expect(mesh.instanceColor?.version).toBeGreaterThan(0);
  });

  it('keeps the reduced-motion share of each burst', () => {
    const { fireworks } = build();
    fireworks.start(SETTINGS, ROOM, 0, true);
    expect(fireworks.aliveCount).toBe(sparkCountOf(10, true) + sparkCountOf(6, true));
    expect(sparkCountOf(10, true)).toBe(Math.round((10 * REDUCED_MOTION_PARTICLE_KEEP_PCT) / 100));
    expect(sparkCountOf(1, true)).toBe(1);
    expect(sparkCountOf(10, false)).toBe(10);
  });

  it('places the same sparks twice: no random number', () => {
    const a = build();
    const b = build();
    a.fireworks.start(SETTINGS, ROOM, 0, false);
    b.fireworks.start(SETTINGS, ROOM, 0, false);
    a.fireworks.update(300);
    b.fireworks.update(300);
    for (let i = 0; i < 16; i++) expect(positionOf(a.mesh, i)).toEqual(positionOf(b.mesh, i));
  });

  it('reset hides everything and a new start replaces the old one', () => {
    const { fireworks, mesh } = build();
    fireworks.start(SETTINGS, ROOM, 0, false);
    fireworks.update(100);
    fireworks.reset();
    expect(fireworks.aliveCount).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);
    fireworks.start(SETTINGS, ROOM, 0, false);
    fireworks.start(SETTINGS, ROOM, 0, false);
    expect(fireworks.aliveCount).toBe(16);
  });

  it('holds the live and the test bursts within the pool', () => {
    const live = JSON.parse(
      readFileSync(new URL('../../../../content/feedback.json', import.meta.url), 'utf8'),
    ) as { celebration: CelebrationSettings };
    expect(fireworkSparksOf(live.celebration.fireworks)).toBeLessThanOrEqual(FIREWORK_POOL_SIZE);
    expect(fireworkSparksOf(createTestFeedback().celebration.fireworks)).toBeLessThanOrEqual(
      FIREWORK_POOL_SIZE,
    );
  });

  it('allocates nothing in update: no new, no literal, no closure in its body', () => {
    const source = readFileSync(new URL('./fireworks.ts', import.meta.url), 'utf8');
    const update = source.slice(
      source.indexOf('    update(nowReal) {'),
      source.indexOf('    get aliveCount'),
    );
    expect(update).not.toMatch(/\bnew\b|=>|\[\]|\{\s*\}/);
  });

  it('dispose removes the mesh from its parent', () => {
    const { parent, fireworks } = build();
    fireworks.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe('fireworkAreaOf (story 7.4)', () => {
  const BIG = { minXM: -10, minZM: -8, maxXM: 10, maxZM: 8 };

  it('is the square of areaHalfM around the point the camera looks at', () => {
    expect(fireworkAreaOf(BIG, 2, -1, 3)).toEqual({ minXM: -1, minZM: -4, maxXM: 5, maxZM: 2 });
  });

  it('stays on the room floor near a wall, and is the whole floor of a small room', () => {
    expect(fireworkAreaOf(BIG, 9.5, 0, 3)).toEqual({ minXM: 4, minZM: -3, maxXM: 10, maxZM: 3 });
    expect(fireworkAreaOf(ROOM, 0, 2, 10)).toEqual(ROOM);
  });
});
