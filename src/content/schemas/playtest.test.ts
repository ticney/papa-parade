import { describe, expect, it } from 'vitest';
import { type PlaytestFile, PlaytestSchema } from './playtest.ts';

function validFile(): PlaytestFile {
  return {
    panelMinTesters: 5,
    relaunchMinPct: 70,
    perfectCitedMinPct: 80,
    identifiedMinPct: 80,
    firstEncounterSuccessMinPct: 80,
    touchVsKeyboardMinPct: 80,
    laughedMinPct: 80,
    humanBot: { maxStarGap: 1, maxPerfectExcessPct: 10 },
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

  it('refuses a human-bot block that is missing, unknown or out of range', () => {
    const { humanBot: _omitted, ...rest } = validFile();
    expect(PlaytestSchema.safeParse(rest).success).toBe(false);
    const withHumanBot = (humanBot: object) =>
      PlaytestSchema.safeParse({ ...validFile(), humanBot });
    expect(withHumanBot({ maxStarGap: 1 }).success).toBe(false);
    expect(withHumanBot({ maxStarGap: 0, maxPerfectExcessPct: 10 }).success).toBe(false);
    expect(withHumanBot({ maxStarGap: 1, maxPerfectExcessPct: -1 }).success).toBe(false);
    expect(withHumanBot({ maxStarGap: 1, maxPerfectExcessPct: 101 }).success).toBe(false);
    expect(withHumanBot({ maxStarGap: 1, maxPerfectExcessPct: 10, extra: 1 }).success).toBe(false);
    expect(withHumanBot({ maxStarGap: 0.5, maxPerfectExcessPct: 0 }).success).toBe(true);
  });

  it('refuses a fractional percentage and a panel below one tester', () => {
    expect(PlaytestSchema.safeParse({ ...validFile(), identifiedMinPct: 79.5 }).success).toBe(
      false,
    );
    expect(PlaytestSchema.safeParse({ ...validFile(), panelMinTesters: 0 }).success).toBe(false);
  });
});
