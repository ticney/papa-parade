import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { SEQUENCE_STEP_KINDS, SequenceDefSchema } from '@content/schemas/sequence';
import { type StealthDefShape, type StealthRoom, sequenceStealthProblems } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestFalseAlarm,
  createTestRealWake,
  createTestStealthExit,
} from '../support/testContent.ts';

// The stealth step in the sequence schema and in `sequenceStealthProblems` (story 4.9): one failing
// test per rule, on the frozen files (the live ones are tuned freely).
const frozen = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL('../support/testStealth.sequence.json', import.meta.url), 'utf8'),
  );

function failedPaths(value: unknown): string[] {
  const result = parseContentFile(
    'content/sequences/x.json',
    JSON.stringify(value),
    SequenceDefSchema,
  );
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

function edited(change: (copy: Record<string, unknown>) => void): Record<string, unknown> {
  const copy = structuredClone(frozen());
  change(copy);
  return copy;
}
const stepOf = (copy: Record<string, unknown>) =>
  (copy.steps as Record<string, unknown>[])[0] as Record<string, unknown>;

describe('the stealth step in the sequence schema (story 4.9)', () => {
  it('parses, and the kind is listed', () => {
    expect(failedPaths(frozen())).toEqual([]);
    expect(SEQUENCE_STEP_KINDS).toContain('stealth');
  });

  it.each([
    ['durationMs', undefined, 'steps[0].durationMs'],
    ['durationMs', 0, 'steps[0].durationMs'],
    ['exitAnchor', 'Door', 'steps[0].exitAnchor'],
    ['exitAnchor', undefined, 'steps[0].exitAnchor'],
    ['exitRadiusM', 0, 'steps[0].exitRadiusM'],
    ['exitRadiusM', undefined, 'steps[0].exitRadiusM'],
    ['alertGapMinMs', 0, 'steps[0].alertGapMinMs'],
    ['alertGapMaxMs', 1.5, 'steps[0].alertGapMaxMs'],
    ['realWakePct', 0, 'steps[0].realWakePct'],
    ['realWakePct', 101, 'steps[0].realWakePct'],
    ['realWakePct', 30.5, 'steps[0].realWakePct'],
    ['falseAlarmDef', 'False Alarm', 'steps[0].falseAlarmDef'],
    ['realWakeDef', undefined, 'steps[0].realWakeDef'],
  ] as const)('rejects a stealth step with %s = %s', (key, value, path) => {
    const copy = edited((c) => {
      const step = stepOf(c);
      if (value === undefined) delete step[key];
      else step[key] = value;
    });
    expect(failedPaths(copy)).toContain(path);
  });

  it('rejects an alertGapMaxMs below alertGapMinMs', () => {
    expect(failedPaths(edited((c) => (stepOf(c).alertGapMaxMs = 3000)))).toEqual([
      'steps[0].alertGapMaxMs',
    ]);
  });

  it('accepts alertGapMinMs equal to alertGapMaxMs (a fixed gap) and realWakePct 100', () => {
    expect(
      failedPaths(
        edited((c) => {
          stepOf(c).alertGapMaxMs = stepOf(c).alertGapMinMs;
          stepOf(c).realWakePct = 100;
        }),
      ),
    ).toEqual([]);
  });

  it('rejects an unknown key on the step (strict)', () => {
    expect(failedPaths(edited((c) => (stepOf(c).wakePct = 5)))).not.toEqual([]);
  });

  it('refuses a stealth step among other steps', () => {
    const copy = edited((c) => {
      (c.steps as unknown[]).push({ ...stepOf(c) });
    });
    expect(failedPaths(copy)).toContain('steps');
  });

  const refusals: [string, (c: Record<string, unknown>) => void, string][] = [
    [
      'a failure that is not a gag',
      (c) => {
        c.failure = { kind: 'retreats', maxRetreats: 2 };
      },
      'failure',
    ],
    [
      'a failure with a snore',
      (c) => {
        c.failure = { kind: 'gag', hasSnore: true };
      },
      'failure',
    ],
    [
      'a carried baby',
      (c) => {
        c.babyCarried = true;
      },
      'babyCarried',
    ],
    [
      'a babyLaid success',
      (c) => {
        c.success = { kind: 'babyLaid' };
      },
      'success.kind',
    ],
    [
      'a timeLeft bar',
      (c) => {
        (c.framing as Record<string, unknown>).bar = {
          labelKey: 'bar.time',
          fill: 'player',
          value: 'timeLeft',
        };
      },
      'framing.bar',
    ],
  ];

  it.each(refusals)('refuses %s', (_name, change, path) => {
    expect(failedPaths(edited(change))).toContain(path);
  });
});

// ---------------------------------------------------------------------------------------------
// sequenceStealthProblems: the same words in createSim and in content:check.

const content = createTestContent();
const LIMITS = {
  maxWindowMultiplier: Math.max(
    ...Object.values(content.feel.difficulty).map((tier) => tier.windowMultiplier),
  ),
  toleranceMs: content.feel.timing.toleranceMs,
  windowMs: content.feel.timing.windowMs,
  telegraphDelayDefaultMs: content.feel.timing.telegraphDelayDefaultMs,
};
const ROOM: StealthRoom = {
  hasCarry: true,
  anchorPointOf: (id) => (id === 'door' ? { xM: 2.9, zM: -2.8 } : undefined),
  hasOpenCellWithin: () => true,
};
const THREATS = {
  false_alarm_sigh: createTestFalseAlarm(),
  real_wake: createTestRealWake(),
};
const def = (): StealthDefShape => createTestStealthExit() as unknown as StealthDefShape;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function stepOfDef(shape: StealthDefShape): Mutable<Record<string, unknown>> {
  return shape.steps[0] as unknown as Mutable<Record<string, unknown>>;
}

describe('sequenceStealthProblems (story 4.9)', () => {
  it('finds nothing wrong with the frozen sequence on a good room', () => {
    expect(sequenceStealthProblems(def(), THREATS, LIMITS, ROOM)).toEqual([]);
  });

  it('says nothing about a sequence with no stealth step', () => {
    const duel = { ...def(), steps: [{ kind: 'duel' as const }] };
    expect(sequenceStealthProblems(duel, THREATS, LIMITS, ROOM)).toEqual([]);
  });

  const one = (
    shape: StealthDefShape,
    room: StealthRoom | null = ROOM,
    threats: Parameters<typeof sequenceStealthProblems>[1] = THREATS,
  ) => sequenceStealthProblems(shape, threats, LIMITS, room);

  it('refuses a stealth step that is not the only step', () => {
    const shape = { ...def(), steps: [...def().steps, { kind: 'beats' as const }] };
    expect(one(shape).join('\n')).toMatch(/must be the only step/);
  });

  it('refuses a failure that is not a gag with hasSnore false', () => {
    expect(one({ ...def(), failure: { kind: 'gag', hasSnore: true } }).join('\n')).toMatch(
      /hasSnore false/,
    );
    expect(one({ ...def(), failure: { kind: 'retreats' } }).join('\n')).toMatch(/hasSnore false/);
  });

  it('refuses a carried baby', () => {
    expect(one({ ...def(), babyCarried: true }).join('\n')).toMatch(/`babyCarried` must be false/);
  });

  it('refuses a success that is not stepsDone', () => {
    expect(one({ ...def(), success: { kind: 'babyLaid' } }).join('\n')).toMatch(
      /must be "stepsDone"/,
    );
  });

  it('refuses a bar', () => {
    expect(one({ ...def(), framing: { bar: { value: 'timeLeft' } } }).join('\n')).toMatch(
      /bar must be null/,
    );
  });

  it('refuses a level with no carry', () => {
    expect(one(def(), { ...ROOM, hasCarry: false }).join('\n')).toMatch(/no carry/);
  });

  it('skips the room rules with no room (no geometry to look at)', () => {
    expect(one(def(), null)).toEqual([]);
  });

  it('refuses an unloaded false alarm and an unloaded real wake', () => {
    expect(one(def(), ROOM, { real_wake: THREATS.real_wake }).join('\n')).toMatch(
      /falseAlarmDef "false_alarm_sigh" is not loaded/,
    );
    expect(one(def(), ROOM, { false_alarm_sigh: THREATS.false_alarm_sigh }).join('\n')).toMatch(
      /realWakeDef "real_wake" is not loaded/,
    );
  });

  it('refuses a false alarm that is not a nothing on the baby', () => {
    const wrong = {
      ...THREATS,
      false_alarm_sigh: { ...THREATS.false_alarm_sigh, response: 'parry' },
    };
    expect(one(def(), ROOM, wrong).join('\n')).toMatch(/a false alarm is a "nothing" on the baby/);
    const onPapa = {
      ...THREATS,
      false_alarm_sigh: { ...THREATS.false_alarm_sigh, target: 'papa' },
    };
    expect(one(def(), ROOM, onPapa).join('\n')).toMatch(/a false alarm is a "nothing" on the baby/);
  });

  it('refuses a real wake that is not a parry on the baby', () => {
    const wrong = { ...THREATS, real_wake: { ...THREATS.real_wake, response: 'firm' } };
    expect(one(def(), ROOM, wrong).join('\n')).toMatch(/a real wake is a "parry" on the baby/);
    const onAnchor = { ...THREATS, real_wake: { ...THREATS.real_wake, target: 'anchor' } };
    expect(one(def(), ROOM, onAnchor).join('\n')).toMatch(/a real wake is a "parry" on the baby/);
  });

  it('refuses the micro-sleep gag on either alert', () => {
    const asleepA = {
      ...THREATS,
      false_alarm_sigh: { ...THREATS.false_alarm_sigh, gag: 'papa_asleep' },
    };
    expect(one(def(), ROOM, asleepA).join('\n')).toMatch(/falseAlarmDef.*papa_asleep/);
    const asleepB = { ...THREATS, real_wake: { ...THREATS.real_wake, gag: 'papa_asleep' } };
    expect(one(def(), ROOM, asleepB).join('\n')).toMatch(/realWakeDef.*papa_asleep/);
  });

  it('refuses a gap that does not clear the false alarm (telegraph + nothingMs + cooldownMs)', () => {
    const alarm = THREATS.false_alarm_sigh;
    const neededMs = (alarm.telegraphDelayMs ?? 0) + (alarm.nothingMs ?? 0) + alarm.cooldownMs;
    const shape = def();
    stepOfDef(shape).alertGapMinMs = neededMs;
    expect(one(shape).join('\n')).toMatch(/a false alarm takes/);
    stepOfDef(shape).alertGapMinMs = neededMs + 1;
    expect(one(shape).join('\n')).not.toMatch(/a false alarm takes/);
  });

  it('refuses a breath capacity under the false alarm (telegraph + nothingMs), and skips the rule with no capacity', () => {
    const alarm = THREATS.false_alarm_sigh;
    const neededMs = (alarm.telegraphDelayMs ?? 0) + (alarm.nothingMs ?? 0);
    const shape = def();
    expect(sequenceStealthProblems(shape, THREATS, LIMITS, ROOM, neededMs - 1).join('\n')).toMatch(
      /needs 2900 ms of breath.*every false alarm would end in an empty gasp/,
    );
    expect(sequenceStealthProblems(shape, THREATS, LIMITS, ROOM, neededMs)).toEqual([]);
    expect(sequenceStealthProblems(shape, THREATS, LIMITS, ROOM, null)).toEqual([]);
    expect(
      sequenceStealthProblems(shape, THREATS, LIMITS, ROOM, content.feel.stealth.breathCapacityMs),
    ).toEqual([]);
  });

  it('refuses a gap that does not clear the real wake (telegraph + widest window + tolerance + cooldownMs)', () => {
    const wake = THREATS.real_wake;
    const neededMs =
      (wake.telegraphDelayMs ?? 0) +
      (wake.windowMs ?? LIMITS.windowMs) * LIMITS.maxWindowMultiplier +
      LIMITS.toleranceMs +
      wake.cooldownMs;
    const slow = { ...THREATS, false_alarm_sigh: { ...THREATS.false_alarm_sigh, nothingMs: 100 } };
    const shape = def();
    stepOfDef(shape).alertGapMinMs = neededMs;
    expect(one(shape, ROOM, slow).join('\n')).toMatch(/a real wake can take/);
    stepOfDef(shape).alertGapMinMs = neededMs + 1;
    expect(one(shape, ROOM, slow).join('\n')).not.toMatch(/a real wake can take/);
  });

  it('refuses an exit anchor the level does not have', () => {
    const shape = def();
    stepOfDef(shape).exitAnchor = 'window';
    expect(one(shape).join('\n')).toMatch(/exitAnchor "window" is not an anchor of the level/);
  });

  it('refuses an exit with no open cell in reach', () => {
    expect(one(def(), { ...ROOM, hasOpenCellWithin: () => false }).join('\n')).toMatch(
      /no open cell within exitRadiusM/,
    );
  });
});
