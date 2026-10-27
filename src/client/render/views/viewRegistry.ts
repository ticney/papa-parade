/** What a registry does for the entities of one kind, given once at creation. */
export interface ViewHandlers<E, V> {
  /** A stable key for the entity: the same entity always has the same one. */
  keyOf(entity: E): string | number;
  /** A view for an entity that has none yet (usually taken from a pool). */
  create(entity: E): V;
  /** Brings the view to the entity's state, `alpha` of the way from the last step to the next. */
  update(view: V, entity: E, alpha: number): void;
  /** The entity is gone: give the view back. */
  release(view: V): void;
}

export interface ViewRegistry<E> {
  /**
   * Makes the views match `entities` (by key): creates the ones that are missing, updates every
   * view, releases the ones whose entity is gone. Once the set of keys is stable it allocates nothing.
   */
  sync(entities: readonly E[], alpha: number): void;
  /** How many entities have a view. */
  readonly size: number;
  /** Releases every view. */
  dispose(): void;
}

interface Entry<V> {
  view: V;
  /** The `sync` number that last saw this entity. */
  seenAt: number;
}

/**
 * Reconciles the views of one kind of entity with the world, each frame (architecture › entity
 * patterns). Deviation from the architecture's example: the handlers are given here, once, and
 * `sync` takes only data. A handlers literal passed to every `sync` would allocate an object per
 * frame, and the rule is zero allocation per frame.
 */
export function createViewRegistry<E, V>(handlers: ViewHandlers<E, V>): ViewRegistry<E> {
  const entries = new Map<string | number, Entry<V>>();
  let syncs = 0;
  return {
    sync(entities, alpha) {
      syncs++;
      let seen = 0;
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i] as E;
        const key = handlers.keyOf(entity);
        let entry = entries.get(key);
        if (entry === undefined) {
          entry = { view: handlers.create(entity), seenAt: syncs };
          entries.set(key, entry);
          seen++;
        } else if (entry.seenAt !== syncs) {
          entry.seenAt = syncs;
          seen++;
        }
        handlers.update(entry.view, entity, alpha);
      }
      if (seen === entries.size) return;
      for (const [key, entry] of entries) {
        if (entry.seenAt === syncs) continue;
        handlers.release(entry.view);
        entries.delete(key);
      }
    },
    get size() {
      return entries.size;
    },
    dispose() {
      for (const entry of entries.values()) handlers.release(entry.view);
      entries.clear();
    },
  };
}
