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
    bodyRead: {
      activities: ['chore', 'coffee', 'phone', 'stealth', 'fatigue', 'carrying'],
      namedMinPct: 80,
      repetitivePoseMaxTesters: 0,
    },
    humanBot: { maxStarGap: 1, maxPerfectExcessPct: 10 },
    simulated: {
      runs: 200,
      seed: 1,
      tier: 'normal',
      humanLossPct: { min: 10, max: 30 },
      humanMustFailDefs: ['outlet'],
      humanOpenDoorMustGag: true,
      perfectChoresEveryRun: true,
      idleLosesBeforeTimer: true,
    },
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

describe('PlaytestSchema › simulated (story 9.8)', () => {
  const withSimulated = (patch: object) => ({
    ...validFile(),
    simulated: { ...validFile().simulated, ...patch },
  });

  it('refuses a missing block, an unknown key and a tier that does not exist', () => {
    const { simulated: _omitted, ...rest } = validFile();
    expect(PlaytestSchema.safeParse(rest).success).toBe(false);
    expect(PlaytestSchema.safeParse(withSimulated({ extra: 1 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withSimulated({ tier: 'hard' })).success).toBe(false);
  });

  it('refuses a number of games or a seed out of range', () => {
    expect(PlaytestSchema.safeParse(withSimulated({ runs: 0 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withSimulated({ runs: 10_001 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withSimulated({ seed: -1 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withSimulated({ seed: 2 ** 32 })).success).toBe(false);
  });

  it('refuses a loss range that is upside down or outside 0..100', () => {
    expect(
      PlaytestSchema.safeParse(withSimulated({ humanLossPct: { min: 30, max: 10 } })).success,
    ).toBe(false);
    expect(
      PlaytestSchema.safeParse(withSimulated({ humanLossPct: { min: 10, max: 101 } })).success,
    ).toBe(false);
    expect(
      PlaytestSchema.safeParse(withSimulated({ humanLossPct: { min: 20, max: 20 } })).success,
    ).toBe(true);
  });
});

describe('PlaytestSchema › bodyRead (story 7.12, D14)', () => {
  const withBodyRead = (patch: Partial<PlaytestFile['bodyRead']>) => ({
    ...validFile(),
    bodyRead: { ...validFile().bodyRead, ...patch },
  });

  it('refuses a missing block and an unknown key', () => {
    const { bodyRead: _omitted, ...rest } = validFile();
    expect(PlaytestSchema.safeParse(rest).success).toBe(false);
    expect(PlaytestSchema.safeParse(withBodyRead({ extra: 1 } as never)).success).toBe(false);
  });

  it('refuses no activity, an activity twice, and an id that is not lower_snake_case', () => {
    expect(PlaytestSchema.safeParse(withBodyRead({ activities: [] })).success).toBe(false);
    expect(
      PlaytestSchema.safeParse(withBodyRead({ activities: ['coffee', 'coffee'] })).success,
    ).toBe(false);
    expect(PlaytestSchema.safeParse(withBodyRead({ activities: ['Coffee'] })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withBodyRead({ activities: ['on_phone'] })).success).toBe(true);
  });

  it('bounds the share named and the testers citing a repetitive pose', () => {
    expect(PlaytestSchema.safeParse(withBodyRead({ namedMinPct: 101 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withBodyRead({ namedMinPct: -1 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withBodyRead({ namedMinPct: 79.5 })).success).toBe(false);
    expect(PlaytestSchema.safeParse(withBodyRead({ repetitivePoseMaxTesters: -1 })).success).toBe(
      false,
    );
    expect(PlaytestSchema.safeParse(withBodyRead({ repetitivePoseMaxTesters: 0.5 })).success).toBe(
      false,
    );
    expect(PlaytestSchema.safeParse(withBodyRead({ repetitivePoseMaxTesters: 101 })).success).toBe(
      false,
    );
    expect(
      PlaytestSchema.safeParse(withBodyRead({ namedMinPct: 0, repetitivePoseMaxTesters: 100 }))
        .success,
    ).toBe(true);
  });
});
