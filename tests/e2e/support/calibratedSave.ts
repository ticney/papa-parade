import type { Save, Settings } from '../../../src/content/schemas/save.ts';

// The save of a player who has been through the latency calibration (story 2.7), with offsets of 0:
// the Playwright configs seed it into every context, so that no spec has to click through the
// calibration and no timing moves (an offset of 0 corrects nothing and sends no `SetInputLag`).
// `tests/content/calibratedSave.test.ts` parses it with `SaveSchema`, so it cannot rot.

/** Key of the save in `localStorage` (the same as `SAVE_KEY`; `tests` cannot rely on the alias). */
export const SAVE_STORAGE_KEY = 'papa-parade.save';

/**
 * A valid v3 save with a calibration (story 2.8: it also holds the default settings, the normal
 * tier, which sends no command, so no timing moves; story 2.10: both comfort switches off). `overrides` change the calibration and
 * `settings` the settings, for what a spec cares about.
 */
export function calibratedSave(
  overrides: Partial<NonNullable<Save['calibration']>> = {},
  settings: Partial<Settings> = {},
): Save {
  return {
    version: 3,
    calibration: {
      visualOffsetMs: 0,
      audioOffsetMs: 0,
      audioSkipped: true,
      measuredAt: '2026-01-01T00:00:00.000Z',
      device: 'web-touch',
      ...overrides,
    },
    settings: {
      tier: 'normal',
      volumes: { music: 100, sfx: 100, voice: 100, ui: 100 },
      haptics: true,
      reducedMotion: false,
      largeVerbs: false,
      ...settings,
    },
  };
}

/** The `localStorage` value of {@link calibratedSave}. */
export const calibratedSaveValue = (
  overrides: Partial<NonNullable<Save['calibration']>> = {},
  settings: Partial<Settings> = {},
): string => JSON.stringify(calibratedSave(overrides, settings));

/** A Playwright `storageState` that holds the calibrated save for the page served at `baseURL`. */
export function calibratedStorageState(baseURL: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [{ name: SAVE_STORAGE_KEY, value: calibratedSaveValue() }],
      },
    ],
  };
}
