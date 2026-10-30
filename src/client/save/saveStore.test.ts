import type { StorageError, StoragePort } from '@platform/platform';
import { SAVE_INVALID_KEY, SAVE_KEY } from '@shared/constants';
import { log } from '@shared/log';
import { err, ok } from '@shared/result';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSaveStore, migrateSave, type SaveMigration } from './saveStore.ts';

const CALIBRATION = {
  visualOffsetMs: 80,
  audioOffsetMs: 120,
  audioSkipped: false,
  measuredAt: '2026-10-30T10:00:00.000Z',
  device: 'web-touch',
};

interface FakeStorage extends StoragePort {
  items: Map<string, unknown>;
  failing: Set<'get' | 'set' | 'remove'>;
  /** Keys whose stored text is not JSON: `get` answers `invalid` with this raw text. */
  garbled: Map<string, string>;
}

function fakeStorage(): FakeStorage {
  const items = new Map<string, unknown>();
  const failing = new Set<'get' | 'set' | 'remove'>();
  const garbled = new Map<string, string>();
  const unavailable = (key: string): StorageError => ({
    kind: 'unavailable',
    key,
    message: 'private window',
  });
  return {
    items,
    failing,
    garbled,
    async get(key) {
      if (failing.has('get')) return err(unavailable(key));
      const raw = garbled.get(key);
      if (raw !== undefined) return err({ kind: 'invalid', key, message: 'not JSON', raw });
      return ok(items.has(key) ? items.get(key) : null);
    },
    async set(key, value) {
      if (failing.has('set')) return err(unavailable(key));
      items.set(key, value);
      return ok(undefined);
    },
    async remove(key) {
      if (failing.has('remove')) return err(unavailable(key));
      items.delete(key);
      return ok(undefined);
    },
  };
}

const warnings = (): string[] =>
  log
    .buffer()
    .filter((entry) => entry.level === 'warn' && entry.channel === 'storage')
    .map((entry) => entry.message);

beforeAll(() => {
  log.setLevel('error');
});

