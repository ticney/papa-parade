import {
  MAX_BABY_RADIUS_M,
  MAX_CRAWL_SPEED_MPS,
  MAX_PAPA_RADIUS_M,
  MAX_WALK_SPEED_MPS,
} from '@shared/constants';
import { z } from 'zod';

// Every key of content/feel.json lives here. No `.default()`, `.optional()`, `.transform()` or
// `.preprocess()`: the file, the type and the emitted JSON Schema map one to one, and every key is
// written in the file. Tunable values live in the JSON, never here (only validation bounds do).

const durationMs = (description: string) => z.number().positive().describe(description);
const delayMs = (description: string) => z.number().min(0).describe(description);
const pct = (description: string) => z.number().min(0).max(100).describe(description);
const points = (description: string) => z.number().min(0).describe(description);
const multiplier = (description: string) => z.number().min(0).describe(description);
const count = (description: string) => z.int().min(0).describe(description);
const timeScale = (description: string) => z.number().gt(0).max(1).describe(description);

const slowMo = (description: string) =>
  z
    .strictObject({
      timeScale: timeScale('Sim speed during the slow-mo (1 = normal, 0.3 = 30 % speed).'),
      durationMs: durationMs('How long the slow-mo holds, in **sim** ms (ADR-002).'),
      returnMs: delayMs('Return to the base scale after the slow-mo, in sim ms (0 = instant).'),
    })
    .describe(description);

const difficultyTier = (description: string) =>
  z
    .strictObject({
      windowMultiplier: multiplier('Multiplier applied to every response window of the tier.'),
      hasInstinct: z.boolean().describe('Whether Fatherly Instinct (GDD §9) is available.'),
    })
    .describe(description);

const TimingSchema = z
  .strictObject({
    telegraphDelayDefaultMs: durationMs(
      'Telegraph delay used when a threat declares `telegraphDelayMs: null`, in ms (GDD §1: 0.8 to 1.5 s per threat).',
    ),
    windowMs: durationMs('Standard response window, in ms (GDD §1).'),
    perfectMs: durationMs('Perfect-response window, centred in the response window, in ms.'),
    toleranceMs: delayMs('Hidden tolerance added on each side of the window, in ms (GDD §1).'),
    bufferMs: delayMs(
      'Input buffer: a press this early before the window is kept, in ms (GDD §1).',
    ),
    hitstopMs: delayMs(
      'Real-time freeze on a successful or perfect response, in real ms (GDD §1).',
    ),
    slowMoPerfect: slowMo('Slow-mo played on a perfect response.'),
    slowMoLastThreat: slowMo('Slow-mo played on the last threat of a wave.'),
  })
  .refine((timing) => timing.perfectMs <= timing.windowMs, {
    path: ['perfectMs'],
    error: 'perfectMs must not exceed windowMs',
  })
  .describe('Response timing (GDD §1, §2).');

const InputSchema = z
  .strictObject({
    holdMinMs: durationMs(
      'A press released before this is a Parry, one held to or past it is a Firmness (ADR-010), in ms.',
    ),
    earlyPress: z
      .enum(['fail', 'guard'])
      .describe(
        'What a press before the window (minus tolerance and buffer) does to the judgement: `fail` triggers the gag, `guard` ignores it. Papa glides to the threat in both cases.',
      ),
    touchRadiusPx: z
      .number()
      .positive()
      .describe('Generous touch radius around a threat, in screen px (targets stay >= 44 pt).'),
    autoTargetConeDeg: z
      .number()
      .gt(0)
      .max(360)
      .describe('Auto-target cone for keyboard and gamepad, in degrees (story 1.17).'),
    stickDeadzonePct: z
      .number()
      .min(0)
      .lt(100)
      .describe(
        'Left-stick deadzone: a push under this share of the full range is no direction, in percent.',
      ),
    stickAngleStepDeg: z
      .number()
      .gt(0)
      .max(90)
      .describe(
        'The left-stick direction is rounded to a multiple of this angle before it is sent, so a resting hand does not flood the journal, in degrees.',
      ),
  })
  .describe('Input interpretation (GDD §2, ADR-010).');

const MovementSchema = z
  .strictObject({
    glideMaxMs: durationMs(
      "Papa's glide towards a target takes at most this long, in ms (GDD §3).",
    ),
    walkSpeedMps: z
      .number()
      .positive()
      .max(MAX_WALK_SPEED_MPS)
      .describe('Papa walking speed (tap on the floor, keys, stick), in metres per second.'),
    papaRadiusM: z
      .number()
      .min(0)
      .max(MAX_PAPA_RADIUS_M)
      .describe(
        "Papa's half width, in metres: his centre stays this far from furniture and walls. Read once when the level starts: a `SetFeel` takes effect at the next level.",
      ),
  })
  .describe('Papa movement (GDD §3).');

