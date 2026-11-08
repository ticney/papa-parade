import {
  PHOTO_ASPECT_MAX,
  PHOTO_ASPECT_MIN,
  SCREEN_FLASH_MIN_INTERVAL_MS,
  STEP_MS,
} from '@shared/constants';
import { z } from 'zod';
import { FX_PRESET_IDS } from './feel.ts';

// Every key of content/feedback.json lives here (ADR-006, architecture › Retours multimodaux): the
// one table that says which event plays which sound, ring, vibration and camera effect. Gains are
// percentages (linear: `gainPct / 100`); a cue's gain multiplies its bus's. Optional members are
// the point of a cue (a countdown tick is a haptic alone); `.default()` and `.transform()` stay out
// so that the file, the type and the emitted JSON Schema map one to one.

export const AUDIO_BUSES = ['music', 'sfx', 'voice', 'ui'] as const;
export const HAPTIC_KINDS = ['light', 'medium', 'heavy', 'heartbeat'] as const;

/** `<category>_<name>`, the categories of the architecture (Conventions › Audio). */
const CLIP_PATTERN = /^(tel|resp|gag|baby|papa|env|ui|music|mama)_[a-z0-9]+(_[a-z0-9]+)*$/;
/** `lower_snake_case`, like every content id. */
export const CUE_ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

const gainPct = (description: string) => z.number().min(0).max(100).describe(description);

const clip = z
  .string()
  .regex(
    CLIP_PATTERN,
    'a clip is <category>_<name> in lower_snake_case, the category one of tel, resp, gag, baby, papa, env, ui, music, mama',
  )
  .describe('File name without extension: `public/assets/audio/<clip>.m4a`.');

const bus = z.enum(AUDIO_BUSES).describe('Bus the sound goes through.');

const BusSchema = z
  .strictObject({ gainPct: gainPct('Bus volume, in percent (100 = full).') })
  .describe('One audio bus.');

const BusesSchema = z
  .strictObject({
    music: BusSchema.describe('The music bus.'),
    sfx: BusSchema.describe('The sound-effects bus: responses, bumps, gags.'),
    voice: BusSchema.describe('The voice bus: the baby, Mama.'),
    ui: BusSchema.describe('The interface bus.'),
  })
  .describe('Volume of each bus: the mix. The player volumes of story 2.8 multiply it.');

const HapticSchema = z
  .strictObject({
    patternMs: z
      .array(z.int().min(1).max(1000))
      .min(1)
      .max(8)
      .describe('`navigator.vibrate` pattern, in ms: vibrate, pause, vibrate, pause...'),
  })
  .describe('One vibration.');

const HapticsSchema = z
  .strictObject({
    light: HapticSchema.describe('A light tap: a tick, a bump.'),
    medium: HapticSchema.describe('A medium tap: a response.'),
    heavy: HapticSchema.describe('A heavy tap: a gag.'),
    heartbeat: HapticSchema.describe('A lub-dub: Fatherly Instinct kicks in (story 2.9).'),
  })
  .describe('The vibration of each kind. A browser without vibration ignores them.');

const LoopSchema = z
  .strictObject({
    clip,
    bus,
    gainPct: gainPct('Loop volume on its bus, in percent.'),
    fadeMs: z
      .number()
      .min(0)
      .describe('Fade in when the loop starts and fade out when it stops, in ms.'),
  })
  .describe('A sound that loops while a state lasts.');

const MusicLoopSchema = z
  .strictObject({
    stems: z
      .strictObject({
        calm: clip.describe('The calm stem: the music at rest.'),
        tense: clip.describe('The tense stem: it comes up while a threat is on (story 2.6).'),
      })
      .refine((stems) => stems.calm !== stems.tense, {
        message: 'the calm and tense stems must be two different clips',
      })
      .describe('Two synchronized stems of the same length, started together and looped.'),
    bus,
    gainPct: gainPct('Music volume on its bus, in percent.'),
    fadeMs: z
      .number()
      .min(0)
      .describe('Fade in when the music starts and fade out when it stops or is cut, in ms.'),
  })
  .describe('The level music: two synchronized stems mixed by the game state.');

