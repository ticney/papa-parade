import {
  EPIC_STAMP_MAX_MS,
  GAUGE_MAX_POINTS,
  MAMA_SCORE_MAX_POINTS,
  MAX_BABY_RADIUS_M,
  MAX_CRAWL_SPEED_MPS,
  MAX_PAPA_RADIUS_M,
  MAX_WALK_SPEED_MPS,
  MIN_TIME_SCALE,
  PARTICLE_MAX_PER_BURST,
  STAR_COUNT_MAX,
} from '@shared/constants';
import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// Every key of content/feel.json lives here. No `.default()`, `.optional()`, `.transform()` or
// `.preprocess()`: the file, the type and the emitted JSON Schema map one to one, and every key is
// written in the file. Tunable values live in the JSON, never here (only validation bounds do).

const durationMs = (description: string) => z.number().positive().describe(description);
const delayMs = (description: string) => z.number().min(0).describe(description);
const pct = (description: string) => z.number().min(0).max(100).describe(description);
const points = (description: string) => z.number().min(0).describe(description);
const multiplier = (description: string) => z.number().min(0).describe(description);

/** Points of Mama's note that are shown and summed as they are: whole, so the four rows add up to the score. */
const wholePoints = (description: string) => z.int().min(0).describe(description);
const timeScale = (description: string) => z.number().gt(0).max(1).describe(description);

