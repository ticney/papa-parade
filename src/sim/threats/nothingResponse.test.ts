import type { LevelContent } from '@content/contentBundle';
import type { ThreatDef } from '@content/schemas/threat';
import { DIFFICULTY_TIER_IDS, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestFalseAlarm,
  createTestGeometry,
  createTestLevel,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { ThreatInstance, World } from '../world.ts';
import { isJudgeableBeforeEnd } from './judgeable.ts';

// The `nothing` response (story 4.9) at the threat level, on an anchored copy of the frozen false
// alarm (the response is generic: a baby-target def is planned by a stealth step only). The window
// IS the stretch to sit through: `nothingMs` from its opening, scaled by nothing. The frozen feel
// has a 60 ms tolerance and a 100 ms buffer; `earlyPress` is `fail` unless a test says otherwise.
const content = createTestContent();
const FALSE_ALARM = createTestFalseAlarm();
if (FALSE_ALARM.telegraphDelayMs === null || FALSE_ALARM.nothingMs === undefined) {
  throw new Error('the frozen false alarm lost its telegraph delay or its nothingMs');
}
const telegraphDelayMs: number = FALSE_ALARM.telegraphDelayMs;
const nothingMs: number = FALSE_ALARM.nothingMs;
const QUIET_ID = 'quiet_anchor';
const QUIET = { ...FALSE_ALARM, id: QUIET_ID, target: 'anchor' } as ThreatDef;

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

interface Options {
  readonly earlyPress?: 'fail' | 'guard';
  readonly lagMs?: number;
  readonly tier?: (typeof DIFFICULTY_TIER_IDS)[number];
  readonly durationMs?: number;
  /** A level with a `carry`, the only one that has a combo. */
  readonly hasCarry?: boolean;
}

/** The quiet def and the stairs, planned in a wave that never starts: only `ForceThreat` telegraphs them. */
function levelOf(durationMs?: number, hasCarry = false): LevelContent {
  const level = createTestLevel({
    waves: [testWave([STAIRS], { fromMs: 590_000 })],
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(hasCarry ? { carry: CARRY } : {}),
  });
  level.level.waves[0]?.threats.push({ def: QUIET_ID, anchor: 'outlet_01' });
  return { ...level, threats: { ...level.threats, [QUIET_ID]: QUIET } };
}

async function create({
  earlyPress = 'fail',
  lagMs = 0,
  tier,
  durationMs,
  hasCarry,
}: Options = {}) {
  const feel = { ...content.feel, input: { ...content.feel.input, earlyPress } };
  const sim = await createSim({
    content: { ...content, feel },
    geometry: createTestGeometry(),
    level: levelOf(durationMs, hasCarry),
    seed: 1,
  });
  const world = sim.world as World;
  if (lagMs > 0) sim.enqueue({ type: 'SetInputLag', t: world.time.sim, lagMs });
  if (tier !== undefined) sim.enqueue({ type: 'SetDifficultyTier', t: world.time.sim, tier });
  const quiet = world.threats.find((threat) => threat.defId === QUIET_ID) as ThreatInstance;
  const stairs = world.threats.find((threat) => threat.defId === 'stairs') as ThreatInstance;
  const events: SimEvent[] = [];
  const runTo = (untilMs: number): SimEvent[] => {
    const seen: SimEvent[] = [];
    while (world.time.sim < untilMs) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    events.push(...seen);
    return seen;
  };
  const force = (threat: ThreatInstance) =>
    sim.enqueue({ type: 'ForceThreat', t: world.time.sim, threatId: threat.id });
  return { sim, world, quiet, stairs, events, runTo, force };
}

/** A sim whose quiet threat has just been telegraphed (the step that did it is drained). */
async function telegraphed(options: Options = {}) {
  const round = await create(options);
  round.force(round.quiet);
  round.runTo(round.world.time.sim + STEP_MS);
  if (round.quiet.state !== 'telegraph') throw new Error('the quiet threat was not telegraphed');
  return {
    ...round,
    openAt: round.quiet.windowOpenAt,
    endAt: round.quiet.windowOpenAt + nothingMs,
  };
}

const press = (sim: Sim, threat: ThreatInstance, t: number) =>
  sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });

