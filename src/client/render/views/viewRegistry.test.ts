import { describe, expect, it } from 'vitest';
import { createViewPool } from './viewPool.ts';
import { createViewRegistry } from './viewRegistry.ts';

interface Thing {
  id: string;
  x: number;
}

function setup(prewarm = 4) {
  const log = { created: 0, updated: 0, released: 0, alphas: [] as number[] };
  let made = 0;
  const pool = createViewPool(() => ({ n: made++, x: Number.NaN }), prewarm);
  const registry = createViewRegistry<Thing, { n: number; x: number }>({
    keyOf: (thing) => thing.id,
    create: () => {
      log.created++;
      return pool.acquire();
    },
    update: (view, thing, alpha) => {
      log.updated++;
      log.alphas.push(alpha);
      view.x = thing.x;
    },
    release: (view) => {
      log.released++;
      pool.release(view);
    },
  });
  return { registry, pool, log };
}

describe('createViewRegistry', () => {
  it('creates a view for each entity it sees, and updates it', () => {
    const { registry, log } = setup();
    registry.sync(
      [
        { id: 'a', x: 1 },
        { id: 'b', x: 2 },
      ],
      0.25,
    );
    expect(registry.size).toBe(2);
    expect(log).toMatchObject({ created: 2, updated: 2, released: 0, alphas: [0.25, 0.25] });
  });

  it('creates nothing on a second sync with the same entities, and updates every view', () => {
    const { registry, log, pool } = setup();
    const things = [
      { id: 'a', x: 1 },
      { id: 'b', x: 2 },
    ];
    registry.sync(things, 0);
    const poolSize = pool.size;
    things[0] = { id: 'a', x: 5 };
    registry.sync(things, 0.5);
    registry.sync(things, 1);
    expect(log.created).toBe(2);
    expect(log.updated).toBe(6);
    expect(log.released).toBe(0);
    expect(pool.size).toBe(poolSize);
  });

  it('releases the view of an entity that is gone, and reuses it for a new one', () => {
    const { registry, log, pool } = setup(1);
    registry.sync([{ id: 'a', x: 1 }], 0);
    registry.sync([], 0);
    expect(log.released).toBe(1);
    expect(registry.size).toBe(0);
    registry.sync([{ id: 'c', x: 3 }], 0);
    expect(pool.size).toBe(1); // the freed view came back
  });

  it('keeps the views of the entities that stay when others leave', () => {
    const { registry, log } = setup();
    registry.sync(
      [
        { id: 'a', x: 1 },
        { id: 'b', x: 2 },
        { id: 'c', x: 3 },
      ],
      0,
    );
    registry.sync(
      [
        { id: 'a', x: 1 },
        { id: 'c', x: 3 },
      ],
      0,
    );
    expect(log.released).toBe(1);
    expect(registry.size).toBe(2);
    expect(log.created).toBe(3);
  });

  it('dispose releases every view', () => {
    const { registry, log, pool } = setup();
    registry.sync(
      [
        { id: 'a', x: 1 },
        { id: 'b', x: 2 },
      ],
      0,
    );
    registry.dispose();
    expect(log.released).toBe(2);
    expect(registry.size).toBe(0);
    expect(pool.freeCount).toBe(pool.size);
  });

  it('works with numeric keys', () => {
    const made: number[] = [];
    const registry = createViewRegistry<{ id: number }, number>({
      keyOf: (entity) => entity.id,
      create: (entity) => {
        made.push(entity.id);
        return entity.id;
      },
      update: () => {},
      release: () => {},
    });
    registry.sync([{ id: 1 }, { id: 2 }], 0);
    registry.sync([{ id: 1 }, { id: 2 }], 0);
    expect(made).toEqual([1, 2]);
  });
});
