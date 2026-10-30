import { describe, expect, it } from 'vitest';
import { SaveSchema } from '../../src/content/schemas/save.ts';
import { SAVE_KEY } from '../../src/shared/constants.ts';
import {
  calibratedSave,
  calibratedSaveValue,
  calibratedStorageState,
  SAVE_STORAGE_KEY,
} from '../e2e/support/calibratedSave.ts';

describe('the e2e calibrated save (story 2.7)', () => {
  it('is a valid v1 save, with offsets of 0 so that no timing moves', () => {
    const parsed = SaveSchema.safeParse(JSON.parse(calibratedSaveValue()));
    expect(parsed.success).toBe(true);
    expect(calibratedSave().calibration).toMatchObject({ visualOffsetMs: 0, audioOffsetMs: 0 });
  });

  it('stays valid with the overrides a spec uses', () => {
    const parsed = SaveSchema.safeParse(calibratedSave({ visualOffsetMs: 100 }));
    expect(parsed.success).toBe(true);
  });

  it("is stored under the game's save key", () => {
    expect(SAVE_STORAGE_KEY).toBe(SAVE_KEY);
  });

  it('is seeded for the origin of the page served at the base URL, path ignored', () => {
    const state = calibratedStorageState('http://localhost:5179/some/path');
    expect(state.origins).toEqual([
      {
        origin: 'http://localhost:5179',
        localStorage: [{ name: SAVE_KEY, value: calibratedSaveValue() }],
      },
    ]);
    expect(state.cookies).toEqual([]);
  });
});