const LoopsSchema = z
  .strictObject({
    babble: LoopSchema.describe(
      'The baby babbles while `baby.babbling` (its stop is the silence).',
    ),
    music: MusicLoopSchema,
    sequenceMusic: z
      .record(z.string().regex(CUE_ID_PATTERN, 'a loop id is lower_snake_case'), LoopSchema)
      .describe(
        'The music of each special sequence (story 4.4), by id, named by a sequence def `framing.musicLoop`: while one plays, the level stems are stopped.',
      ),
  })
  .describe('Sounds driven by a state, not by an event: they are not cues.');

const AudioCueSchema = z
  .strictObject({
    clip,
    bus,
    gainPct: gainPct('Cue volume on its bus, in percent.'),
  })
  .describe('The sound of a cue, played once.');

const SoundWaveSchema = z
  .strictObject({
    kind: z.literal('soundWave').describe('A ring on the floor that grows and fades.'),
    anchor: z
      .enum(['papa', 'baby', 'threat', 'object', 'door'])
      .describe(
        "Whose position the ring starts from. `threat` is the threat the event names; only for cues a threat def points at. `object` is the object the event names (`objectId`); only for cues a disruption or a house chore def points at. `door` is the level's `ANCHOR_door` (story 3.5), for a generic event.",
      ),
    maxRadiusM: z.number().gt(0).max(3).describe('Radius of the ring when it is gone, in metres.'),
    durationMs: z
      .number()
      .positive()
      .describe('How long the ring takes to grow and fade, in sim ms.'),
    pulses: z
      .int()
      .min(2)
      .max(3)
      .optional()
      .describe('Rings sent one after the other (2 or 3); absent means one ring.'),
    pulseIntervalMs: z
      .number()
      .positive()
      .optional()
      .describe(
        'Delay between the start of two pulses, in sim ms. Needs `pulses`, and the reverse.',
      ),
  })
  .refine((wave) => (wave.pulses === undefined) === (wave.pulseIntervalMs === undefined), {
    error: 'pulses and pulseIntervalMs go together: give both or neither',
    path: ['pulses'],
  })
  .describe('The visual twin of a sound.');

const UiElementSchema = z
  .strictObject({
    kind: z
      .literal('uiElement')
      .describe(
        'The UI element that fired the event is the visual twin (a stamped star): the director draws nothing. Only for a client event.',
      ),
  })
  .describe('The visual twin of a sound that a screen element already shows.');

const FlashSchema = z
  .strictObject({
    peakOpacityPct: z
      .int()
      .min(1)
      .max(60)
      .describe('Opacity of the flash at its start, in percent.'),
    durationMs: z
      .int()
      .positive()
      .max(SCREEN_FLASH_MIN_INTERVAL_MS)
      .describe(
        'How long the flash takes to fade out, in real ms. At most the 3 Hz interval, so a flash never restarts on itself.',
      ),
  })
  .describe(
    'A full-screen paper-white flash that fades, in real ms; under reduced motion a border glow instead; never more often than 3 Hz.',
  );

const CueSchema = z
  .strictObject({
    audio: AudioCueSchema.optional(),
    layers: z
      .array(AudioCueSchema)
      .min(1)
      .max(3)
      .optional()
      .describe(
        'Extra sounds played at the same moment as `audio`, in order (the baby laughs on a perfect). A cue with layers needs an `audio`; a layer has no ring, vibration or cue of its own.',
      ),
    visual: z
      .discriminatedUnion('kind', [SoundWaveSchema, UiElementSchema])
      .optional()
      .describe(
        'The visual twin of the sound: a diegetic effect in the 3D world, or the UI element that fired the event.',
      ),
    haptic: z
      .enum(HAPTIC_KINDS)
      .optional()
      .describe('Vibration played with the cue, one of `haptics`.'),
    flash: FlashSchema.optional().describe(
      'A screen flash, the mark of a perfect response. It also counts as a visual twin of the sound.',
    ),
    fx: z
      .enum(FX_PRESET_IDS)
      .optional()
      .describe(
        'Plays the `feel.fx.<preset>` juice: shake, particles and, for `perfect`, the stamp; at the cue ring anchor.',
      ),
  })
  .refine(
    (cue) =>
      cue.audio !== undefined ||
      cue.visual !== undefined ||
      cue.haptic !== undefined ||
      cue.flash !== undefined ||
      cue.fx !== undefined,
    { error: 'a cue needs at least one of audio, visual, haptic, flash, fx' },
  )
  .refine((cue) => cue.layers === undefined || cue.audio !== undefined, {
    error: 'a cue with layers needs an audio: the layers play right after it',
    path: ['layers'],
  })
  .describe(
    'What the player hears, sees and feels for one signal. Every audio has a visual and a haptic.',
  );

