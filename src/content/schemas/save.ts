import { SAVE_VERSION } from '@shared/constants';
import { z } from 'zod';

// The single versioned save under the `papa-parade.save` key (story 2.7; architecture › Persistance).
// It lives in `content` because zod does, and the store that reads it (`client/save/saveStore.ts`)
// has no zod import. Strict, camelCase, units in the names, no `.default()`, `.optional()` or
// `.transform()`: a v1 save is exactly this shape, and a new field is a new version with a migration.

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

export const SaveSchema = z
  .strictObject({
    version: z.literal(SAVE_VERSION).describe('Schema version of the save.'),
    calibration: CalibrationResultSchema.nullable().describe(
      'The latency calibration, or `null` when the player has not been through it.',
    ),
  })
  .describe('The save of the game. Story 2.8 adds `settings`, with its migration.');

export type Save = z.infer<typeof SaveSchema>;
export type CalibrationResult = z.infer<typeof CalibrationResultSchema>;

/** A new player: nothing measured yet. */
export function createDefaultSave(): Save {
  return { version: SAVE_VERSION, calibration: null };
}
