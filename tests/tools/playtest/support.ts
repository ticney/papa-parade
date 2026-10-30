import {
  JOURNAL_FILE_KIND,
  JOURNAL_FILE_VERSION,
  type JournalFile,
  JournalSchema,
} from '@content/schemas/journal';

type Device = 'touch' | 'mouse' | 'keyboard' | 'gamepad' | 'none';
type Quality = 'perfect' | 'success' | 'fail';

export interface ResponseSpec {
  threat: string;
  quality: Quality;
  device?: Device;
  reason?: string | null;
}

export interface JournalSpec {
  sessionId?: string;
  gameIndex?: number;
  autoplay?: string | null;
  levelId?: string;
  contentHash?: string;
  worldHash?: string;
  endReason?: string;
  stars?: number;
  responses?: ResponseSpec[];
  deviceType?: 'phone' | 'tablet' | 'desktop';
}

const DEVICES: Device[] = ['touch', 'mouse', 'keyboard', 'gamepad', 'none'];

/** A small exported journal, for the pure tests: the counts are derived from the responses. */
export function makeJournal(spec: JournalSpec = {}): JournalFile {
  const responses = spec.responses ?? [];
  const zero = () => ({ perfect: 0, success: 0, fail: 0 });
  const byDevice = Object.fromEntries(DEVICES.map((device) => [device, zero()])) as Record<
    Device,
    ReturnType<typeof zero>
  >;
  const byThreat: Record<string, ReturnType<typeof zero>> = {};
  const byQuality = zero();
  for (const response of responses) {
    byDevice[response.device ?? 'touch'][response.quality]++;
    const counts = byThreat[response.threat] ?? zero();
    counts[response.quality]++;
    byThreat[response.threat] = counts;
    byQuality[response.quality]++;
  }
  const file: JournalFile = {
    kind: JOURNAL_FILE_KIND,
    version: JOURNAL_FILE_VERSION,
    replay: {
      levelId: spec.levelId ?? 'salon_crawler',
      contentHash: spec.contentHash ?? 'c0c0c0c0c0c0c0',
      strictInvariants: false,
      endSimMs: 180_000,
      worldHash: spec.worldHash ?? 'abababababab',
      journal: {
        version: 3,
        seed: 1,
        feelHash: 'aaaaaaaaaaaaaa',
        geometryHash: 'bbbbbbbbbbbbbb',
        levelHash: 'cccccccccccccc',
        startSimMs: 0,
        entries: [],
      },
    },
    summary: {
      sessionId: spec.sessionId ?? '00000001',
      gameIndexInSession: spec.gameIndex ?? 1,
      autoplay: spec.autoplay ?? null,
      endReason: spec.endReason ?? 'timer',
      score: {
        laughPoints: 0,
        babyStatePoints: 0,
        sighPoints: 0,
        screamPoints: 0,
        scorePoints: 0,
        stars: spec.stars ?? 2,
        lostStars: 0,
      },
      responses: {
        byQuality,
        byThreat,
        timeline: responses.map((response, index) => ({
          t: 1000 * (index + 1),
          threatDefId: response.threat,
          quality: response.quality,
          reason: response.reason ?? (response.quality === 'fail' ? 'late' : null),
          offsetMs: response.quality === 'fail' ? null : 0,
          device: response.device ?? 'touch',
        })),
        byDevice,
      },
      dominantDevice: 'touch',
    },
    device: { type: spec.deviceType ?? 'phone', platform: 'ios', target: 'web' },
    diagnostics: { logs: [] },
  };
  // A helper that builds an invalid file would make every test below vacuous.
  const checked = JournalSchema.safeParse(file);
  if (!checked.success) throw new Error(`support.makeJournal is invalid: ${checked.error.message}`);
  return file;
}
