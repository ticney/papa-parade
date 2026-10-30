import {
  type CalibrationResult,
  createDefaultSave,
  type Save,
  SaveSchema,
} from '@content/schemas/save';
import type { StoragePort } from '@platform/platform';
import { SAVE_INVALID_KEY, SAVE_KEY, SAVE_VERSION } from '@shared/constants';
import { log } from '@shared/log';

/** One step of the ordered table: turns a `from` save into a `from + 1` one. Pure. */
export interface SaveMigration {
  readonly from: number;
  migrate(save: Record<string, unknown>): Record<string, unknown>;
}

/** `v{n-1} → v{n}`, in order. Empty today: v1 is the first version (story 2.8 adds the next). */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [];

export type MigrationOutcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
    return { ok: false, reason: 'not an object with a whole version' };
  }
  let current = raw;
  let version = raw.version as number;
  if (version > targetVersion) {
    return { ok: false, reason: `version ${version} is newer than this game (${targetVersion})` };
  }
  while (version < targetVersion) {
    const step = migrations.find((migration) => migration.from === version);
    if (step === undefined) return { ok: false, reason: `no migration from version ${version}` };
    current = step.migrate(current);
    version += 1;
    if (current.version !== version) {
      return {
        ok: false,
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

  async function write(): Promise<void> {
    const result = await storage.set(SAVE_KEY, save);
    if (!result.ok) log.warn('storage', 'the save could not be written', result.error);
  }

  async function setAside(raw: unknown, reason: string): Promise<void> {
    log.warn('storage', 'the save is unusable: set aside, starting from defaults', { reason });
    const kept = await storage.set(SAVE_INVALID_KEY, raw);
    if (!kept.ok) log.warn('storage', 'the unusable save could not be set aside', kept.error);
    save = createDefaultSave();
    await write();
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
        await setAside(read.value, migrated.reason);
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
  };
}