const slowMo = (description: string) =>
  z
    .strictObject({
      timeScale: z
        .number()
        .min(MIN_TIME_SCALE)
        .max(1)
        .describe('Sim speed during the slow-mo (1 = normal, 0.3 = 30 % speed, never below 0.05).'),
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
    objectTouchRadiusPx: z
      .number()
      .positive()
      .describe(
        "Touch radius around an interactive object's icon point (coffee machine, phone), in screen px.",
      ),
    autoTargetConeDeg: z
      .number()
      .gt(0)
      .max(360)
      .describe('Auto-target cone for keyboard and gamepad, in degrees (story 1.17).'),
    contextReachM: z
      .number()
      .positive()
      .describe(
        'Space or A acts on the nearest interactive object within this distance of Papa, in metres (story 1.17).',
      ),
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
    silenceAlertMs: z
      .number()
      .int()
      .positive()
      .describe(
        'How long the hidden baby stays quiet in its zone before the silence is announced (`SilenceStarted`), in ms.',
      ),
    sneakSpeedMps: z
      .number()
      .positive()
      .max(MAX_CRAWL_SPEED_MPS)
      .describe(
        'How fast the baby crawls to the hidden zone of a suspicious silence, in metres per second.',
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
    startPoints: z
      .number()
      .min(0)
      .max(GAUGE_MAX_POINTS)
      .describe('Fatigue at the start of a level that has the fatigue gauge, in points (0-100).'),
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
    asleepMs: durationMs('How long Papa sleeps after a missed micro-sleep, in ms.'),
  })
  .refine((fatigue) => fatigue.microSleepMinMs <= fatigue.microSleepMaxMs, {
    path: ['microSleepMinMs'],
    error: 'microSleepMinMs must not exceed microSleepMaxMs',
  })
  .describe("Papa's fatigue (GDD §6).");

const CarrySchema = z
  .strictObject({
    reachM: z
      .number()
      .positive()
      .describe('Papa takes the baby at once when he is within this distance of him, in metres.'),
    putDownOffsetM: z
      .number()
      .min(0)
      .describe('The baby is set down this far in front of Papa, along his heading, in metres.'),
    armsCryMinMs: delayMs(
      'Shortest delay from picking the baby up (or from the last cry in the arms) to the next one, in ms.',
    ),
    armsCryMaxMs: delayMs(
      'Longest delay from picking the baby up (or from the last cry in the arms) to the next one, in ms.',
    ),
  })
  .refine((carry) => carry.armsCryMinMs <= carry.armsCryMaxMs, {
    path: ['armsCryMinMs'],
    error: 'armsCryMinMs must not exceed armsCryMaxMs',
  })
  .describe(
    "Carrying the baby in Papa's arms (FR22, story 4.1). The fatigue multiplier is `fatigue.carriedMultiplier`.",
  );

const ComboSchema = z
  .strictObject({
    minMultiplier: z
      .int()
      .min(1)
      .describe(
        'Multiplier at rest, and after a cash-in or a gag (the badge is hidden at this value).',
      ),
    maxMultiplier: z
      .int()
      .min(1)
      .describe('Highest multiplier; past it the multiplier stays and the base points still grow.'),
    carryTickMs: durationMs(
      'One more multiplier step per this much time carried without incident, in **sim** ms.',
    ),
    basePerResponsePoints: z
      .number()
      .positive()
      .describe('Base points added to the combo by each successful or perfect response.'),
    basePerCarryTickPoints: z
      .number()
      .positive()
      .describe('Base points added to the combo by each carry tick.'),
    slowMoCashIn: slowMo('Slow-mo played when the combo is cashed in at a safe drop.'),
  })
  .refine((combo) => combo.minMultiplier < combo.maxMultiplier, {
    path: ['minMultiplier'],
    error: 'minMultiplier must be below maxMultiplier',
  })
  .describe(
    'The combo (FR23, story 4.2): a multiplier raised by responses and by carrying, cashed in at a safe drop.',
  );

const noisePctSource = (description: string) =>
  z
    .strictObject({ noisePct: pct('Noise added once per occurrence, in % of the gauge.') })
    .describe(description);

const NoiseSourcesSchema = z
  .strictObject({
    propImpact: z
      .strictObject({
        minPct: pct('Noise of a falling object at `minImpulseNs`, in % of the gauge.'),
        maxPct: pct('Noise of a falling object at `maxImpulseNs` and above, in % of the gauge.'),
        minImpulseNs: z
          .number()
          .min(0)
          .describe('Impact impulse that makes `minPct`, in newton-seconds.'),
        maxImpulseNs: z
          .number()
          .min(0)
          .describe('Impact impulse that makes `maxPct`, in newton-seconds.'),
        samePropCooldownMs: delayMs(
          'A prop that already made noise is silent for this long (a bounce is one fall), in sim ms; 0 = no window.',
        ),
      })
      .refine((source) => source.minPct <= source.maxPct, {
        path: ['minPct'],
        error: 'minPct must not exceed maxPct',
      })
      .refine((source) => source.minImpulseNs < source.maxImpulseNs, {
        path: ['minImpulseNs'],
        error: 'minImpulseNs must be below maxImpulseNs',
      })
      .describe(
        'A prop hitting something (`PropImpact`): +minPct…maxPct by impulse (GDD: +5 to +15 %).',
      ),
    phoneRinging: z
      .strictObject({
        perSec: points('Noise per second of ringing, in % of the gauge per second.'),
      })
      .describe('A ringing phone (`PhoneRinging`, one per second): GDD +2 %/s.'),
    babyCrying: z
      .strictObject({ perSec: points('Noise per second of crying, in % of the gauge per second.') })
      .describe('The baby crying (`BabyCrying`, one per second): GDD +2 %/s.'),
    floorCreak: noisePctSource('A creaking floorboard (story 4.9): GDD +3 %.'),
    breathReleased: noisePctSource('Breath released too early (story 4.9): GDD +5 %.'),
    sniff: noisePctSource('Sniffing (story 5.3): GDD +3 %.'),
  })
  .describe('What makes noise: one row per source of `NoiseChanged`.');

/** The keys of `feel.noise.sources`, in file order: the sim\'s `NoiseSource` (plus `debug`) and the sim report use them. */
export const NOISE_SOURCE_IDS = [
  'propImpact',
  'phoneRinging',
  'babyCrying',
  'floorCreak',
  'breathReleased',
  'sniff',
] as const;

const NoiseSchema = z
  .strictObject({
    decayPerSec: points('Noise lost per second, in % of the gauge per second (GDD: 1 %/s).'),
    alertPct: pct(
      'Above this noise the client plays the alert (haptic + shake), in % of the gauge.',
    ),
    sources: NoiseSourcesSchema,
  })
  .describe('The noise gauge of the Sieste levels (FR18, GDD rule 7).');

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
    laughMaxPoints: wholePoints('Most points the baby laughs can give, in points.'),
    babyStateMaxPoints: wholePoints('Most points the baby state can give, in points.'),
    babyStateFixedPoints: wholePoints(
      'Baby-state points used by the prototype instead of the real computation, in points.',
    ),
    baseScorePoints: wholePoints('Base points added to every score, in points.'),
    sighMaxPoints: wholePoints('Most points a sigh can take off, in points.'),
    screamMaxPoints: wholePoints('Most points a scream can take off, in points.'),
    starThresholdPoints: z
      .array(z.number().min(0).max(100))
      .length(STAR_COUNT_MAX)
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
    earlyWakePenaltyStars: z
      .int()
      .min(0)
      .max(STAR_COUNT_MAX)
      .describe(
        "Stars taken off Mama's note when the noise wakes her early (Sieste), 0 to 5, in stars.",
      ),
    laughPerPerfectPoints: points(
      'Laugh points each perfect response gives (held to `laughMaxPoints`), in points per perfect.',
    ),
    sighPerPropOnFloorPoints: points(
      'Sigh points each unbroken prop lying on the floor at the end takes off, in points per prop.',
    ),
    sighPerBrokenPropPoints: points('Sigh points each broken prop takes off, in points per prop.'),
    sighPerMischiefPoints: points(
      'Sigh points each surprise mischief the baby got away with takes off, in points per mischief.',
    ),
    screamPerNearMissPoints: points(
      'Scream points each near miss takes off (held to `screamMaxPoints`), in points per near miss.',
    ),
  })
  .refine((mama) => mama.babyStateFixedPoints <= mama.babyStateMaxPoints, {
    path: ['babyStateFixedPoints'],
    error: 'babyStateFixedPoints must not exceed babyStateMaxPoints',
  })
  .refine(
    (mama) =>
      mama.laughMaxPoints + mama.babyStateMaxPoints + mama.sighMaxPoints + mama.screamMaxPoints ===
      MAMA_SCORE_MAX_POINTS,
    {
      path: ['laughMaxPoints'],
      error:
        'laughMaxPoints + babyStateMaxPoints + sighMaxPoints + screamMaxPoints must be 100: the note is out of 100',
    },
  )
  .refine((mama) => mama.baseScorePoints === mama.sighMaxPoints + mama.screamMaxPoints, {
    path: ['baseScorePoints'],
    error:
      'baseScorePoints must equal sighMaxPoints + screamMaxPoints, so that the four rows add up to the score',
  })
  .describe("Mama's note (GDD, economy › Mama's note).");