describe('createSaveStore', () => {
  let storage: FakeStorage;
  let warnedBefore: number;
  beforeEach(() => {
    storage = fakeStorage();
    warnedBefore = warnings().length;
  });
  const newWarnings = (): string[] => warnings().slice(warnedBefore);

  it('starts a new player on the defaults, without a warning and without writing', async () => {
    const store = createSaveStore(storage);
    expect(await store.load()).toEqual({ version: 1, calibration: null });
    expect(store.current()).toEqual({ version: 1, calibration: null });
    expect(storage.items.size).toBe(0);
    expect(newWarnings()).toEqual([]);
  });

  it('reads a valid save back', async () => {
    storage.items.set(SAVE_KEY, { version: 1, calibration: CALIBRATION });
    const store = createSaveStore(storage);
    expect(await store.load()).toEqual({ version: 1, calibration: CALIBRATION });
    expect(newWarnings()).toEqual([]);
  });

  it('writes the calibration under the save key and keeps it in memory', async () => {
    const store = createSaveStore(storage);
    await store.load();
    await store.setCalibration(CALIBRATION);
    expect(store.current().calibration).toEqual(CALIBRATION);
    expect(storage.items.get(SAVE_KEY)).toEqual({ version: 1, calibration: CALIBRATION });
  });

  it('keeps the value in memory, with one warning, when the write fails', async () => {
    const store = createSaveStore(storage);
    await store.load();
    storage.failing.add('set');
    await store.setCalibration(CALIBRATION);
    expect(store.current().calibration).toEqual(CALIBRATION);
    expect(newWarnings()).toEqual(['the save could not be written']);
  });

  it('runs on defaults, with a warning and no write, when the storage cannot be read', async () => {
    storage.failing.add('get');
    const store = createSaveStore(storage);
    expect(await store.load()).toEqual({ version: 1, calibration: null });
    expect(storage.items.size).toBe(0);
    expect(newWarnings()).toHaveLength(1);
  });

  describe('a save it cannot use is set aside and replaced by defaults, with a warning', () => {
    it.each<[string, unknown]>([
      ['a future version', { version: 2, calibration: null, settings: {} }],
      ['a version no migration reaches', { version: 0, calibration: null }],
      ['not an object', 'hello'],
      ['an array', []],
      ['no version', { calibration: null }],
      ['a fractional version', { version: 1.5, calibration: null }],
      ['an unknown key', { version: 1, calibration: null, bogus: 1 }],
      [
        'an offset out of bounds',
        { version: 1, calibration: { ...CALIBRATION, visualOffsetMs: 5000 } },
      ],
      [
        'a user-agent-sized device',
        { version: 1, calibration: { ...CALIBRATION, device: 'x'.repeat(65) } },
      ],
      [
        'a date that is not ISO',
        { version: 1, calibration: { ...CALIBRATION, measuredAt: 'yesterday' } },
      ],
      ['a missing flag', { version: 1, calibration: { ...CALIBRATION, audioSkipped: undefined } }],
    ])('%s', async (_name, stored) => {
      storage.items.set(SAVE_KEY, stored);
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual({ version: 1, calibration: null });
      expect(storage.items.get(SAVE_INVALID_KEY)).toEqual(stored);
      expect(storage.items.get(SAVE_KEY)).toEqual({ version: 1, calibration: null });
      expect(newWarnings()).toHaveLength(1);
    });

    it('text that is not JSON: the raw text is what is kept', async () => {
      storage.garbled.set(SAVE_KEY, '{oops');
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual({ version: 1, calibration: null });
      expect(storage.items.get(SAVE_INVALID_KEY)).toBe('{oops');
      expect(newWarnings()).toHaveLength(1);
    });

    it('never throws, even when the set-aside copy cannot be written', async () => {
      storage.items.set(SAVE_KEY, { version: 9 });
      storage.failing.add('set');
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual({ version: 1, calibration: null });
      expect(newWarnings().length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('migrateSave', () => {
  // A fake table for a game at version 2: v0 → v1 gives the calibration, v1 → v2 renames it.
  const MIGRATIONS: SaveMigration[] = [
    { from: 0, migrate: (save) => ({ version: 1, calibration: save.calibrated ?? null }) },
    { from: 1, migrate: (save) => ({ version: 2, latency: save.calibration }) },
  ];

  it('runs the table in order, from the stored version to the target', () => {
    expect(migrateSave({ version: 0, calibrated: 'x' }, MIGRATIONS, 2)).toEqual({
      ok: true,
      value: { version: 2, latency: 'x' },
    });
    expect(migrateSave({ version: 1, calibration: 'y' }, MIGRATIONS, 2)).toEqual({
      ok: true,
      value: { version: 2, latency: 'y' },
    });
  });

  it('leaves a current save alone, same object', () => {
    const save = { version: 2, latency: null };
    expect(migrateSave(save, MIGRATIONS, 2)).toEqual({ ok: true, value: save });
  });

  it('refuses a version from the future, a gap in the table, and a migration that lies', () => {
    expect(migrateSave({ version: 3 }, MIGRATIONS, 2)).toMatchObject({ ok: false });
    expect(migrateSave({ version: 0 }, [MIGRATIONS[1] as SaveMigration], 2)).toMatchObject({
      ok: false,
    });
    expect(migrateSave({ version: 0 }, [{ from: 0, migrate: (save) => save }], 1)).toMatchObject({
      ok: false,
    });
  });

  it('refuses what is not a save', () => {
    for (const raw of [null, 'x', 3, [], {}, { version: '1' }, { version: 0.5 }]) {
      expect(migrateSave(raw, MIGRATIONS, 2), JSON.stringify(raw)).toMatchObject({ ok: false });
    }
  });

  it('runs a migration through the store: a v0 save is brought to v1 and written back', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 0, calibrated: null });
    const store = createSaveStore(storage, {
      migrations: [{ from: 0, migrate: (save) => ({ version: 1, calibration: save.calibrated }) }],
    });
    expect(await store.load()).toEqual({ version: 1, calibration: null });
    expect(storage.items.get(SAVE_KEY)).toEqual({ version: 1, calibration: null });
    expect(storage.items.has(SAVE_INVALID_KEY)).toBe(false);
  });
});
