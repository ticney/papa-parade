import { STEP_MS, UINT32_RANGE } from '@shared/constants';
import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';
import '../zodConfig.ts';

// The file a tester exports from the Result screen of a playtest build (story 3.3): the sim's
// journal wrapped with what `npm run sim:replay` needs to rebuild the game, a summary that story 3.4
// computes the playtest indicators from, the kind of device, and the last log entries. It is not a
// content file: nothing loads it, so it has no entry in `contentFiles.ts` and no JSON Schema in
// `content/_schemas/`. Strict at every level this story defines; the opaque fields are a journal
// command and a log entry's `data`. Nothing in it is personal (NFR14): no user-agent, no date.

export const JOURNAL_FILE_KIND = 'papa-parade.journal';
export const JOURNAL_FILE_VERSION = 1;

const counter = z.int().min(0);

const ResponseCountsSchema = z.strictObject({
  perfect: counter,
  success: counter,
  fail: counter,
});

const ResponseQualitySchema = z.enum(['perfect', 'success', 'fail']);

/** The input device a response is credited to: `pointer` is split into `touch` and `mouse` by the client. */
const InputDeviceSchema = z.enum(['touch', 'mouse', 'keyboard', 'gamepad', 'none']);

/**
 * The envelope of `Journal` from `@sim` (the content layer cannot import it). A command stays opaque
 * beyond its type: `replayJournal` checks it deeply (`journalProblem` / `commandProblem`) when the
 * file is replayed.
 */
const JournalEnvelopeSchema = z.strictObject({
  version: z.literal(3),
  seed: z.int().min(0).lt(UINT32_RANGE),
  feelHash: z.string(),
  geometryHash: z.string(),
  levelHash: z.string(),
  startSimMs: z.number(),
  entries: z.array(
    z.strictObject({
      applyAt: z.int().multipleOf(STEP_MS),
      command: z.looseObject({ type: z.string() }),
    }),
  ),
});

const ReplaySchema = z.strictObject({
  levelId: z.string().regex(SNAKE_ID_PATTERN),
  contentHash: z.string(),
  strictInvariants: z.boolean(),
  endSimMs: z.number().min(0),
  worldHash: z.string(),
  journal: JournalEnvelopeSchema,
});

const ScoreSchema = z.strictObject({
  laughPoints: z.number(),
  babyStatePoints: z.number(),
  sighPoints: z.number(),
  screamPoints: z.number(),
  scorePoints: z.number(),
  stars: counter,
  lostStars: counter,
});

const TimelineEntrySchema = z.strictObject({
  t: z.number(),
  threatDefId: z.string(),
  quality: ResponseQualitySchema,
  reason: z.string().nullable(),
  offsetMs: z.number().nullable(),
  device: InputDeviceSchema,
});

const SummarySchema = z.strictObject({
  sessionId: z.string().regex(/^[0-9a-f]{8}$/),
  gameIndexInSession: z.int().min(1),
  autoplay: z.string().nullable(),
  endReason: z.string(),
  score: ScoreSchema,
  responses: z.strictObject({
    byQuality: ResponseCountsSchema,
    byThreat: z.record(z.string(), ResponseCountsSchema),
    timeline: z.array(TimelineEntrySchema),
    byDevice: z.strictObject({
      touch: ResponseCountsSchema,
      mouse: ResponseCountsSchema,
      keyboard: ResponseCountsSchema,
      gamepad: ResponseCountsSchema,
      none: ResponseCountsSchema,
    }),
  }),
  dominantDevice: InputDeviceSchema,
});

const DeviceSchema = z.strictObject({
  type: z.enum(['phone', 'tablet', 'desktop']),
  platform: z.enum(['ios', 'android', 'macos', 'windows', 'linux', 'other']),
  target: z.enum(['web', 'ios', 'android']),
});

const LogEntrySchema = z.strictObject({
  atReal: z.number(),
  level: z.enum(['error', 'warn', 'info', 'debug']),
  channel: z.string(),
  message: z.string(),
  // Opaque, and absent when the entry logged no data (`toJsonSafe` made it JSON-safe).
  data: z.unknown().optional(),
});

export const JournalSchema = z.strictObject({
  kind: z.literal(JOURNAL_FILE_KIND),
  version: z.literal(JOURNAL_FILE_VERSION),
  replay: ReplaySchema,
  summary: SummarySchema,
  device: DeviceSchema,
  diagnostics: z.strictObject({ logs: z.array(LogEntrySchema) }),
});

export type JournalFile = z.infer<typeof JournalSchema>;
