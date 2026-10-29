import { createSim } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  testWave,
} from '../../tests/support/testContent.ts';
import {
  boxEdgeSegments,
  DEBUG_VIEWS,
  pathSegments,
  walkableCellTriangles,
} from './navDebugView.ts';
import { formatPerfLines } from './perfPanel.ts';
import { summarizeWorld } from './stateInspector.ts';

const geometry = createTestGeometry();

describe('walkableCellTriangles', () => {
  it('draws two triangles for each walkable cell of the geometry’s grid, and none for a blocked one', () => {
    const walkable = geometry.nav.rows.join('').split('1').length - 1;
    const vertices = walkableCellTriangles(geometry.nav, geometry.cellM, 0.02);
    // 6 vertices per cell, 3 numbers per vertex.
    expect(vertices).toHaveLength(walkable * 6 * 3);
    expect(walkable).toBeGreaterThan(0);
    expect(walkable).toBeLessThan(geometry.nav.cols * geometry.nav.rowCount);
  });

  it('puts a cell where the grid says: origin plus column and row times the cell size, at the given height', () => {
    const nav = { originM: [10, 20] as [number, number], cols: 2, rowCount: 2, rows: ['01', '00'] };
    const vertices = walkableCellTriangles(nav, 0.5, 0.1);
    // Only column 1 of row 0 is walkable: x in [10.5, 11], z in [20, 20.5].
    expect(vertices).toEqual([
      10.5, 0.1, 20, 11, 0.1, 20, 11, 0.1, 20.5, 10.5, 0.1, 20, 11, 0.1, 20.5, 10.5, 0.1, 20.5,
    ]);
  });

  it('is empty for a grid with nothing walkable', () => {
    const nav = { originM: [0, 0] as [number, number], cols: 2, rowCount: 1, rows: ['00'] };
    expect(walkableCellTriangles(nav, 0.5, 0)).toEqual([]);
  });
});

describe('boxEdgeSegments', () => {
  it('gives the 12 edges of a box, as 24 points, each of the box’s own length', () => {
    const segments = boxEdgeSegments([1, 2, 3], [0.5, 1, 1.5]);
    expect(segments).toHaveLength(12 * 2 * 3);
    const lengths = new Set<number>();
    for (let i = 0; i < segments.length; i += 6) {
      const [x0, y0, z0, x1, y1, z1] = segments.slice(i, i + 6) as number[];
      lengths.add(Number(Math.hypot(x1 - x0, y1 - y0, z1 - z0).toFixed(6)));
    }
    // Four edges along each axis: the full size of the box on that axis.
    expect([...lengths].sort()).toEqual([1, 2, 3]);
  });

  it('stays inside the box', () => {
    const segments = boxEdgeSegments([1, 2, 3], [0.5, 1, 1.5]);
    for (let i = 0; i < segments.length; i += 3) {
      expect(Math.abs((segments[i] as number) - 1)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((segments[i + 1] as number) - 2)).toBeLessThanOrEqual(1);
      expect(Math.abs((segments[i + 2] as number) - 3)).toBeLessThanOrEqual(1.5);
    }
  });

  it('draws a flat box as a rectangle’s edges without a division by zero', () => {
    const segments = boxEdgeSegments([0, 0, 0], [1, 0, 1]);
    expect(segments.every(Number.isFinite)).toBe(true);
  });
});

describe('pathSegments', () => {
  it('joins Papa to the waypoints he has not reached, in order', () => {
    const path = [1, 1, 2, 1, 2, 3];
    expect(pathSegments({ xM: 0, zM: 1 }, path, 0, 0.05)).toEqual([
      0, 0.05, 1, 1, 0.05, 1, 1, 0.05, 1, 2, 0.05, 1, 2, 0.05, 1, 2, 0.05, 3,
    ]);
    // The first waypoint is behind him.
    expect(pathSegments({ xM: 1, zM: 1 }, path, 1, 0.05)).toEqual([
      1, 0.05, 1, 2, 0.05, 1, 2, 0.05, 1, 2, 0.05, 3,
    ]);
  });

  it('is empty when there is no path or it has been walked', () => {
    expect(pathSegments({ xM: 0, zM: 0 }, [], 0, 0)).toEqual([]);
    expect(pathSegments({ xM: 0, zM: 0 }, [1, 1], 1, 0)).toEqual([]);
  });
});

describe('the list of views', () => {
  it('has a view for each thing the story draws, each once', () => {
    expect([...DEBUG_VIEWS].sort()).toEqual([
      'anchors',
      'colliders',
      'grid',
      'path',
      'touchRadii',
      'zones',
    ]);
  });
});

describe('formatPerfLines', () => {
  const report = {
    frames: 600,
    fpsLastSecond: 59.9,
    frameMsMeanLastSecond: 16.69,
    frameMsMean: 16.7,
    frameMsP95: 17,
    frameMsMax: 40,
    drawCallsMax: 30,
    trianglesMax: 5000,
  };

  it('writes the FPS, the loop’s timings and the renderer’s counts, one line each', () => {
    const lines = formatPerfLines(
      report,
      { simMsLastFrame: 0.123, renderMsLastFrame: 3.456, frameMsLastFrame: 3.6 },
      { drawCalls: 28, triangles: 314 },
    );
    expect(lines).toEqual([
      '60 FPS · frame every 16.7 ms (p95 17.0, max 40.0)',
      'work 3.6 ms = sim 0.12 ms + render 3.5 ms',
      '28 draw calls · 314 triangles',
    ]);
  });

  it('leaves out the loop line when there is no loop (no level)', () => {
    const lines = formatPerfLines(report, null, { drawCalls: 0, triangles: 0 });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('0 draw calls · 0 triangles');
  });
});

describe('summarizeWorld', () => {
  it('names the time, the scale, the flow, Papa, the baby, the fatigue and each threat with its def and state', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET, STAIRS])] }),
      seed: 1,
    });
    const lines = summarizeWorld(sim.world);
    expect(lines[0]).toBe('t 0 ms · timeScale 1.00 (base 1.00, 0 slow-mo)');
    expect(lines[1]).toBe('flow playing · papa idle · baby babble');
    expect(lines[2]).toBe('fatigue 0.0');
    expect(sim.world.threats.length).toBeGreaterThan(0);
    // One line per threat, with its id, def, anchor and state.
    expect(lines.slice(3)).toEqual(
      sim.world.threats.map(
        (threat) => `#${threat.id} ${threat.defId} @ ${threat.anchorId}: ${threat.state}`,
      ),
    );
    sim.dispose();
  });

  it('marks the fatigue that is above its threshold, and only then', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry,
      level: createTestLevel(),
      seed: 1,
    });
    const world = structuredClone(sim.world);
    world.gauges.fatigue = 42.5;
    world.gauges.isFatigueAbove = false;
    expect(summarizeWorld(world)[2]).toBe('fatigue 42.5');
    world.gauges.isFatigueAbove = true;
    expect(summarizeWorld(world)[2]).toBe('fatigue 42.5 (above threshold)');
    sim.dispose();
  });

  it('only reads: summarising changes nothing', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry,
      level: createTestLevel(),
      seed: 1,
    });
    const before = structuredClone(sim.world);
    summarizeWorld(sim.world);
    expect(sim.world).toEqual(before);
    sim.dispose();
  });
});