/** The shapes a prop's collider can have, as data (the sim builds a cuboid, a cylinder or a ball from the geometry's half extents). */
export const PROP_SHAPES = ['box', 'cylinder', 'ball'] as const;

export type PropShape = (typeof PROP_SHAPES)[number];

const positive = (description: string) => z.number().positive().describe(description);

const PropKindSchema = z
  .strictObject({
    shape: z
      .enum(PROP_SHAPES)
      .describe(
        "Collider shape, sized from the prop's half extents: `box` is a cuboid, `cylinder` stands on its axis (radius = the larger of x and z, half height = y), `ball` has the smallest half extent as radius.",
      ),
    massKg: positive('Mass of one prop of this kind, in kilograms.'),
    friction: z
      .number()
      .min(0)
      .describe('Friction coefficient of the prop (0 = ice, 1 = rubber); a dimensionless ratio.'),
    restitution: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Bounciness (0 = stays where it lands, 1 = rebounds with all its speed); a dimensionless ratio.',
      ),
    breakable: z
      .boolean()
      .describe('Whether an impact of `breakImpulseNs` or more breaks the prop.'),
    breakImpulseNs: positive(
      'Contact impulse that breaks a breakable prop, in newton-seconds. Required even when `breakable` is false, where it is not read.',
    ),
  })
  .describe('The physics of one kind of prop (`PROP_<kind>_<nn>` in the level).');

const PhysicsSchema = z
  .strictObject({
    gravityMps2: positive('Gravity pulling the props down, in metres per second squared.'),
    impactMinImpulseNs: positive(
      'A contact impulse under this is a prop settling, not an impact: nothing is emitted, in newton-seconds.',
    ),
    impactCooldownMs: delayMs(
      'After a `PropImpact`, the same prop emits no other for this long, in sim ms.',
    ),
    maxPushImpulseNs: positive(
      'Largest impulse one push (a gag, the debug `PushProp`) gives a prop, in newton-seconds: a larger one is clamped to it. `content:check` holds it low enough that no kind crosses a wall of the room in one step.',
    ),
    kinds: z
      .record(z.string().regex(SNAKE_ID_PATTERN, 'a kind is lower_snake_case'), PropKindSchema)
      .describe('Physics of each kind of prop, by kind (`mug` for `PROP_mug_01`).'),
  })
  .describe(
    'Light physics of the props (GDD §11, story 1.15): falls, bounces, impacts and breakage.',
  );