describe('the telegraph of a nothing threat (story 4.9)', () => {
  it.each(DIFFICULTY_TIER_IDS)(
    'freezes nothingMs as the whole window at the %s tier, with no perfect zone, tolerance or buffer',
    async (tier) => {
      const { quiet, openAt } = await telegraphed({ tier });
      expect(quiet.responseWindow).toEqual({
        windowMs: nothingMs,
        perfectMs: 0,
        toleranceMs: 0,
        bufferMs: 0,
      });
      expect(openAt).toBe(quiet.enteredAt + telegraphDelayMs);
    },
  );

  it('draws nothing from the rng', async () => {
    const round = await create();
    const before = { ...round.world.rng };
    round.force(round.quiet);
    round.runTo(round.world.time.sim + STEP_MS);
    expect(round.quiet.state).toBe('telegraph');
    expect(round.world.rng).toEqual(before);
  });

  it('leaves the window of any other def as it was', async () => {
    const round = await create();
    round.force(round.stairs);
    round.runTo(round.world.time.sim + STEP_MS);
    const { timing } = content.feel;
    expect(round.stairs.responseWindow).toMatchObject({
      windowMs: timing.windowMs,
      toleranceMs: timing.toleranceMs,
      bufferMs: timing.bufferMs,
    });
  });
});

