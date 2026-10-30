import { describe, expect, it } from 'vitest';
import { createWebStorage, type StorageLike } from './webStorage.ts';

function memory(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

const throwing = (): StorageLike => {
  const fail = (): never => {
    throw new Error('SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
};

describe('createWebStorage', () => {
  it('reads null for a key that was never written', async () => {
    expect(await createWebStorage(memory).get('x')).toEqual({ ok: true, value: null });
  });

  it('writes JSON and reads it back', async () => {
    const store = memory();
    const storage = createWebStorage(() => store);
    expect(await storage.set('k', { a: [1, 'two', null] })).toEqual({ ok: true, value: undefined });
    expect(store.items.get('k')).toBe('{"a":[1,"two",null]}');
    expect(await storage.get('k')).toEqual({ ok: true, value: { a: [1, 'two', null] } });
  });

  it('removes a key', async () => {
    const store = memory();
    const storage = createWebStorage(() => store);
    await storage.set('k', 1);
    expect(await storage.remove('k')).toEqual({ ok: true, value: undefined });
    expect(await storage.get('k')).toEqual({ ok: true, value: null });
  });

  it('answers `invalid` with the raw text when the stored text is not JSON', async () => {
    const store = memory();
    store.items.set('k', '{not json');
    const result = await createWebStorage(() => store).get('k');
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid', key: 'k', raw: '{not json' },
    });
  });

  it('answers `unavailable` on a read, a write and a remove that throw, and never throws', async () => {
    const storage = createWebStorage(throwing);
    for (const result of [
      await storage.get('k'),
      await storage.set('k', 1),
      await storage.remove('k'),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable', key: 'k' } });
    }
  });

  it('answers `unavailable` when the storage itself cannot be reached', async () => {
    const storage = createWebStorage(() => {
      throw new Error('blocked');
    });
    expect(await storage.get('k')).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(await storage.set('k', 1)).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });

  it('answers `unavailable` for a value JSON cannot hold, such as a BigInt', async () => {
    const storage = createWebStorage(memory);
    expect(await storage.set('k', 1n)).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});
