/**
 * A pool of views made ahead of time, so that nothing is built while the game runs: `acquire`
 * hands out a free one and `release` takes it back. A pool that runs dry still makes one (a frame
 * must never go without a view), and `size` tells the caller it was too small.
 */
export interface ViewPool<V> {
  /** A free view, or a new one if every view is out. */
  acquire(): V;
  /** Gives a view back. A view that is already free, or not this pool's, is ignored. */
  release(view: V): void;
  /** How many views the pool has made so far, in use or free. */
  readonly size: number;
  /** How many are free now. */
  readonly freeCount: number;
}

export function createViewPool<V>(make: () => V, prewarm: number): ViewPool<V> {
  const free: V[] = [];
  const all = new Set<V>();
  const build = (): V => {
    const view = make();
    all.add(view);
    return view;
  };
  for (let i = 0; i < prewarm; i++) free.push(build());
  return {
    acquire() {
      return free.pop() ?? build();
    },
    release(view) {
      if (!all.has(view) || free.includes(view)) return;
      free.push(view);
    },
    get size() {
      return all.size;
    },
    get freeCount() {
      return free.length;
    },
  };
}
