import { describe, expect, it } from 'vitest';
import { CalibrationResultSchema, createDefaultSave, SaveSchema } from './save.ts';

const CALIBRATION = {
  visualOffsetMs: 0,
  audioOffsetMs: 0,
  audioSkipped: true,
  measuredAt: '2026-10-30T10:00:00.000Z',
  device: 'web-desktop',
};

describe('SaveSchema', () => {
  it('accepts the defaults and a save with a calibration', () => {
    expect(SaveSchema.safeParse(createDefaultSave()).success).toBe(true);
    expect(SaveSchema.safeParse({ version: 1, calibration: CALIBRATION }).success).toBe(true);
  });

  it('accepts the offset bounds themselves and refuses a step beyond', () => {
    for (const offset of [-1000, 1000]) {
      expect(
        CalibrationResultSchema.safeParse({ ...CALIBRATION, visualOffsetMs: offset }).success,
      ).toBe(true);
    }
    for (const offset of [-1001, 1001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        CalibrationResultSchema.safeParse({ ...CALIBRATION, audioOffsetMs: offset }).success,
        String(offset),
      ).toBe(false);
    }
  });

  it('refuses a version other than 1, an unknown key and an empty device', () => {
    expect(SaveSchema.safeParse({ version: 2, calibration: null }).success).toBe(false);
    expect(SaveSchema.safeParse({ version: 1, calibration: null, x: 1 }).success).toBe(false);
    expect(CalibrationResultSchema.safeParse({ ...CALIBRATION, device: '' }).success).toBe(false);
  });
});