const BabySchema = z
  .strictObject({
    crawlSpeedMps: z
      .number()
      .positive()
      .max(MAX_CRAWL_SPEED_MPS)
      .describe('Crawling speed while wandering, in metres per second.'),
    bodyRadiusM: z
      .number()
      .min(0)
      .max(MAX_BABY_RADIUS_M)
      .describe(
        "The baby's half width, in metres: its centre stays this far from furniture and walls, and the provisional sphere has this radius. Read once when the level starts: a `SetFeel` takes effect at the next level.",
      ),
    babbleMinMs: delayMs(
      'Shortest sit-and-babble pause between two wanders, in ms; also the first pause when the level starts.',
    ),
    babbleMaxMs: delayMs('Longest sit-and-babble pause between two wanders, in ms.'),
    wanderMinDistM: z
      .number()
      .min(0)
      .describe(
        'A new wander destination is at least this far from where the baby sits, in metres.',
      ),
    wanderMaxDistM: z
      .number()
      .positive()
      .describe(
        'A new wander destination is at most this far from where the baby sits, in metres.',
      ),
    lockMs: delayMs(
      'How long the baby stares at its target, still, before it sets off (`targetLocked`), in ms.',
    ),
    approachSpeedMps: z
      .number()
      .positive()
      .max(MAX_CRAWL_SPEED_MPS)
      .describe(
        'Slowest approach speed towards a threat; the baby goes faster when it must to reach the target by the opening of the window, in metres per second.',
      ),
    actMs: delayMs(
      'How long the baby plays its mischief after a gag (`act`) before it babbles again, in ms.',
    ),
  })
  .refine((baby) => baby.babbleMinMs <= baby.babbleMaxMs, {
    path: ['babbleMinMs'],
    error: 'babbleMinMs must not exceed babbleMaxMs',
  })
  .refine((baby) => baby.wanderMinDistM <= baby.wanderMaxDistM, {
    path: ['wanderMinDistM'],
    error: 'wanderMinDistM must not exceed wanderMaxDistM',
  })
  .describe(
    'The baby exploring the room on its own (FR15, GDD › Micro-boucle: it wanders and babbles until it spots a danger).',
  );

const FatigueSchema = z
  .strictObject({
    perSec: z.number().min(0).describe('Fatigue gained per second, in points per second.'),
    carriedMultiplier: multiplier('Fatigue gain multiplier while carrying the baby.'),
    thresholdPoints: points(
      'Above this fatigue, windows shrink and micro-sleeps start, in points.',
    ),
    windowPenaltyPct: pct('Response windows shrink by this percentage above the threshold.'),
    microSleepMinMs: delayMs('Shortest delay between two micro-sleeps above the threshold, in ms.'),
    microSleepMaxMs: delayMs('Longest delay between two micro-sleeps above the threshold, in ms.'),
    coffeeReductionPoints: points('Fatigue removed by a coffee, in points.'),
    coffeeDurationMs: durationMs('Time Papa spends drinking a coffee, in ms.'),
  })
  .refine((fatigue) => fatigue.microSleepMinMs <= fatigue.microSleepMaxMs, {
    path: ['microSleepMinMs'],
    error: 'microSleepMinMs must not exceed microSleepMaxMs',
  })
  .describe("Papa's fatigue (GDD §6).");

const InstinctSchema = z
  .strictObject({
    timeScale: timeScale('Sim speed while Fatherly Instinct is active (1 = normal).'),
    windowBonusPct: pct('Response windows grow by this percentage while active.'),
    durationMs: durationMs('How long the instinct lasts, in ms.'),
    cooldownMs: delayMs('Recharge time after the instinct ends, in ms.'),
    minActiveThreatsCount: z
      .int()
      .min(1)
      .describe('Trigger: at least this many active threats at once...'),
    missesCount: z.int().min(1).describe('...and this many misses...'),
    missesWithinMs: durationMs('...within this window, in ms.'),
  })
  .describe('Fatherly Instinct (GDD §9).');

const DifficultySchema = z
  .strictObject({
    assistance: difficultyTier('Assistance tier: wider windows, instinct on (GDD, accessibility).'),
    normal: difficultyTier('Normal tier: the game as designed.'),
    experienced: difficultyTier('Experienced-dad tier: tighter windows, no instinct.'),
  })
  .describe('Difficulty tiers (GDD, accessibility and skill range).');

const MamaSchema = z
  .strictObject({
    laughMaxPoints: points('Most points the baby laughs can give, in points.'),
    babyStateMaxPoints: points('Most points the baby state can give, in points.'),
    babyStateFixedPoints: points(
      'Baby-state points used by the prototype instead of the real computation, in points.',
    ),
    baseScorePoints: points('Base points added to every score, in points.'),
    sighMaxPoints: points('Most points a sigh can take off, in points.'),
    screamMaxPoints: points('Most points a scream can take off, in points.'),
    starThresholdPoints: z
      .array(z.number().min(0).max(100))
      .length(5)
      .refine(
        (thresholds) =>
          thresholds.every(
            (value, i) => i === 0 || value > (thresholds[i - 1] ?? Number.NEGATIVE_INFINITY),
          ),
        {
          error: 'starThresholdPoints must be strictly ascending',
        },
      )
      .describe('Score needed for 1, 2, 3, 4 and 5 stars, in points (0 to 100, ascending).'),
    earlyWakePenaltyStars: count('Stars taken off when Mama wakes early, in stars.'),
  })
  .refine((mama) => mama.babyStateFixedPoints <= mama.babyStateMaxPoints, {
    path: ['babyStateFixedPoints'],
    error: 'babyStateFixedPoints must not exceed babyStateMaxPoints',
  })
  .describe("Mama's note (GDD, economy › Mama's note).");

export const FeelSchema = z
  .strictObject({
    timing: TimingSchema,
    input: InputSchema,
    movement: MovementSchema,
    baby: BabySchema,
    fatigue: FatigueSchema,
    instinct: InstinctSchema,
    difficulty: DifficultySchema,
    mama: MamaSchema,
  })
  .describe('Every feel value of the game, tuned by hand or from the feel panel.');

export type Feel = z.infer<typeof FeelSchema>;
