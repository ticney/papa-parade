import { SaveSchema } from '@content/schemas/save';
import type { StorageError, StoragePort } from '@platform/platform';
import { SAVE_INVALID_KEY, SAVE_KEY } from '@shared/constants';
import { log } from '@shared/log';
import { err, ok } from '@shared/result';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSaveStore, migrateSave, SAVE_MIGRATIONS, type SaveMigration } from './saveStore.ts';

const SETTINGS = {
  tier: 'normal',
  volumes: { music: 100, sfx: 100, voice: 100, ui: 100 },
  haptics: true,
  reducedMotion: false,
  largeVerbs: false,
} as const;
const DEFAULTS = { version: 3, calibration: null, settings: SETTINGS };

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
    expect(await store.load()).toEqual(DEFAULTS);
    expect(store.current()).toEqual(DEFAULTS);
    expect(storage.items.size).toBe(0);
    expect(newWarnings()).toEqual([]);
  });

  it('reads a valid save back', async () => {
    storage.items.set(SAVE_KEY, { ...DEFAULTS, calibration: CALIBRATION });
    const store = createSaveStore(storage);
    expect(await store.load()).toEqual({ ...DEFAULTS, calibration: CALIBRATION });
    expect(newWarnings()).toEqual([]);
  });

  it('writes the calibration under the save key and keeps it in memory', async () => {
    const store = createSaveStore(storage);
    await store.load();
    await store.setCalibration(CALIBRATION);
    expect(store.current().calibration).toEqual(CALIBRATION);
    expect(storage.items.get(SAVE_KEY)).toEqual({ ...DEFAULTS, calibration: CALIBRATION });
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
    expect(await store.load()).toEqual(DEFAULTS);
    expect(storage.items.size).toBe(0);
    expect(newWarnings()).toHaveLength(1);
  });

  describe('a save it cannot use is set aside and replaced by defaults, with a warning', () => {
    it.each<[string, unknown]>([
      ['a version no migration reaches', { version: 0, calibration: null }],
      ['a v2 save with no settings', { version: 2, calibration: null }],
      ['an unknown tier', { ...DEFAULTS, settings: { ...SETTINGS, tier: 'hard' } }],
      [
        'a volume out of range',
        { ...DEFAULTS, settings: { ...SETTINGS, volumes: { ...SETTINGS.volumes, ui: 101 } } },
      ],
      [
        'a fractional volume',
        { ...DEFAULTS, settings: { ...SETTINGS, volumes: { ...SETTINGS.volumes, music: 50.5 } } },
      ],
      ['an unknown settings key', { ...DEFAULTS, settings: { ...SETTINGS, large: true } }],
      ['not an object', 'hello'],
      ['an array', []],
      ['no version', { calibration: null }],
      ['a fractional version', { version: 1.5, calibration: null }],
      ['an unknown key', { ...DEFAULTS, bogus: 1 }],
      [
        'an offset out of bounds',
        { ...DEFAULTS, calibration: { ...CALIBRATION, visualOffsetMs: 5000 } },
      ],
      [
        'a user-agent-sized device',
        { ...DEFAULTS, calibration: { ...CALIBRATION, device: 'x'.repeat(65) } },
      ],
      [
        'a date that is not ISO',
        { ...DEFAULTS, calibration: { ...CALIBRATION, measuredAt: 'yesterday' } },
      ],
      ['a missing flag', { ...DEFAULTS, calibration: { ...CALIBRATION, audioSkipped: undefined } }],
    ])('%s', async (_name, stored) => {
      storage.items.set(SAVE_KEY, stored);
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual(DEFAULTS);
      expect(storage.items.get(SAVE_INVALID_KEY)).toEqual(stored);
      expect(storage.items.get(SAVE_KEY)).toEqual(DEFAULTS);
      expect(newWarnings()).toHaveLength(1);
    });

    it('text that is not JSON: the raw text is what is kept', async () => {
      storage.garbled.set(SAVE_KEY, '{oops');
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual(DEFAULTS);
      expect(storage.items.get(SAVE_INVALID_KEY)).toBe('{oops');
      expect(newWarnings()).toHaveLength(1);
    });

    it('never throws, even when the set-aside copy cannot be written', async () => {
      storage.items.set(SAVE_KEY, { version: 9 });
      storage.failing.add('set');
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual(DEFAULTS);
      expect(newWarnings().length).toBeGreaterThanOrEqual(2);
    });

    it('keeps the first copy: a second unusable save never overwrites it (story 2.8)', async () => {
      storage.items.set(SAVE_KEY, { version: 0, first: true });
      await createSaveStore(storage).load();
      expect(storage.items.get(SAVE_INVALID_KEY)).toEqual({ version: 0, first: true });
      storage.items.set(SAVE_KEY, { version: 0, first: false });
      await createSaveStore(storage).load();
      expect(storage.items.get(SAVE_INVALID_KEY)).toEqual({ version: 0, first: true });
      expect(storage.items.get(SAVE_KEY)).toEqual(DEFAULTS);
    });

    it('keeps a first copy that is not JSON too', async () => {
      storage.garbled.set(SAVE_INVALID_KEY, '{first');
      storage.items.set(SAVE_KEY, { version: 0 });
      await createSaveStore(storage).load();
      expect(storage.garbled.get(SAVE_INVALID_KEY)).toBe('{first');
      expect(storage.items.has(SAVE_INVALID_KEY)).toBe(false);
    });
  });

  describe('a save from a newer game (story 2.8)', () => {
    const FUTURE = {
      version: 4,
      calibration: CALIBRATION,
      settings: SETTINGS,
      somethingNew: true,
    };

    it('is left in place, copied aside, with one warning; the session runs on defaults', async () => {
      storage.items.set(SAVE_KEY, FUTURE);
      const store = createSaveStore(storage);
      expect(await store.load()).toEqual(DEFAULTS);
      expect(storage.items.get(SAVE_KEY)).toBe(FUTURE);
      expect(storage.items.get(SAVE_INVALID_KEY)).toEqual(FUTURE);
      expect(newWarnings()).toHaveLength(1);
    });

    it('never writes the save key afterwards, but keeps what the player sets in memory', async () => {
      storage.items.set(SAVE_KEY, FUTURE);
      const store = createSaveStore(storage);
      await store.load();
      await store.setCalibration(CALIBRATION);
      await store.setSettings({ ...SETTINGS, tier: 'assistance' });
      expect(store.current().settings.tier).toBe('assistance');
      expect(store.current().calibration).toEqual(CALIBRATION);
      expect(storage.items.get(SAVE_KEY)).toBe(FUTURE);
      expect(newWarnings()).toHaveLength(1);
    });

    it('does not overwrite a first copy', async () => {
      storage.items.set(SAVE_INVALID_KEY, 'older');
      storage.items.set(SAVE_KEY, FUTURE);
      await createSaveStore(storage).load();
      expect(storage.items.get(SAVE_INVALID_KEY)).toBe('older');
    });
  });

  describe('setSettings (story 2.8)', () => {
    const NEXT = {
      tier: 'experienced',
      volumes: { music: 40, sfx: 100, voice: 0, ui: 95 },
      haptics: false,
      reducedMotion: true,
      largeVerbs: true,
    } as const;

    it('writes the settings under the save key and keeps them in memory, calibration included', async () => {
      const store = createSaveStore(storage);
      await store.load();
      await store.setCalibration(CALIBRATION);
      await store.setSettings(NEXT);
      expect(store.current().settings).toEqual(NEXT);
      expect(storage.items.get(SAVE_KEY)).toEqual({
        ...DEFAULTS,
        calibration: CALIBRATION,
        settings: NEXT,
      });
    });

    it('is in memory before the write lands', async () => {
      const store = createSaveStore(storage);
      await store.load();
      const pending = store.setSettings(NEXT);
      expect(store.current().settings).toEqual(NEXT);
      await pending;
    });

    it('warns once while the storage keeps failing, and again after a write succeeds', async () => {
      const store = createSaveStore(storage);
      await store.load();
      storage.failing.add('set');
      for (const music of [10, 20, 30, 40]) {
        await store.setSettings({ ...SETTINGS, volumes: { ...SETTINGS.volumes, music } });
      }
      expect(store.current().settings.volumes.music).toBe(40);
      expect(newWarnings()).toEqual(['the save could not be written']);
      storage.failing.delete('set');
      await store.setSettings(SETTINGS);
      storage.failing.add('set');
      await store.setSettings(NEXT);
      await store.setSettings(SETTINGS);
      expect(newWarnings()).toEqual([
        'the save could not be written',
        'the save could not be written',
      ]);
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

  it('tells a version from the future apart from a save it cannot use', () => {
    expect(migrateSave({ version: 3 }, MIGRATIONS, 2)).toMatchObject({ ok: false, kind: 'future' });
    expect(migrateSave({ version: 0 }, [], 2)).toMatchObject({ ok: false, kind: 'unusable' });
    expect(migrateSave('x', MIGRATIONS, 2)).toMatchObject({ ok: false, kind: 'unusable' });
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

  it('refuses a migration that throws or returns something that is not an object', () => {
    const throws: SaveMigration = {
      from: 0,
      migrate: () => {
        throw new Error('boom');
      },
    };
    expect(migrateSave({ version: 0 }, [throws], 1)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('boom'),
    });
    for (const result of [null, 'x', [], undefined]) {
      const lies = { from: 0, migrate: () => result } as unknown as SaveMigration;
      expect(migrateSave({ version: 0 }, [lies], 1), String(result)).toMatchObject({ ok: false });
    }
  });

  it('refuses what is not a save', () => {
    for (const raw of [null, 'x', 3, [], {}, { version: '1' }, { version: 0.5 }]) {
      expect(migrateSave(raw, MIGRATIONS, 2), JSON.stringify(raw)).toMatchObject({ ok: false });
    }
  });

  it('runs a migration through the store: a v0 save is brought to v2 and written back', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 0, calibrated: null });
    const store = createSaveStore(storage, {
      migrations: [
        { from: 0, migrate: (save) => ({ version: 1, calibration: save.calibrated }) },
        ...SAVE_MIGRATIONS,
      ],
    });
    expect(await store.load()).toEqual(DEFAULTS);
    expect(storage.items.get(SAVE_KEY)).toEqual(DEFAULTS);
    expect(storage.items.has(SAVE_INVALID_KEY)).toBe(false);
  });

  it('never throws on a migration that throws: the save is set aside and replaced by defaults', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 0 });
    const store = createSaveStore(storage, {
      migrations: [
        {
          from: 0,
          migrate: () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(await store.load()).toMatchObject({ calibration: null });
    expect(storage.items.get(SAVE_INVALID_KEY)).toEqual({ version: 0 });
  });
});

describe('the v1 → v2 migration (story 2.8)', () => {
  it('keeps the calibration of a real v1 save and adds the default settings', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 1, calibration: CALIBRATION });
    const store = createSaveStore(storage);
    expect(await store.load()).toEqual({ ...DEFAULTS, calibration: CALIBRATION });
    expect(storage.items.get(SAVE_KEY)).toEqual({ ...DEFAULTS, calibration: CALIBRATION });
    expect(storage.items.has(SAVE_INVALID_KEY)).toBe(false);
  });

  it('migrates a v1 save with no calibration', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 1, calibration: null });
    expect(await createSaveStore(storage).load()).toEqual(DEFAULTS);
  });

  it('is pure: the input is not changed, and each call gets its own settings', () => {
    const v1 = Object.freeze({ version: 1, calibration: CALIBRATION });
    const step = SAVE_MIGRATIONS.find((migration) => migration.from === 1);
    const a = step?.migrate(v1);
    const b = step?.migrate(v1);
    expect(v1).toEqual({ version: 1, calibration: CALIBRATION });
    expect(a).toEqual({
      version: 2,
      calibration: CALIBRATION,
      settings: {
        tier: 'normal',
        volumes: { music: 100, sfx: 100, voice: 100, ui: 100 },
        haptics: true,
      },
    });
    expect((a?.settings as object) === (b?.settings as object)).toBe(false);
  });

  it('writes the settings of version 2, with none of the later switches', () => {
    const step = SAVE_MIGRATIONS.find((migration) => migration.from === 1);
    const settings = step?.migrate({ version: 1, calibration: null }).settings as object;
    expect(Object.keys(settings).sort()).toEqual(['haptics', 'tier', 'volumes']);
  });
});