const realMs = (description: string) => z.int().positive().describe(description);

const ResultScreenSchema = z
  .strictObject({
    rowCountUpMs: realMs('How long one score row counts up from 0 to its total, in real ms.'),
    rowStaggerMs: z
      .int()
      .min(0)
      .describe('Delay between the start of one score row and the next, in real ms.'),
    starsDelayMs: realMs('Pause between the last row landing and the first star, in real ms.'),
    starIntervalMs: realMs('Delay between two stamped stars, in real ms.'),
    actionsDelayMs: realMs(
      'Pause between the last star (or the last row, with no star) and the buttons, in real ms.',
    ),
    inputGraceMs: z
      .int()
      .min(0)
      .describe(
        'After the screen comes up, and again after the buttons come up, presses that start within this many real ms skip nothing and press nothing, so that taps still mashing for the last parry do not skip the note or hit « Rejouer »; 0 turns it off.',
      ),
    photoHoldMs: z
      .int()
      .min(0)
      .describe(
        'How long the end photo stays alone on screen, after it drops in and before the rows start, in real ms (story 3.6); 0 goes straight to the rows. A level that took no photo skips it. A press skips it.',
      ),
    reactionHoldMs: z
      .int()
      .min(0)
      .describe(
        "How long each of Mama's reactions (her laugh, sigh or scream, with her line) stays on screen after the photo and before the rows start, in real ms (story 3.7); 0 goes straight on. A press skips them all.",
      ),
  })
  .describe(
    'The sequence of the Result screen (story 1.22): the photo (story 3.6), the reactions of Mama (story 3.7), then rows, then stars, then buttons. Real time: the sim never reads it.',
  );

const PhotoSchema = z
  .strictObject({
    widthPx: z
      .int()
      .min(120)
      .max(1280)
      .describe(
        'Width of the end photo canvas, in pixels (story 3.6). Its CSS size is the polaroid’s.',
      ),
    heightPx: z
      .int()
      .min(80)
      .max(1024)
      .describe(
        'Height of the end photo canvas, in pixels. The camera frames the room at this aspect.',
      ),
    tiltMaxDeg: z
      .number()
      .min(0)
      .max(3)
      .describe(
        'The polaroid is tilted by a random angle within plus or minus this, in degrees (DESIGN.md: 3).',
      ),
    vignetteFromPct: z
      .number()
      .min(0)
      .max(99)
      .describe(
        'The photo filter’s vignette is clear out to this share of its radius (`vignetteRadiusPct`), then darkens to the end of it.',
      ),
    vignetteOpacityPct: z
      .number()
      .min(0)
      .max(100)
      .describe(
        'How dark the vignette is at the end of its radius (ink), in %. With the mockup’s `vignetteRadiusPct` of 70 only the corners get that far: the middle of each side is at 71 % of the radius.',
      ),
    vignetteRadiusPct: z
      .number()
      .min(10)
      .max(200)
      .describe(
        'The radius of the vignette, in % of the photo’s width across and of its height down, so it is an ellipse that follows the photo’s aspect (the mockup’s `#vig` gradient has 70). The middle of each side is `50 / vignetteRadiusPct` of the way out to the end of the radius and each corner `71 / vignetteRadiusPct`: with 70 only the corners reach the end, and a `vignetteFromPct` of 72 or more leaves the sides clear.',
      ),
  })
  .refine(
    (photo) => {
      const aspect = photo.widthPx / photo.heightPx;
      return aspect >= PHOTO_ASPECT_MIN && aspect <= PHOTO_ASPECT_MAX;
    },
    {
      error: `the photo's aspect (widthPx / heightPx) must be ${PHOTO_ASPECT_MIN} to ${PHOTO_ASPECT_MAX}: the polaroid is as wide as its card, so a taller photo does not fit a 750 × 340 phone`,
      // Checked once each size is valid on its own, so a bad size reports itself alone.
      when: (payload) => payload.issues.length === 0,
    },
  )
  .describe(
    'The end photo (story 3.6): its canvas, its tilt and its filter. Real time and client only: the sim never reads it.',
  );