const GagsSchema = z
  .strictObject({
    tableObjectFall: z
      .strictObject({
        pushImpulseNs: positive(
          'Impulse the coffee-table gag gives the object on the table, in newton-seconds, horizontally away from the anchor (held to `physics.maxPushImpulseNs`).',
        ),
        propReachDistM: positive(
          'How far from the threat anchor, in metres (horizontal), an object that is off the floor still counts as « on the table ».',
        ),
      })
      .describe('The gag of the object on the coffee table (story 1.16).'),
  })
  .describe(
    'Tunables of the gags whose consequence the sim applies (`sim/threats/gags.ts`); a gag with nothing to tune has no key.',
  );

/** The juice presets a feedback cue may name (`CueSchema.fx`); each has a block in `feel.fx`. */
export const FX_PRESET_IDS = ['success', 'perfect', 'gag'] as const;
export type FxPresetId = (typeof FX_PRESET_IDS)[number];

const FxShakeSchema = z
  .strictObject({
    amplitudeM: z
      .number()
      .min(0)
      .max(0.1)
      .describe('Largest offset of the shake, in metres (0 = no shake).'),
    durationMs: z
      .number()
      .min(0)
      .max(400)
      .describe('How long the shake lasts, in **real** ms (it plays during the hitstop).'),
  })
  .describe('The screen shake of the preset.');

const FxParticlesSchema = z
  .strictObject({
    style: z
      .enum(['spark', 'puff'])
      .describe(
        '`spark`: fast, with gravity, shrinks; `puff`: slow, no gravity, grows then fades.',
      ),
    count: z
      .int()
      .min(0)
      .max(PARTICLE_MAX_PER_BURST)
      .describe('Particles in one burst (0 = none); a perf limit bounds it.'),
    speedMps: z
      .number()
      .min(0)
      .max(6)
      .describe('Initial speed of a particle, in metres per second.'),
    lifeMs: z.int().min(50).max(1000).describe('Life of a particle, in **real** ms.'),
    sizeM: z.number().min(0.01).max(0.3).describe('Edge of a particle at its largest, in metres.'),
  })
  .describe('The particle burst of the preset, from the cue ring anchor.');

const fxPreset = (description: string) =>
  z.strictObject({ shake: FxShakeSchema, particles: FxParticlesSchema }).describe(description);

const FxSchema = z
  .strictObject({
    shakeFrequencyHz: z
      .number()
      .min(4)
      .max(30)
      .describe('Wobble frequency of every shake, in hertz (whatever its duration).'),
    success: fxPreset('Juice of a successful response (story 2.5).'),
    perfect: z
      .strictObject({
        shake: FxShakeSchema,
        particles: FxParticlesSchema,
        stampMs: z
          .int()
          .min(0)
          .max(EPIC_STAMP_MAX_MS)
          .describe('How long the « PARADE PARFAITE » stamp shows, in **real** ms (0 = no stamp).'),
      })
      .describe('Juice of a perfect response: shake, sparks and the stamp.'),
    gag: fxPreset('Juice of a gag: the « pouf ».'),
    perfectCamera: z
      .strictObject({
        zoomPct: z.number().min(0).max(40).describe('Extra zoom at the peak of the slow-mo, in %.'),
        yawDeg: z
          .number()
          .min(0)
          .max(12)
          .describe('Camera rotation around the vertical at the peak, in degrees.'),
        focusPct: z
          .number()
          .min(0)
          .max(60)
          .describe('How far the view centre moves toward the action at the peak, in %.'),
        zoomInMs: z
          .int()
          .min(0)
          .max(500)
          .describe('Time to reach the peak after the slow-mo starts, in **sim** ms.'),
        refocusMs: z
          .int()
          .min(0)
          .max(500)
          .describe(
            'Time the view takes to glide to the point of a new perfect while a move is under way, in **sim** ms (0 = a cut).',
          ),
      })
      .describe('The camera move of a perfect response, driven by its slow-mo.'),
  })
  .describe(
    'On-screen juice (story 2.5): shake, particles, stamp and the perfect camera. Client only.',
  );

