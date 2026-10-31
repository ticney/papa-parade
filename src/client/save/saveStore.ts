import {
  type CalibrationResult,
  createDefaultSave,
  createDefaultSettings,
  type Save,
  SaveSchema,
  type Settings,
} from '@content/schemas/save';
import type { StoragePort } from '@platform/platform';
import { SAVE_INVALID_KEY, SAVE_KEY, SAVE_VERSION } from '@shared/constants';
import { log } from '@shared/log';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a past game stored under a key, read as a record: anything else is nothing to spread. */
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** One step of the ordered table: turns a `from` save into a `from + 1` one. Pure. */
export interface SaveMigration {
  readonly from: number;
  migrate(save: Record<string, unknown>): Record<string, unknown>;
}

/**
 * `v{n-1} → v{n}`, in order. `v1 → v2` (story 2.8) adds the settings, with their defaults, and keeps
 * the calibration. `v2 → v3` (story 2.10) adds the two comfort switches, off, and keeps every other
 * setting; a v2 save with no usable `settings` is not repaired, so the schema still refuses it. Pure:
 * the input is not changed.
 */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  {
    from: 1,
    migrate: (save) => ({ ...save, version: 2, settings: createDefaultSettings() }),
  },
  {
    from: 2,
    migrate: (save) => ({
      ...save,
      version: 3,
      settings: { ...asRecord(save.settings), reducedMotion: false, largeVerbs: false },
    }),
  },
];

/**
 * `future`: a save written by a newer game. It is not damaged, so it must not be replaced (a
 * rollback of the game would destroy it). `unusable`: everything else that cannot be brought to
 * the current version.
 */
export type MigrationOutcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; kind: 'future' | 'unusable'; reason: string };

/**
 * Brings a stored save to `targetVersion` by running the migrations in order. Refuses what is not
 * an object with a whole `version`, a version from the future, and a version no migration reaches.
 */
export function migrateSave(
  raw: unknown,
  migrations: readonly SaveMigration[],
  targetVersion: number,
): MigrationOutcome {
  if (!isRecord(raw) || !Number.isInteger(raw.version)) {
    return { ok: false, kind: 'unusable', reason: 'not an object with a whole version' };
  }
  let current = raw;
  let version = raw.version as number;
  if (version > targetVersion) {
    return {
      ok: false,
      kind: 'future',
      reason: `version ${version} is newer than this game (${targetVersion})`,
    };
  }
  while (version < targetVersion) {
    const step = migrations.find((migration) => migration.from === version);
    if (step === undefined) {
      return { ok: false, kind: 'unusable', reason: `no migration from version ${version}` };
    }
    // A migration works on whatever a past game stored: a throw is an unusable save, not a crash
    // (`load` is awaited before the start screen exists).
    let migrated: unknown;
    try {
      migrated = step.migrate(current);
    } catch (cause) {
      return {
        ok: false,
        kind: 'unusable',
        reason: `the migration from ${version} threw: ${String(cause)}`,
      };
    }
    if (!isRecord(migrated)) {
      return {
        ok: false,
        kind: 'unusable',
        reason: `the migration from ${version} did not return an object`,
      };
    }
    current = migrated;
    version += 1;
    if (current.version !== version) {
      return {
        ok: false,
        kind: 'unusable',
        reason: `the migration from ${version - 1} left version ${current.version}`,
      };
    }
  }
  return { ok: true, value: current };
}

/** One short line for a failed parse: `calibration.visualOffsetMs: expected number, received string`. */
function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export interface SaveStore {
  /** Reads, migrates and checks the save. Never throws; a bad save is set aside and replaced by defaults. */
  load(): Promise<Save>;
  /** The save in memory: the defaults until `load` settles, and always the latest `setCalibration`. */
  current(): Save;
  /** Replaces the calibration. The value stays in memory even when the write fails. */
  setCalibration(calibration: CalibrationResult): Promise<void>;
  /**
   * Replaces the settings (story 2.8): memory at once, then the write. A slider calls it on every
   * tick, so a failing storage warns once until a write succeeds again.
   */
  setSettings(settings: Settings): Promise<void>;
}

export interface CreateSaveStoreOptions {
  migrations?: readonly SaveMigration[];
}

export function createSaveStore(
  storage: StoragePort,
  options: CreateSaveStoreOptions = {},
): SaveStore {
  const migrations = options.migrations ?? SAVE_MIGRATIONS;
  let save = createDefaultSave();
  // A save from a newer game stays where it is: the session runs on defaults and never writes.
  let isReadOnly = false;
  // A slider sends many writes: a failing storage warns once, until a write succeeds again.
  let hasWarnedOfWrite = false;

  async function write(): Promise<void> {
    if (isReadOnly) return;
    const result = await storage.set(SAVE_KEY, save);
    if (result.ok) {
      hasWarnedOfWrite = false;
      return;
    }
    if (!hasWarnedOfWrite) log.warn('storage', 'the save could not be written', result.error);
    hasWarnedOfWrite = true;
  }

  /** Keeps `raw` in `SAVE_INVALID_KEY` unless that key already holds a copy: the first one is kept. */
  async function keepCopy(raw: unknown): Promise<void> {
    const existing = await storage.get(SAVE_INVALID_KEY);
    // An unreadable key (`invalid`) holds something too: only a clean `null` is free.
    if (!existing.ok || existing.value !== null) {
      if (!existing.ok && existing.error.kind === 'unavailable') {
        log.warn('storage', 'the unusable save could not be set aside', existing.error);
      }
      return;
    }
    const kept = await storage.set(SAVE_INVALID_KEY, raw);
    if (!kept.ok) log.warn('storage', 'the unusable save could not be set aside', kept.error);
  }

  async function setAside(raw: unknown, reason: string): Promise<void> {
    log.warn('storage', 'the save is unusable: set aside, starting from defaults', { reason });
    await keepCopy(raw);
    save = createDefaultSave();
    await write();
  }

  async function leaveInPlace(raw: unknown, reason: string): Promise<void> {
    log.warn('storage', 'the save is from a newer game: left in place, running on defaults', {
      reason,
    });
    await keepCopy(raw);
    save = createDefaultSave();
    isReadOnly = true;
  }

  return {
    async load() {
      const read = await storage.get(SAVE_KEY);
      if (!read.ok) {
        if (read.error.kind === 'invalid') {
          await setAside(read.error.raw ?? null, read.error.message);
        } else {
          log.warn('storage', 'the save could not be read: starting from defaults', read.error);
          save = createDefaultSave();
        }
        return save;
      }
      if (read.value === null) {
        save = createDefaultSave();
        return save;
      }
      const migrated = migrateSave(read.value, migrations, SAVE_VERSION);
      if (!migrated.ok) {
        if (migrated.kind === 'future') await leaveInPlace(read.value, migrated.reason);
        else await setAside(read.value, migrated.reason);
        return save;
      }
      const parsed = SaveSchema.safeParse(migrated.value);
      if (!parsed.success) {
        await setAside(read.value, describeIssues(parsed.error.issues));
        return save;
      }
      save = parsed.data;
      if (migrated.value !== read.value) await write();
      return save;
    },
    current: () => save,
    async setCalibration(calibration) {
      save = { ...save, calibration };
      await write();
    },
    async setSettings(settings) {
      save = { ...save, settings };
      await write();
    },
  };
}
