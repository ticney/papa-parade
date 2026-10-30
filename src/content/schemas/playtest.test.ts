import { describe, expect, it } from 'vitest';
import { PlaytestSchema, type PlaytestThresholds } from './playtest.ts';

function validFile(): PlaytestThresholds {
  return {
    panelMinTesters: 5,
    relaunchMinPct: 70,
    perfectCitedMinPct: 80,
    identifiedMinPct: 80,
    firstEncounterSuccessMinPct: 80,
    touchVsKeyboardMinPct: 80,
    laughedMinPct: 80,
  };
}

describe('PlaytestSchema', () => {
  it('accepts a complete file', () => {
    expect(PlaytestSchema.safeParse(validFile()).success).toBe(true);
  });

  it('refuses an unknown key', () => {
    const parsed = PlaytestSchema.safeParse({ ...validFile(), laughMinPct: 80 });
    expect(parsed.success).toBe(false);
  });

  it('refuses a missing key', () => {
    const { laughedMinPct: _omitted, ...rest } = validFile();
    expect(PlaytestSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses a percentage above 100 or below 0', () => {
    expect(PlaytestSchema.safeParse({ ...validFile(), relaunchMinPct: 101 }).success).toBe(false);
    expect(PlaytestSchema.safeParse({ ...validFile(), laughedMinPct: -1 }).success).toBe(false);
  });

  it('refuses a fractional percentage and a panel below one tester', () => {
    expect(PlaytestSchema.safeParse({ ...validFile(), identifiedMinPct: 79.5 }).success).toBe(
      false,
    );
    expect(PlaytestSchema.safeParse({ ...validFile(), panelMinTesters: 0 }).success).toBe(false);
  });
});
