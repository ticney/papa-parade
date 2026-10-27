import { z } from 'zod';

// Every key of content/feedback.json lives here (ADR-006, architecture › Retours multimodaux): the
// one table that says which event plays which sound, ring, vibration and camera effect. Gains are
// percentages (linear: `gainPct / 100`); a cue's gain multiplies its bus's. Optional members are
// the point of a cue (a countdown tick is a haptic alone); `.default()` and `.transform()` stay out
// so that the file, the type and the emitted JSON Schema map one to one.

export const AUDIO_BUSES = ['music', 'sfx', 'voice', 'ui'] as const;
export const HAPTIC_KINDS = ['light', 'medium', 'heavy'] as const;

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

const LoopsSchema = z
  .strictObject({
    babble: LoopSchema.describe(
      'The baby babbles while `baby.babbling` (its stop is the silence).',
    ),
    music: LoopSchema.describe('The level music, for the whole level.'),
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
      .enum(['papa', 'baby', 'threat'])
      .describe(
        'Whose position the ring starts from. `threat` is the threat the event names; only for cues a threat def points at.',
      ),
    maxRadiusM: z.number().gt(0).max(3).describe('Radius of the ring when it is gone, in metres.'),
    durationMs: z
      .number()
      .positive()
      .describe('How long the ring takes to grow and fade, in sim ms.'),
  })
  .describe('The visual twin of a sound.');

const ShakeSchema = z
  .strictObject({
    kind: z.literal('shake').describe('The scene shakes.'),
    amplitudeM: z.number().gt(0).max(0.5).describe('Largest offset of the scene, in metres.'),
    durationMs: z.number().positive().describe('How long the shake lasts, in sim ms.'),
  })
  .describe('A camera effect. Skipped under reduced motion.');

const CueSchema = z
  .strictObject({
    audio: AudioCueSchema.optional(),
    visual: z
      .discriminatedUnion('kind', [SoundWaveSchema])
      .optional()
      .describe('A diegetic effect in the 3D world, the visual twin of the sound.'),
    haptic: z
      .enum(HAPTIC_KINDS)
      .optional()
      .describe('Vibration played with the cue, one of `haptics`.'),
    camera: z
      .discriminatedUnion('kind', [ShakeSchema])
      .optional()
      .describe('A camera effect, skipped under reduced motion.'),
  })
  .refine(
    (cue) =>
      cue.audio !== undefined ||
      cue.visual !== undefined ||
      cue.haptic !== undefined ||
      cue.camera !== undefined,
    { error: 'a cue needs at least one of audio, visual, haptic, camera' },
  )
  .describe(
    'What the player hears, sees and feels for one signal. Every audio has a visual and a haptic.',
  );

export const FeedbackTableSchema = z
  .strictObject({
    buses: BusesSchema,
    haptics: HapticsSchema,
    loops: LoopsSchema,
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
export type AudioBus = (typeof AUDIO_BUSES)[number];
export type HapticKind = (typeof HAPTIC_KINDS)[number];