const ReplayPointsSchema = z
  .strictObject({
    perfect: z.int().min(0).describe('Points of a perfect response (`ResponseResolved`).'),
    messyGag: z
      .int()
      .min(0)
      .describe('Points of a gag that made a mess (`messyGagMinProps` props hit or broken).'),
    nearMiss: z.int().min(0).describe('Points of a near miss (`NearMiss`).'),
    waveLast: z
      .int()
      .min(0)
      .describe('Points of the last response of a wave, whatever its quality.'),
  })
  .describe('What each kind of moment is worth (story 3.9, P7).');

/** The most a moment's pre-roll or post-roll may be, in sim ms: a typo (an extra zero) must not make a 20 s moment. */
const REPLAY_PAD_MAX_MS = 10_000;
/** The most a pause of the replay may be, in real ms: the player waits through it. */
const REPLAY_PAUSE_MAX_MS = 5000;

const ReplaySchema = z
  .strictObject({
    preRollMs: z
      .int()
      .min(STEP_MS)
      .max(REPLAY_PAD_MAX_MS)
      .describe(
        'Sim ms played before the moment itself, so the build-up is seen (story 3.9). At least one step: the moment’s event is emitted by the step that ends at its `t`, so with less the replay would start after it.',
      ),
    postRollMs: z
      .int()
      .min(0)
      .max(REPLAY_PAD_MAX_MS)
      .describe('Sim ms played after the moment, so its consequence is seen.'),
    minSpacingMs: z
      .int()
      .min(0)
      .describe('Sim ms between two retained moments: a closer one is dropped.'),
    momentCount: z.int().min(1).max(5).describe('Most moments one replay shows.'),
    points: ReplayPointsSchema,
    messyGagMinProps: z
      .int()
      .min(1)
      .describe('Distinct props a gag must hit or break to count as a mess (P7: « bazar »).'),
    messWindowMs: z
      .int()
      .positive()
      .describe('Sim ms after a gag in which a prop hit or broken counts for its mess.'),
    camera: z
      .strictObject({
        frameWidthM: z
          .number()
          .positive()
          .finite()
          .describe('Width of the replay camera frame, in metres on the floor.'),
        frameDepthM: z
          .number()
          .positive()
          .finite()
          .describe('Depth of the replay camera frame, in metres on the floor.'),
      })
      .describe(
        'The replay camera: the game camera’s angle, a tighter frame centred on the moment (story 3.9).',
      ),
    delayMs: z
      .int()
      .min(0)
      .max(REPLAY_PAUSE_MAX_MS)
      .describe('Real ms between the last star and the first replayed moment.'),
    endHoldMs: z
      .int()
      .min(0)
      .max(REPLAY_PAUSE_MAX_MS)
      .describe('Real ms the last frame of a moment stays up, before the next one or the buttons.'),
  })
  .refine((replay) => Object.values(replay.points).some((points) => points > 0), {
    error:
      'at least one kind of moment must be worth points, or a game that is not lost never has a moment to replay',
    // Checked once each key is valid on its own, so a bad key reports itself alone.
    when: (payload) => payload.issues.length === 0,
  })
  .describe(
    'The highlight replay (story 3.9): which moments of the game are replayed, how, and with what pauses. Client only: the sim never reads it and `feel.json` is not touched, so no golden moves.',
  );

const CalibrationFeedbackSchema = z
  .strictObject({
    beep: AudioCueSchema.describe(
      'The beep of the audio phase. Not a cue: the ring and the flash are the visual measure, and calibration has no vibration (EXPERIENCE.md).',
    ),
  })
  .describe('The sounds of the latency calibration (story 2.7).');

