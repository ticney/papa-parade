import { SCREEN_FLASH_MIN_INTERVAL_MS } from '@shared/constants';
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
const CLIP_PATTERN = /^(tel|resp|gag|baby|papa|env|ui|music)_[a-z0-9]+(_[a-z0-9]+)*$/;
/** `lower_snake_case`, like every content id. */
const CUE_ID_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

const gainPct = (description: string) => z.number().min(0).max(100).describe(description);

const clip = z
  .string()
  .regex(
    CLIP_PATTERN,
    'a clip is <category>_<name> in lower_snake_case, the category one of tel, resp, gag, baby, papa, env, ui, music',
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
      .enum(['papa', 'baby', 'threat', 'object'])
      .describe(
        'Whose position the ring starts from. `threat` is the threat the event names; only for cues a threat def points at. `object` is the object the event names (`objectId`); only for cues a disruption def points at.',
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
  })
  .describe(
    'The sequence of the Result screen (story 1.22): rows, then stars, then buttons. Real time: the sim never reads it.',
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

const SequenceBarFeedbackSchema = z
  .strictObject({
    slideMs: realMs(
      'How long the sequence bar stays mounted after the end, to slide out, in real ms. Real time: not read from `transitionend`, which never fires under reduced motion.',
    ),
  })
  .describe('The sequence bar under the timer (story 4.4). Real time: the sim never reads it.');

export const FeedbackTableSchema = z
  .strictObject({
    buses: BusesSchema,
    haptics: HapticsSchema,
    loops: LoopsSchema,
    resultScreen: ResultScreenSchema,
    calibration: CalibrationFeedbackSchema,
    sequenceBar: SequenceBarFeedbackSchema,
    comboBadge: ComboBadgeSchema,
    papaHint: PapaHintSchema,
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
export type ComboBadgeTimings = z.infer<typeof ComboBadgeSchema>;
export type AudioBus = (typeof AUDIO_BUSES)[number];
export type HapticKind = (typeof HAPTIC_KINDS)[number];
