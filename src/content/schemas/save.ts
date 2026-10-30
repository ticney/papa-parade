import {
  DEFAULT_DIFFICULTY_TIER,
  DIFFICULTY_TIER_IDS,
  SAVE_VERSION,
  VOLUME_MAX_PCT,
} from '@shared/constants';
import { z } from 'zod';

// The single versioned save under the `papa-parade.save` key (story 2.7; architecture › Persistance).
// It lives in `content` because zod does, and the store that reads it (`client/save/saveStore.ts`)
// has no zod import. Strict, camelCase, units in the names, no `.default()`, `.optional()` or
// `.transform()`: a save is exactly this shape, and a new field is a new version with a migration
// (architecture › Persistance: each field comes with the story that uses it).

/** Wider than `feel.calibration`'s bounds, which Geo can retune: a save never goes stale by it. */
const OFFSET_LIMIT_MS = 1000;

const offsetMs = (description: string) =>
  z.number().min(-OFFSET_LIMIT_MS).max(OFFSET_LIMIT_MS).describe(description);

export const CalibrationResultSchema = z
  .strictObject({
    visualOffsetMs: offsetMs(
      'How late the screen shows what the game drew, in ms (positive = late). Subtracted from every input stamp.',
    ),
    audioOffsetMs: offsetMs(
      'How late the audio reaches the player, in ms. Stored for E4; nothing reads it yet.',
    ),
    audioSkipped: z
      .boolean()
      .describe('The audio phase was skipped (by the player, or because audio could not play).'),
    measuredAt: z.iso
      .datetime()
      .describe(
        'Wall-clock ISO date of the measure. Not sim time: it names a moment in the player’s life, not in a game.',
      ),
    device: z
      .string()
      .min(1)
      .max(64)
      .describe('`<target>-<touch|desktop>` from the platform capabilities. Never a user-agent.'),
  })
  .describe('The result of the latency calibration (story 2.7).');

const volumePct = (description: string) =>
  z.number().int().min(0).max(VOLUME_MAX_PCT).describe(description);

export const SettingsSchema = z
  .strictObject({
    tier: z.enum(DIFFICULTY_TIER_IDS).describe('Difficulty tier, applied to the next game.'),
    volumes: z
      .strictObject({
        music: volumePct('Music volume, in whole percent. 100 is the mix of `feedback.json`.'),
        sfx: volumePct('Sound effects volume, in whole percent.'),
        voice: volumePct('Voice volume, in whole percent.'),
        ui: volumePct('Interface volume, in whole percent.'),
      })
      .describe('What the player multiplies each audio bus by.'),
    haptics: z.boolean().describe('Vibrations on or off.'),
  })
  .describe('The settings screen (story 2.8). `reducedMotion` and `largeVerbs` come with 2.10.');

export const SaveSchema = z
  .strictObject({
    version: z.literal(SAVE_VERSION).describe('Schema version of the save.'),
    calibration: CalibrationResultSchema.nullable().describe(
      'The latency calibration, or `null` when the player has not been through it.',
    ),
    settings: SettingsSchema,
  })
  .describe('The save of the game (version 2: story 2.8 added `settings`).');

export type Save = z.infer<typeof SaveSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type CalibrationResult = z.infer<typeof CalibrationResultSchema>;

/** The settings of a new player: the normal tier, the mix of `feedback.json` as it is, vibrations on. */
export function createDefaultSettings(): Settings {
  return {
    tier: DEFAULT_DIFFICULTY_TIER,
    volumes: {
      music: VOLUME_MAX_PCT,
      sfx: VOLUME_MAX_PCT,
      voice: VOLUME_MAX_PCT,
      ui: VOLUME_MAX_PCT,
    },
    haptics: true,
  };
}

/** A new player: nothing measured yet, default settings. */
export function createDefaultSave(): Save {
  return { version: SAVE_VERSION, calibration: null, settings: createDefaultSettings() };
}