describe('the v2 → v3 migration (story 2.10)', () => {
  const V2_SETTINGS = {
    tier: 'experienced',
    volumes: { music: 40, sfx: 55, voice: 70, ui: 85 },
    haptics: false,
  };
  const step = SAVE_MIGRATIONS.find((migration) => migration.from === 2);

  it('is in the table', () => {
    expect(step).toBeDefined();
  });

  it('keeps the calibration and every other setting, and adds both switches off', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 2, calibration: CALIBRATION, settings: V2_SETTINGS });
    const expected = {
      version: 3,
      calibration: CALIBRATION,
      settings: { ...V2_SETTINGS, reducedMotion: false, largeVerbs: false },
    };
    expect(await createSaveStore(storage).load()).toEqual(expected);
    expect(storage.items.get(SAVE_KEY)).toEqual(expected);
    expect(storage.items.has(SAVE_INVALID_KEY)).toBe(false);
  });

  it('is pure: the input is not changed, and each call gets its own settings', () => {
    const v2 = Object.freeze({
      version: 2,
      calibration: null,
      settings: Object.freeze({ ...V2_SETTINGS }),
    });
    const a = step?.migrate(v2);
    const b = step?.migrate(v2);
    expect(v2).toEqual({ version: 2, calibration: null, settings: V2_SETTINGS });
    expect(a?.version).toBe(3);
    expect((a?.settings as object) === (b?.settings as object)).toBe(false);
    expect((a?.settings as object) === (v2.settings as object)).toBe(false);
  });

  it('keeps a switch that is already there instead of overwriting it', () => {
    const migrated = step?.migrate({
      version: 2,
      calibration: null,
      settings: { ...V2_SETTINGS, reducedMotion: true },
    });
    expect(migrated?.settings).toEqual({
      ...V2_SETTINGS,
      reducedMotion: true,
      largeVerbs: false,
    });
  });

  it('does not repair a v2 save with no settings: it is still refused and set aside as it was (trap 1)', async () => {
    const storage = fakeStorage();
    const stored = { version: 2, calibration: null };
    storage.items.set(SAVE_KEY, stored);
    expect(await createSaveStore(storage).load()).toEqual(DEFAULTS);
    expect(storage.items.get(SAVE_INVALID_KEY)).toEqual(stored);
  });

  it.each<[string, unknown]>([
    ['a string', 'normal'],
    ['null', null],
    ['an array', [1, 2]],
  ])('does not repair a v2 save whose settings are %s', (_name, settings) => {
    const migrated = step?.migrate({ version: 2, calibration: null, settings });
    expect(SaveSchema.safeParse(migrated).success).toBe(false);
  });

  it('brings a v1 save to a valid v3 one with the calibration kept (trap 2)', async () => {
    const storage = fakeStorage();
    storage.items.set(SAVE_KEY, { version: 1, calibration: CALIBRATION });
    const store = createSaveStore(storage);
    expect(await store.load()).toEqual({ ...DEFAULTS, calibration: CALIBRATION });
    expect(SaveSchema.safeParse(storage.items.get(SAVE_KEY)).success).toBe(true);
    expect(storage.items.has(SAVE_INVALID_KEY)).toBe(false);
  });
});
