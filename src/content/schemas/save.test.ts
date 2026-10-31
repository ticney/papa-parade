import { describe, expect, it } from 'vitest';
import { CalibrationResultSchema, createDefaultSave, SaveSchema, SettingsSchema } from './save.ts';

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
    expect(SaveSchema.safeParse({ ...createDefaultSave(), calibration: CALIBRATION }).success).toBe(
      true,
    );
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

  it('gives a new player the normal tier, full volumes, vibrations on and both comfort switches off', () => {
    expect(createDefaultSave()).toEqual({
      version: 3,
      calibration: null,
      settings: {
        tier: 'normal',
        volumes: { music: 100, sfx: 100, voice: 100, ui: 100 },
        haptics: true,
        reducedMotion: false,
        largeVerbs: false,
      },
    });
  });

  it('hands out settings nobody else holds', () => {
    expect(createDefaultSave().settings).not.toBe(createDefaultSave().settings);
  });

  it('refuses a version other than 3, an unknown key and an empty device', () => {
    expect(SaveSchema.safeParse({ ...createDefaultSave(), version: 2 }).success).toBe(false);
    expect(SaveSchema.safeParse({ ...createDefaultSave(), version: 4 }).success).toBe(false);
    expect(SaveSchema.safeParse({ ...createDefaultSave(), x: 1 }).success).toBe(false);
    expect(CalibrationResultSchema.safeParse({ ...CALIBRATION, device: '' }).success).toBe(false);
  });
});

describe('SettingsSchema', () => {
  const settings = () => createDefaultSave().settings;

  it.each([0, 5, 55, 100])('accepts a volume of %i', (music) => {
    expect(
      SettingsSchema.safeParse({ ...settings(), volumes: { ...settings().volumes, music } })
        .success,
    ).toBe(true);
  });

  it.each([-1, 101, 50.5, Number.NaN, '50'])('refuses a volume of %j', (music) => {
    expect(
      SettingsSchema.safeParse({ ...settings(), volumes: { ...settings().volumes, music } })
        .success,
    ).toBe(false);
  });

  it('refuses an unknown tier, a missing bus, an unknown key and a non-boolean toggle', () => {
    expect(SettingsSchema.safeParse({ ...settings(), tier: 'hard' }).success).toBe(false);
    const { ui: _ui, ...three } = settings().volumes;
    expect(SettingsSchema.safeParse({ ...settings(), volumes: three }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...settings(), motion: true }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...settings(), haptics: 'yes' }).success).toBe(false);
  });

  it('accepts both comfort switches on, and refuses a missing or non-boolean one', () => {
    expect(
      SettingsSchema.safeParse({ ...settings(), reducedMotion: true, largeVerbs: true }).success,
    ).toBe(true);
    const { reducedMotion: _motion, ...noMotion } = settings();
    const { largeVerbs: _verbs, ...noVerbs } = settings();
    expect(SettingsSchema.safeParse(noMotion).success).toBe(false);
    expect(SettingsSchema.safeParse(noVerbs).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...settings(), reducedMotion: 1 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...settings(), largeVerbs: 'yes' }).success).toBe(false);
  });
});