const ComboBadgeSchema = z
  .strictObject({
    cashInHoldMs: realMs(
      'How long the combo badge shows the points of a cash-in (« +N »), in real ms, even though the multiplier is already back to its minimum.',
    ),
  })
  .describe('The combo badge above Papa (story 4.2). Real time: the sim never reads it.');

const PapaHintSchema = z
  .strictObject({
    holdMs: realMs(
      "How long the hint above Papa (« POSE-LE D'ABORD ! » after a refused toilet) stays up, in real ms. A second refusal restarts it.",
    ),
  })
  .describe('The hint above Papa (story 4.3). Real time: the sim never reads it.');

const DoorSchema = z
  .strictObject({
    openMs: z
      .number()
      .positive()
      .describe(
        'How long the door takes to swing open once the final rush starts, in sim ms (story 3.5). Read on the render sim clock, so a pause or a slow-mo holds it.',
      ),
    openAngleDeg: z
      .number()
      .gt(0)
      .max(170)
      .describe(
        'How far the door panel swings open, in degrees (the panel is centred on the door anchor and hinged at one end).',
      ),
    widthM: z.number().positive().describe("The door panel's width, in metres."),
    heightM: z.number().positive().describe("The door panel's height, in metres."),
    thicknessM: z.number().positive().describe("The door panel's thickness, in metres."),
  })
  .describe(
    "The door on screen (story 3.5): a closed panel at the level's `ANCHOR_door` that swings open from the start of the final rush. Read per frame on the sim clock; the sim never reads it.",
  );

const BombDropSchema = z
  .strictObject({
    laidHeightM: z
      .number()
      .min(0)
      .describe(
        "The height of the baby's centre above the floor once laid on the mattress, in metres. While a Firmness judged on its release runs, the carried baby is lowered linearly from Papa's chest to this height, from the telegraph to the final pose (story 4.8).",
      ),
  })
  .describe(
    'The bomb drop on screen (story 4.8). Read per frame on the sim clock; the sim never reads it.',
  );

const SequenceBarFeedbackSchema = z
  .strictObject({
    slideMs: realMs(
      'How long the sequence bar stays mounted after the end, to slide out, in real ms. Real time: not read from `transitionend`, which never fires under reduced motion.',
    ),
  })
  .describe('The sequence bar under the timer (story 4.4). Real time: the sim never reads it.');

const BeatTrackSchema = z
  .strictObject({
    notes: z
      .array(clip)
      .min(1)
      .describe(
        'The notes, one per judged beat: the note of judged beat `n` is `notes[n % notes.length]`.',
      ),
    countIn: clip.describe('The tick of the count-in beats.'),
    decoy: clip.describe('The sound of a decoy, between two beats.'),
    bus,
    gainPct: gainPct('Volume of the track on its bus, in percent.'),
  })
  .describe('The sounds of one rhythm track.');

const BeatSchedulerSchema = z
  .strictObject({
    scheduleAheadMs: realMs(
      'How far ahead of the audio clock a note is planned, in real ms. A note late by more than this is dropped.',
    ),
    replanToleranceMs: realMs(
      'A planned note whose time moved by more than this, in real ms, is cancelled and planned again (slow-mo, hitstop, a debug time scale).',
    ),
  })
  .describe('How the client plans the notes on the audio clock (story 4.5). Real time.');

const BeatRingSchema = z
  .strictObject({
    approachMs: z
      .int()
      .positive()
      .describe('How long before a beat its ring starts closing on Papa, in sim ms.'),
  })
  .describe('The ring that closes on Papa at each beat (story 4.5). Sim time: a pause holds it.');

/** The sim events a character squashes on, and who (story 7.2, D7). */
export const SQUASH_EVENTS = [
  'PapaArrived',
  'PapaBlocked',
  'BabyPickedUp',
  'BabyPutDown',
  'GagTriggered',
  'BabyWoke',
  'BabyStirred',
  'CoffeeDrunk',
] as const;
export const SQUASH_CHARACTERS = ['papa', 'baby'] as const;