describe('sitting it through (story 4.9)', () => {
  it.each(DIFFICULTY_TIER_IDS)(
    'is a success at windowOpenAt + nothingMs exactly, at the %s tier (the length does not scale)',
    async (tier) => {
      const { runTo, quiet, openAt, endAt } = await telegraphed({ tier });
      const before = runTo(endAt - STEP_MS);
      expect(only(before, 'ResponseResolved')).toEqual([]);
      expect(quiet.state).toBe('windowOpen');
      const seen = runTo(endAt);
      const resolved = only(seen, 'ResponseResolved');
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({
        t: endAt,
        response: 'nothing',
        quality: 'success',
        offsetMs: 0,
        responseWindow: { windowMs: nothingMs, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
      });
      expect(only(seen, 'GagTriggered')).toEqual([]);
      expect(quiet.state).toBe('resolved');
      expect(openAt + nothingMs).toBe(endAt);
    },
  );

  it('is never perfect, and has no hitstop', async () => {
    const { sim, runTo, endAt } = await telegraphed();
    const seen = runTo(endAt - STEP_MS);
    expect(sim.freezeRealMs).toBe(0);
    seen.push(...runTo(endAt));
    expect(sim.freezeRealMs).toBe(0);
    expect(only(seen, 'ResponseResolved').map((event) => event.quality)).toEqual(['success']);
  });

  it('counts for the combo, and rearms after its cooldown', async () => {
    const { world, runTo, endAt, quiet } = await telegraphed({ hasCarry: true });
    const seen = runTo(endAt);
    expect(only(seen, 'ComboChanged').length).toBeGreaterThan(0);
    expect(world.score.perfects).toBe(0);
    const later = runTo(endAt + QUIET.cooldownMs + STEP_MS);
    expect(only(later, 'ThreatRearmed')).toHaveLength(1);
    expect(quiet.state).toBe('idle');
  });

  it.each([100, 250])(
    'waits lagMs (%i) to decide from an absence, and never gags as a late response',
    async (lagMs) => {
      const { runTo, quiet, endAt } = await telegraphed({ lagMs });
      const before = runTo(endAt + lagMs - STEP_MS);
      expect(only(before, 'ResponseResolved')).toEqual([]);
      expect(quiet.state).toBe('windowOpen');
      const seen = runTo(endAt + lagMs);
      expect(only(seen, 'ResponseResolved')).toMatchObject([
        { quality: 'success', t: endAt + lagMs },
      ]);
      expect(only(seen, 'GagTriggered')).toEqual([]);
    },
  );

  it('does not fail by the late expiry however long it is left (tolerance included)', async () => {
    const { runTo, endAt } = await telegraphed({ lagMs: 500 });
    const seen = runTo(endAt + 3000);
    expect(only(seen, 'GagTriggered')).toEqual([]);
    expect(only(seen, 'ResponseResolved').map((event) => event.quality)).toEqual(['success']);
  });
});

describe('acting on it (story 4.9)', () => {
  // A press at the telegraph, at the opening and one step before the end: a gag, `acted`, whatever
  // `earlyPress` says (`fail` and `guard`); the offset is null.
  const instants: readonly [string, (openAt: number, endAt: number) => number][] = [
    ['at the telegraph', (openAt) => openAt - telegraphDelayMs + STEP_MS],
    ['one step before the opening', (openAt) => openAt - STEP_MS],
    ['at the opening', (openAt) => openAt],
    ['one step before the end', (_openAt, endAt) => endAt - STEP_MS],
  ];

  it.each(
    (['fail', 'guard'] as const).flatMap((earlyPress) =>
      instants.map(([name, instantOf]) => [earlyPress, name, instantOf] as const),
    ),
  )('with earlyPress %s, a press %s is an acted gag', async (earlyPress, _name, instantOf) => {
    const { sim, quiet, runTo, openAt, endAt } = await telegraphed({ earlyPress });
    press(sim, quiet, instantOf(openAt, endAt));
    const seen = runTo(endAt + 3 * STEP_MS);
    expect(only(seen, 'ResponseResolved')).toMatchObject([
      { response: 'nothing', quality: 'fail', reason: 'acted', offsetMs: null },
    ]);
    expect(only(seen, 'GagTriggered')).toMatchObject([
      { gag: 'baby_woke_by_touch', reason: 'acted' },
    ]);
    expect(quiet.press).toBeNull();
    expect(sim.freezeRealMs).toBe(0);
  });

  it('gags a press stamped before the end that arrives within lagMs of it', async () => {
    const lagMs = 200;
    const { sim, quiet, runTo, endAt } = await telegraphed({ lagMs });
    runTo(endAt + STEP_MS);
    expect(quiet.state).toBe('windowOpen');
    press(sim, quiet, endAt - STEP_MS);
    const seen = runTo(endAt + lagMs + 2 * STEP_MS);
    expect(only(seen, 'GagTriggered')).toMatchObject([
      { gag: 'baby_woke_by_touch', reason: 'acted' },
    ]);
    expect(only(seen, 'ResponseResolved').map((event) => event.quality)).toEqual(['fail']);
  });

  it('ignores a press stamped at the end or after it, with no gag', async () => {
    const { sim, quiet, runTo, endAt } = await telegraphed({ lagMs: 200 });
    runTo(endAt - STEP_MS);
    press(sim, quiet, endAt);
    press(sim, quiet, endAt + STEP_MS);
    const seen = runTo(endAt + 200 + 2 * STEP_MS);
    expect(only(seen, 'GagTriggered')).toEqual([]);
    expect(only(seen, 'ResponseResolved').map((event) => event.quality)).toEqual(['success']);
  });

  it('makes the baby cry through gagCryMs', async () => {
    const { sim, quiet, runTo, openAt, endAt } = await telegraphed();
    press(sim, quiet, openAt);
    const seen = runTo(endAt);
    expect(only(seen, 'BabyCrying').length).toBeGreaterThan(0);
  });
});

describe('every other action stays allowed (story 4.9)', () => {
  it.each(['telegraph', 'windowOpen'] as const)(
    'a floor tap, a move, a release and a press on another threat cost nothing in %s',
    async (state) => {
      const { sim, world, quiet, stairs, runTo, force, openAt, endAt } = await telegraphed();
      if (state === 'windowOpen') runTo(openAt + STEP_MS);
      expect(quiet.state).toBe(state);
      const at = world.time.sim;
      sim.enqueue({ type: 'TapFloor', t: asSimMs(at), xM: 0, zM: 0 });
      sim.enqueue({ type: 'Move', t: asSimMs(at), dirX: 1, dirZ: 0 });
      sim.enqueue({ type: 'MoveStop', t: asSimMs(at + STEP_MS) });
      sim.enqueue({ type: 'Release', t: asSimMs(at + STEP_MS) });
      force(stairs);
      runTo(at + 2 * STEP_MS);
      expect(stairs.state).toBe('telegraph');
      press(sim, stairs, world.time.sim);
      const seen = runTo(endAt);
      expect(
        only(seen, 'GagTriggered').filter((event) => event.gag === 'baby_woke_by_touch'),
      ).toEqual([]);
      expect(quiet.state).toBe('resolved');
      expect(
        only(seen, 'ResponseResolved').filter((event) => event.threatId === quiet.id),
      ).toMatchObject([{ quality: 'success' }]);
    },
  );
});

describe('isJudgeableBeforeEnd (story 4.9)', () => {
  it('counts nothingMs, which no tier scales, and no tolerance', async () => {
    const { world } = await create();
    const ctx = { feel: world.feel } as unknown as StepContext;
    const fitsAt = world.time.sim + telegraphDelayMs + nothingMs;
    expect(isJudgeableBeforeEnd(world, ctx, QUIET, world.time.sim, fitsAt)).toBe(true);
    expect(isJudgeableBeforeEnd(world, ctx, QUIET, world.time.sim, fitsAt - 1)).toBe(false);
  });
});
