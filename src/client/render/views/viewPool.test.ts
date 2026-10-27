import { describe, expect, it } from 'vitest';
import { createViewPool } from './viewPool.ts';

function counting(prewarm: number) {
  let made = 0;
  const pool = createViewPool(() => ({ id: made++ }), prewarm);
  return { pool, made: () => made };
}

describe('createViewPool', () => {
  it('makes its views ahead of time and nothing else while they are enough', () => {
    const { pool, made } = counting(3);
    expect(made()).toBe(3);
    expect(pool.size).toBe(3);
    expect(pool.freeCount).toBe(3);
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(made()).toBe(3);
    expect(pool.freeCount).toBe(0);
  });

  it('hands out a released view again instead of making one', () => {
    const { pool, made } = counting(1);
    const first = pool.acquire();
    pool.release(first);
    expect(pool.acquire()).toBe(first);
    expect(made()).toBe(1);
  });

  it('makes one more when every view is out, and keeps it', () => {
    const { pool, made } = counting(1);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(b).not.toBe(a);
    expect(made()).toBe(2);
    expect(pool.size).toBe(2);
    pool.release(a);
    pool.release(b);
    expect(pool.freeCount).toBe(2);
  });

  it('ignores a view released twice, or one that is not its own', () => {
    const { pool } = counting(1);
    const view = pool.acquire();
    pool.release(view);
    pool.release(view);
    pool.release({ id: 99 });
    expect(pool.freeCount).toBe(1);
    expect(pool.size).toBe(1);
  });

  it('works with no prewarm', () => {
    const { pool, made } = counting(0);
    expect(made()).toBe(0);
    pool.acquire();
    expect(made()).toBe(1);
  });
});