const SquashRowSchema = z
  .strictObject({
    event: z.enum(SQUASH_EVENTS).describe('The sim event that starts it.'),
    character: z.enum(SQUASH_CHARACTERS).describe('Who squashes.'),
    amountPct: z
      .number()
      .min(-60)
      .max(60)
      .refine((value) => value !== 0, 'an amount of 0 is no squash: remove the row')
      .describe(
        'How much his height changes at the peak of the curve, in percent: below 0 he squashes first and then stretches, above 0 the other way round. His width follows so that his volume holds. The bounds keep his height strictly positive.',
      ),
    durationMs: z.int().positive().describe('How long it lasts, in sim ms.'),
  })
  .describe('One squash and stretch: one event on one character.');

const ClipSpeedSchema = z
  .strictObject({
    clip: z
      .string()
      .regex(CUE_ID_PATTERN, 'a clip name is lower_snake_case')
      .describe('The looping clip of a walk or a crawl, as named in the `.glb`.'),
    speedMps: z
      .number()
      .positive()
      .describe(
        'The floor speed at which this clip plays at its own pace, in m/s: its feet do not slide at that speed. Faster or slower, it plays in proportion.',
      ),
  })
  .describe('The natural speed of one travelling clip.');

/** Where a clip turns Papa's body (story 2.13, D5). */
export const PAPA_FACINGS = ['camera', 'awayFromBaby'] as const;

const ClipFacingSchema = z
  .strictObject({
    clip: z
      .string()
      .regex(CUE_ID_PATTERN, 'a clip name is lower_snake_case')
      .describe("A clip of Papa's, as named in the `.glb`."),
    facing: z
      .enum(PAPA_FACINGS)
      .describe(
        "Where his body turns while the player sees this clip: `camera` faces the screen, `awayFromBaby` turns his back to the baby. The sim's heading is untouched.",
      ),
  })
  .describe('Where Papa faces while one clip plays.');

const BlablaPlaceSchema = z
  .strictObject({
    screenOffsetM: z
      .number()
      .min(-1)
      .max(1)
      .describe(
        'How far from Papa the bla-bla bubble stands across the screen, in metres: above 0 toward the right of the screen, below 0 toward the left.',
      ),
    heightM: z
      .number()
      .min(0.3)
      .max(1.2)
      .describe('How high above the floor the foot of the bla-bla bubble stands, in metres.'),
  })
  .describe("Where the bla-bla bubble stands at Papa's side, clear of the activity bubble.");

const BusyPropsSchema = z
  .strictObject({
    steamSwayDeg: z
      .number()
      .min(0)
      .max(45)
      .describe('How far the coffee steam leans to each side, in degrees.'),
    steamStretchPct: z
      .number()
      .min(0)
      .max(50)
      .describe('How much the steam grows and shrinks in height, in percent.'),
    steamPeriodMs: z
      .number()
      .min(SCREEN_FLASH_MIN_INTERVAL_MS)
      .describe(
        'How long a full sway of the steam lasts, in sim ms. Never under the 3 Hz flash cap.',
      ),
    blablaTiltDeg: z
      .number()
      .min(0)
      .max(45)
      .describe('How far the bla-bla bubble tilts to each side, in degrees.'),
    blablaBobAmplitudeM: z
      .number()
      .min(0)
      .max(0.2)
      .describe('How far the bla-bla bubble bobs up and down, in metres.'),
    blablaPeriodMs: z
      .number()
      .min(SCREEN_FLASH_MIN_INTERVAL_MS)
      .describe(
        'How long a full wobble of the bla-bla bubble lasts, in sim ms. Never under the 3 Hz flash cap.',
      ),
    blablaPlace: BlablaPlaceSchema,
  })
  .describe(
    "The side effects of Papa's busy props (story 2.13): the steam of his mug and the bla-bla of his phone. Sim clock; held still under reduced motion.",
  );

