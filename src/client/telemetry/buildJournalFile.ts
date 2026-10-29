import type { ContentBundle } from '@content/contentBundle';
import {
  JOURNAL_FILE_KIND,
  JOURNAL_FILE_VERSION,
  type JournalFile,
} from '@content/schemas/journal';
import { hashJson } from '@shared/hash';
import type { LogEntry } from '@shared/log';
import type { Sim } from '@sim';
import type { DeviceDescription } from './describeDevice.ts';
import type { GameSummary } from './gameSummary.ts';
import { toJsonSafe } from './toJsonSafe.ts';

export interface BuildJournalFileInput {
  /** The sim of the level that was played (frozen or not): read, never changed. */
  sim: Sim;
  levelId: string;
  /** The content the page loaded, before any level `feelOverrides`: its hash is the file's `contentHash`. */
  baseContent: ContentBundle;
  /** The invariant mode the live sim ran with. */
  strictInvariants: boolean;
  summary: GameSummary;
  device: DeviceDescription;
  /** `platform.capabilities.target`. */
  target: JournalFile['device']['target'];
  /** `log.buffer()`: the last `info`-and-above entries, oldest first. */
  logs: readonly LogEntry[];
}

function logOf(entry: LogEntry): JournalFile['diagnostics']['logs'][number] {
  const data = toJsonSafe(entry.data);
  const base = {
    atReal: entry.atReal,
    level: entry.level,
    channel: entry.channel,
    message: entry.message,
  };
  return data === undefined ? base : { ...base, data };
}

/**
 * The file a tester exports from the Result screen (story 3.3): the sim's journal wrapped with what
 * `sim:replay` needs to rebuild the game, the summary story 3.4 reads, the kind of device and the
 * last log entries. Pure: it reads the sim and hashes, draws no real time and no randomness, and
 * puts nothing personal in the file (the caller passes the device already reduced to its kind).
 */
export function buildJournalFile(input: BuildJournalFileInput): JournalFile {
  const { sim } = input;
  return {
    kind: JOURNAL_FILE_KIND,
    version: JOURNAL_FILE_VERSION,
    replay: {
      levelId: input.levelId,
      contentHash: hashJson(input.baseContent),
      strictInvariants: input.strictInvariants,
      endSimMs: sim.world.time.sim,
      worldHash: hashJson(sim.world),
      journal: sim.journal(),
    },
    summary: input.summary,
    device: { type: input.device.type, platform: input.device.platform, target: input.target },
    diagnostics: { logs: input.logs.map(logOf) },
  };
}
