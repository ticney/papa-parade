import { readFileSync } from 'node:fs';
import { PARTICLE_POOL_SIZE } from '@shared/constants';
import { Color, Group, type InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../materials/palette.ts';
import { createParticles } from './particles.ts';

function build() {
  const parent = new Group();
  const particles = createParticles(parent);
  const mesh = parent.children[0] as InstancedMesh;
  return { parent, particles, mesh };
}

const scaleOf = (mesh: InstancedMesh, index: number) => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixScale(matrix);
};
const positionOf = (mesh: InstancedMesh, index: number) => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
};

describe('createParticles', () => {
  it('is one instanced mesh of the pool size, hidden at rest', () => {
    const { parent, particles, mesh } = build();
    expect(parent.children).toHaveLength(1);
    expect(mesh.instanceMatrix.count).toBe(PARTICLE_POOL_SIZE);
    expect(mesh.frustumCulled).toBe(false);
    particles.update(1000);
    expect(mesh.count).toBe(0);
    expect(particles.aliveCount).toBe(0);
  });

  it('lights n slots for a burst of n, at the anchor lifted above the floor', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 10, 0, 350, 0.05, 2, -3, 1000);
    particles.update(1000);
    expect(particles.aliveCount).toBe(10);
    expect(mesh.count).toBe(10);
    for (let i = 0; i < 10; i++) {
      const position = positionOf(mesh, i);
      expect([position.x, position.z]).toEqual([2, -3]);
      expect(position.y).toBeGreaterThan(0);
      expect(scaleOf(mesh, i).x).toBeCloseTo(0.05, 6);
    }
  });

  it('waits for its start, then shrinks sparks and hides them at lifeMs', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 4, 2, 400, 0.1, 0, 0, 1000);
    particles.update(900);
    expect(scaleOf(mesh, 0).x).toBe(0);
    particles.update(1200);
    expect(scaleOf(mesh, 0).x).toBeCloseTo(0.1 * 0.5, 5);
    particles.update(1400);
    expect(particles.aliveCount).toBe(0);
    expect(mesh.count).toBe(0);
    expect(scaleOf(mesh, 0).x).toBe(0);
  });

  it('throws sparks up and out, then pulls them down with gravity', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 1, 3, 1000, 0.1, 0, 0, 0);
    particles.update(0);
    const y0 = positionOf(mesh, 0).y;
    particles.update(100);
    const yEarly = positionOf(mesh, 0).y;
    particles.update(900);
    const yLate = positionOf(mesh, 0).y;
    expect(yEarly).toBeGreaterThan(y0);
    expect(yLate).toBeLessThan(yEarly);
  });

  it('lets a puff drift without gravity, grow to twice its size, then shrink away', () => {
    const { particles, mesh } = build();
    particles.burst('puff', 3, 0.8, 1000, 0.1, 0, 0, 0);
    particles.update(0);
    expect(scaleOf(mesh, 0).x).toBeCloseTo(0.1, 6);
    particles.update(500);
    expect(scaleOf(mesh, 0).x).toBeCloseTo(0.2, 6);
    particles.update(750);
    expect(scaleOf(mesh, 0).x).toBeCloseTo(0.1, 6);
    // No gravity: its height only goes one way.
    particles.update(100);
    const early = positionOf(mesh, 1).y;
    particles.update(900);
    expect(positionOf(mesh, 1).y).toBeGreaterThanOrEqual(early);
  });

  it('colours sparks paper and ink, and puffs cream', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 6, 1, 500, 0.05, 0, 0, 0);
    particles.burst('puff', 2, 1, 500, 0.05, 0, 0, 0);
    const colors = new Set<number>();
    const color = new Color();
    for (let i = 0; i < 8; i++) {
      mesh.getColorAt(i, color);
      colors.add(color.getHex());
    }
    expect([...colors].sort()).toEqual([PALETTE.paper, PALETTE.cream, PALETTE.ink].sort());
  });

  it('recycles the oldest particles when the pool overflows', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 32, 1, 1000, 0.05, 0, 0, 0);
    particles.burst('spark', 32, 1, 1000, 0.05, 0, 0, 10);
    particles.update(20);
    expect(particles.aliveCount).toBe(PARTICLE_POOL_SIZE);
    // A third burst takes the oldest 5 (the first burst's), never fails.
    particles.burst('puff', 5, 1, 1000, 0.05, 7, 7, 20);
    particles.update(30);
    expect(particles.aliveCount).toBe(PARTICLE_POOL_SIZE);
    const recycled = Array.from({ length: PARTICLE_POOL_SIZE }, (_, i) =>
      positionOf(mesh, i),
    ).filter((position) => Math.abs(position.x - 7) < 0.5 && Math.abs(position.z - 7) < 0.5);
    expect(recycled).toHaveLength(5);
  });

  it('writes nothing on an update with nothing alive', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 3, 1, 100, 0.05, 0, 0, 0);
    particles.update(10);
    particles.update(500); // all dead: this pass writes the last state
    const version = mesh.instanceMatrix.version;
    particles.update(600);
    particles.update(700);
    expect(mesh.instanceMatrix.version).toBe(version);
  });

  it('gives the same positions for the same burst, twice', () => {
    const run = () => {
      const { particles, mesh } = build();
      particles.burst('spark', 12, 3.5, 500, 0.06, 1, 2, 0);
      particles.update(130);
      return Array.from({ length: 12 }, (_, i) => positionOf(mesh, i).toArray());
    };
    expect(run()).toEqual(run());
  });

  it('spreads a burst over the hemisphere: no two sparks leave in the same direction', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 24, 3, 500, 0.06, 0, 0, 0);
    particles.update(50);
    const keys = new Set(
      Array.from({ length: 24 }, (_, i) => {
        const p = positionOf(mesh, i);
        return `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
      }),
    );
    expect(keys.size).toBe(24);
  });

  it('reset hides everything at once', () => {
    const { particles, mesh } = build();
    particles.burst('spark', 8, 1, 500, 0.05, 0, 0, 0);
    particles.update(10);
    particles.reset();
    expect(particles.aliveCount).toBe(0);
    expect(mesh.count).toBe(0);
    particles.update(20);
    expect(mesh.count).toBe(0);
  });

  it('dispose takes the mesh out of its parent', () => {
    const { parent, particles } = build();
    particles.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('allocates nothing per frame: update has no `new` and reuses module scratch objects', () => {
    const source = readFileSync(new URL('./particles.ts', import.meta.url), 'utf8');
    const start = source.indexOf('    update(nowReal) {');
    const end = source.indexOf('    get aliveCount()');
    expect(start).toBeGreaterThan(0);
    expect(source.slice(start, end)).not.toMatch(/\bnew \w/);
  });
});