const CharactersSchema = z
  .strictObject({
    crossFadeMs: z
      .int()
      .positive()
      .describe('How long a clip takes to replace another, in sim ms.'),
    turnRateDegPerSec: z
      .number()
      .positive()
      .describe(
        "How fast a character's body turns to face its way, in degrees per sim second. The sim's heading and the baby's eyes do not wait for it.",
      ),
    squash: z.array(SquashRowSchema).describe('Which events squash and stretch whom.'),
    clipSpeeds: z.array(ClipSpeedSchema).describe('The natural speed of the travelling clips.'),
    papaClipFacing: z
      .array(ClipFacingSchema)
      .describe('Which clips turn Papa toward the camera or away from the baby (story 2.13).'),
    busyProps: BusyPropsSchema,
  })
  .superRefine((characters, ctx) => {
    // One row each: a second row for the same thing would silently win or lose, and an edit of Geo's
    // would then do nothing.
    const squashed = new Set<string>();
    for (const [index, row] of characters.squash.entries()) {
      const key = `${row.event}/${row.character}`;
      if (squashed.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['squash', index],
          message: `a second squash of ${row.character} on ${row.event}: one row each`,
        });
      }
      squashed.add(key);
    }
    const travelling = new Set<string>();
    for (const [index, row] of characters.clipSpeeds.entries()) {
      if (travelling.has(row.clip)) {
        ctx.addIssue({
          code: 'custom',
          path: ['clipSpeeds', index],
          message: `a second speed for the clip "${row.clip}": one row each`,
        });
      }
      travelling.add(row.clip);
    }
    const facing = new Set<string>();
    for (const [index, row] of characters.papaClipFacing.entries()) {
      if (facing.has(row.clip)) {
        ctx.addIssue({
          code: 'custom',
          path: ['papaClipFacing', index],
          message: `a second facing for the clip "${row.clip}": one row each`,
        });
      }
      facing.add(row.clip);
    }
  })
  .describe(
    'The animated characters (story 7.2). Read by the views on the sim clock; the sim never reads it.',
  );

/** `#RRGGBB`, the form of the colours of DESIGN.md. */
const HEX_COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const LightsRowSchema = z
  .strictObject({
    ambientColor: z
      .string()
      .regex(HEX_COLOUR_PATTERN, 'a colour is #RRGGBB')
      .describe('Ambient light colour.'),
    ambientIntensity: z.number().min(0).max(10).describe('Ambient light intensity.'),
    sunColor: z.string().regex(HEX_COLOUR_PATTERN, 'a colour is #RRGGBB').describe('Sun colour.'),
    sunIntensity: z.number().min(0).max(10).describe('Sun intensity.'),
  })
  .describe(
    "A level's lights. The drawn linear colour is `material x (ambient + sun x tone) / pi`, so ambient + sun = pi with white lights draws a sun-facing surface as authored. The colour of each light multiplies its intensity.",
  );

const RenderSchema = z
  .strictObject({
    toonTones: z
      .array(z.int().min(0).max(255))
      .min(2)
      .max(8)
      .refine(
        (tones) =>
          tones.every((tone, index) => index === 0 || tone >= (tones[index - 1] as number)),
        {
          message: 'the tones go from the darkest to the lightest',
        },
      )
      .describe(
        'The toon ramp, darkest to lightest, as 0-255 (ADR-008). Three reads it at `N.L x 0.5 + 0.5`, in equal bands.',
      ),
    lights: z
      .strictObject({
        default: LightsRowSchema.describe('The lights of any level that has no row of its own.'),
        byLevel: z
          .record(
            z.string().regex(CUE_ID_PATTERN, 'a level id is lower_snake_case'),
            LightsRowSchema,
          )
          .describe(
            'The lights of one level, by id. `npm run content:check` refuses an unknown level.',
          ),
      })
      .describe('The lights of each level (story 7.3, D7, D8).'),
    sunOffsetM: z
      .tuple([z.number(), z.number().gt(0), z.number()])
      .describe('Where the sun sits relative to the room centre, in metres: x, height, z.'),
    outlines: z
      .strictObject({
        widthM: z
          .number()
          .gt(0)
          .max(0.2)
          .describe(
            'How far the ink hull stands out of a silhouette, in metres of view space: constant on screen under the orthographic camera.',
          ),
        skipMaterials: z
          .array(z.string().min(1))
          .describe(
            'The materials of a `.glb` that get no hull: thickening what is already ink would close the eyes.',
          ),
      })
      .describe('The inverted-hull outlines of the characters and the props (story 7.3, D3, D4).'),
    dangerTint: z
      .strictObject({
        radiusM: z.number().gt(0).max(3).describe('Radius of the glow on a danger, in metres.'),
        minOpacityPct: z
          .number()
          .min(0)
          .max(100)
          .describe('Opacity at the low of the pulse, in percent.'),
        peakOpacityPct: z
          .number()
          .gt(0)
          .max(100)
          .describe(
            'Opacity at the top of the pulse, in percent; the steady one under reduced motion.',
          ),
        pulseHz: z
          .number()
          .gt(0)
          .max(3)
          .describe(
            'How fast the glow pulses, on the sim clock, in Hz. Nothing flashes above 3 Hz.',
          ),
      })
      .refine((tint) => tint.minOpacityPct <= tint.peakOpacityPct, {
        message: 'the low of the pulse is below its top',
        path: ['minOpacityPct'],
      })
      .describe(
        'The reserved alert glow on the anchor of a telegraphed or open threat (story 7.3, D5).',
      ),
    decalWallHeightM: z
      .number()
      .positive()
      .describe(
        "The colliders taller than this are the room's walls, no cover for the mess of a silence on the floor: its decal is moved off the furniture that hides it, never off the wall (story 3.15).",
      ),
    blobSkipColliderIds: z
      .array(z.string().min(1))
      .describe(
        'The colliders with no blob shadow: the height rule cannot tell a stairwell from furniture.',
      ),
  })
  .describe(
    'The final look (story 7.3). Client-only: unlike `feel.json` it is not hashed into the journal, so no golden moves for it.',
  );