const MusicSchema = z
  .strictObject({
    tense: z
      .strictObject({
        fadeInMs: z
          .int()
          .min(0)
          .max(5000)
          .describe(
            'How long the tense stem takes to come up when a threat is on, in **real** ms.',
          ),
        fadeOutMs: z
          .int()
          .min(0)
          .max(5000)
          .describe(
            'How long the tense stem takes to go away when no threat is on, in **real** ms.',
          ),
        calmGainPct: z
          .number()
          .min(0)
          .max(100)
          .describe(
            'Level the calm stem ducks to while the tense one plays, in % (100 = no ducking).',
          ),
      })
      .describe('The nervous stem that comes up with the threats.'),
    slowMo: z
      .strictObject({
        belowScale: z
          .number()
          .min(0.1)
          .max(1)
          .describe('The effect is on while the effective `world.time.scale` is below this.'),
        lowpassHz: z
          .number()
          .min(200)
          .max(20000)
          .describe('Cut-off of the low-pass on the music while the effect is on, in hertz.'),
        playbackRatePct: z
          .number()
          .min(25)
          .max(100)
          .describe('Speed of both stems while the effect is on, in % (pitch drops with it).'),
        inMs: z
          .int()
          .min(0)
          .max(2000)
          .describe('Time to sweep the music into the effect, in **real** ms.'),
        outMs: z
          .int()
          .min(0)
          .max(2000)
          .describe('Time to sweep the music back out of the effect, in **real** ms.'),
      })
      .describe('The music slows down with the game: a low-pass and a lower playback rate.'),
  })
  .describe('Adaptive music mix (story 2.6): the tense stem and the slow-mo effect. Client only.');

const CalibrationSchema = z
  .strictObject({
    beatCount: z.int().min(3).max(16).describe('Beats in each phase (audio, then visual).'),
    bpm: z
      .number()
      .min(40)
      .max(180)
      .describe(
        'Tempo of the beats, in beats per minute. At most 180 (3 Hz): a flash never goes faster than the flashing limit.',
      ),
    outlierMs: z
      .number()
      .min(0)
      .max(1000)
      .describe(
        'A tap further than this from the median gap is thrown away before the final median, in ms.',
      ),
    offsetMinMs: z
      .number()
      .min(-1000)
      .max(0)
      .describe('Lowest offset the calibration keeps, in ms (negative = the screen is early).'),
    offsetMaxMs: z
      .number()
      .min(0)
      .max(1000)
      .describe('Highest offset the calibration keeps, in ms (positive = the screen is late).'),
    minValidTaps: z
      .int()
      .min(1)
      .max(16)
      .describe('Fewer valid taps than this and the phase starts over.'),
    leadInMs: z.int().min(0).max(5000).describe('Wait before the first beat of a phase, in ms.'),
    tailMs: z
      .int()
      .min(0)
      .max(5000)
      .describe('A phase keeps listening this long after its last beat, in ms.'),
    audioWaitMs: z
      .int()
      .min(0)
      .max(10000)
      .describe(
        'How long the audio phase waits for the audio to be running before it is skipped, in ms.',
      ),
    doneHoldMs: z.int().min(0).max(5000).describe('How long the « done » message stays up, in ms.'),
    pulseMs: z
      .int()
      .min(1)
      .max(1000)
      .describe('How long the ring or the disc stays on at each beat, in real ms.'),
  })
  .refine((calibration) => calibration.minValidTaps <= calibration.beatCount, {
    error: 'minValidTaps cannot exceed beatCount: no phase could succeed',
    path: ['minValidTaps'],
  })
  .refine((calibration) => calibration.offsetMinMs < calibration.offsetMaxMs, {
    error: 'offsetMinMs must be below offsetMaxMs',
    path: ['offsetMinMs'],
  })
  .refine((calibration) => calibration.offsetMaxMs < 30_000 / calibration.bpm, {
    // From half a beat interval a late tap is nearer the next beat: it pairs with it.
    error: 'offsetMaxMs must be below half a beat interval (30000 / bpm)',
    path: ['offsetMaxMs'],
  })
  .describe(
    'Latency calibration (story 2.7): the beats, the maths bounds and the timings. Client only.',
  );

export const FeelSchema = z
  .strictObject({
    timing: TimingSchema,
    input: InputSchema,
    movement: MovementSchema,
    baby: BabySchema,
    fatigue: FatigueSchema,
    carry: CarrySchema,
    combo: ComboSchema,
    noise: NoiseSchema,
    instinct: InstinctSchema,
    difficulty: DifficultySchema,
    mama: MamaSchema,
    physics: PhysicsSchema,
    gags: GagsSchema,
    fx: FxSchema,
    music: MusicSchema,
    calibration: CalibrationSchema,
  })
  .describe('Every feel value of the game, tuned by hand or from the feel panel.');

export type Feel = z.infer<typeof FeelSchema>;
