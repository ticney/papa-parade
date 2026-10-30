import type { JournalFile } from '@content/schemas/journal';
import type { SimEvent } from '@sim';

/** The summary block of the exported journal (story 3.3): what story 3.4 computes the indicators from. */
export type GameSummary = JournalFile['summary'];

/**
 * The input device a response is credited to. The client's `pointer` is split into `touch` and
 * `mouse` by the `pointerType` of the last `pointerdown`, so that a desktop tester's clicks never
 * count as touch; `none` is no input (an autoplay game blocks the player's).
 */
export type JournalDevice = GameSummary['dominantDevice'];

export const JOURNAL_DEVICES = [
  'touch',
  'mouse',
  'keyboard',
  'gamepad',
  'none',
] as const satisfies readonly JournalDevice[];

type ResponseCounts = GameSummary['responses']['byQuality'];
type TimelineEntry = GameSummary['responses']['timeline'][number];

export interface GameSummaryOptions {
  /** 8 hex chars drawn once per page load. */
  sessionId: string;
  /** 1 for the first level started since the page loaded. */
  gameIndexInSession: number;
  /** The bot that played this game (`?autoplay=<bot>`), else `null`. */
  autoplay: string | null;
}

/**
 * A pure recorder of one game: it is fed the sim events the client received and the device the
 * player used when each arrived, and it reads nothing else (no world, no clock, no DOM).
 */
export interface GameSummaryRecorder {
  /** `event` is not kept: its fields are copied. */
  onEvent(event: SimEvent, device: JournalDevice): void;
  /** The device of an input of the player. With no response in the game, the last one is the dominant device. */
  onInput(device: JournalDevice): void;
  /** A fresh copy, or `null` until the level has ended and been scored. */
  summary(): GameSummary | null;
}

function emptyCounts(): ResponseCounts {
  return { perfect: 0, success: 0, fail: 0 };
}

export function createGameSummary(options: GameSummaryOptions): GameSummaryRecorder {
  const defIdOf = new Map<number, string>();
  const byQuality = emptyCounts();
  const byThreat = new Map<string, ResponseCounts>();
  const byDevice: Record<JournalDevice, ResponseCounts> = {
    touch: emptyCounts(),
    mouse: emptyCounts(),
    keyboard: emptyCounts(),
    gamepad: emptyCounts(),
    none: emptyCounts(),
  };
  const timeline: TimelineEntry[] = [];
  let lastInput: JournalDevice = 'none';
  let endReason: string | null = null;
  let score: GameSummary['score'] | null = null;

  /** The device with the most responses; a tie goes to the one used last among the tied ones. */
  function dominantDevice(): JournalDevice {
    if (timeline.length === 0) return lastInput;
    const counts: Record<JournalDevice, number> = {
      touch: 0,
      mouse: 0,
      keyboard: 0,
      gamepad: 0,
      none: 0,
    };
    const lastUsedAt: Record<JournalDevice, number> = {
      touch: -1,
      mouse: -1,
      keyboard: -1,
      gamepad: -1,
      none: -1,
    };
    timeline.forEach((entry, index) => {
      counts[entry.device]++;
      lastUsedAt[entry.device] = index;
    });
    let best: JournalDevice = 'none';
    for (const device of JOURNAL_DEVICES) {
      const isBetter =
        counts[device] > counts[best] ||
        (counts[device] === counts[best] && lastUsedAt[device] > lastUsedAt[best]);
      if (isBetter) best = device;
    }
    return best;
  }

  return {
    onEvent(event, device) {
      switch (event.type) {
        case 'ThreatTelegraphed':
        case 'ThreatHidden':
          defIdOf.set(event.threatId, event.kind);
          break;
        case 'ResponseResolved': {
          const threatDefId = defIdOf.get(event.threatId) ?? `threat_${event.threatId}`;
          let threat = byThreat.get(threatDefId);
          if (threat === undefined) {
            threat = emptyCounts();
            byThreat.set(threatDefId, threat);
          }
          byQuality[event.quality]++;
          threat[event.quality]++;
          byDevice[device][event.quality]++;
          timeline.push({
            t: event.t,
            threatDefId,
            quality: event.quality,
            reason: event.reason ?? null,
            offsetMs: event.offsetMs,
            device,
          });
          break;
        }
        case 'LevelEnded':
          endReason = event.reason;
          break;
        case 'LevelScored':
          score = {
            laughPoints: event.laughPoints,
            babyStatePoints: event.babyStatePoints,
            sighPoints: event.sighPoints,
            screamPoints: event.screamPoints,
            scorePoints: event.scorePoints,
            stars: event.stars,
            lostStars: event.lostStars,
          };
          break;
        default:
          break;
      }
    },
    onInput(device) {
      lastInput = device;
    },
    summary() {
      if (endReason === null || score === null) return null;
      return {
        sessionId: options.sessionId,
        gameIndexInSession: options.gameIndexInSession,
        autoplay: options.autoplay,
        endReason,
        score: { ...score },
        responses: {
          byQuality: { ...byQuality },
          byThreat: Object.fromEntries(
            [...byThreat].map(([defId, counts]) => [defId, { ...counts }]),
          ),
          timeline: timeline.map((entry) => ({ ...entry })),
          byDevice: {
            touch: { ...byDevice.touch },
            mouse: { ...byDevice.mouse },
            keyboard: { ...byDevice.keyboard },
            gamepad: { ...byDevice.gamepad },
            none: { ...byDevice.none },
          },
        },
        dominantDevice: dominantDevice(),
      };
    },
  };
}