export const FeedbackTableSchema = z
  .strictObject({
    buses: BusesSchema,
    haptics: HapticsSchema,
    loops: LoopsSchema,
    beatTracks: z
      .record(z.string().regex(CUE_ID_PATTERN, 'a track id is lower_snake_case'), BeatTrackSchema)
      .describe(
        'The rhythm tracks (story 4.5), by id, named by a `beats` step. The notes are planned one by one on the audio clock, not looped.',
      ),
    beatScheduler: BeatSchedulerSchema,
    beatRing: BeatRingSchema,
    resultScreen: ResultScreenSchema,
    calibration: CalibrationFeedbackSchema,
    sequenceBar: SequenceBarFeedbackSchema,
    comboBadge: ComboBadgeSchema,
    papaHint: PapaHintSchema,
    bombDrop: BombDropSchema,
    characters: CharactersSchema,
    door: DoorSchema,
    photo: PhotoSchema,
    replay: ReplaySchema,
    render: RenderSchema,
    cues: z
      .record(z.string().regex(CUE_ID_PATTERN, 'a cue id is lower_snake_case'), CueSchema)
      .describe('Every cue, by id. Threats will point at these ids.'),
    events: z
      .record(z.string().min(1), z.string().regex(CUE_ID_PATTERN, 'a cue id is lower_snake_case'))
      .describe(
        'Event name -> cue id. A sim event (`PapaBlocked`) or a client one (`CountdownTicked`); `npm run content:check` refuses any other name.',
      ),
  })
  .superRefine((table, ctx) => {
    // An event that points at a cue that does not exist plays nothing: refuse it where the file is
    // read (`loadContent`), not only in `npm run content:check`. `hasOwn`: `constructor` is no cue.
    for (const [name, cueId] of Object.entries(table.events)) {
      if (Object.hasOwn(table.cues, cueId)) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['events', name],
        message: `the cue "${cueId}" is not in cues`,
      });
    }
  })
  .describe(
    'The multimodal feedback table (ADR-006): which event plays which sound, ring, vibration and camera effect.',
  );

export type FeedbackTable = z.infer<typeof FeedbackTableSchema>;
export type FeedbackCue = z.infer<typeof CueSchema>;
export type FeedbackFlash = z.infer<typeof FlashSchema>;
export type ResultScreenTimings = z.infer<typeof ResultScreenSchema>;
export type PhotoSettings = z.infer<typeof PhotoSchema>;
export type ReplaySettings = z.infer<typeof ReplaySchema>;
export type ComboBadgeTimings = z.infer<typeof ComboBadgeSchema>;
export type BeatTrack = z.infer<typeof BeatTrackSchema>;
export type AudioBus = (typeof AUDIO_BUSES)[number];
export type HapticKind = (typeof HAPTIC_KINDS)[number];
