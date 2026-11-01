import { botSeed } from '@bots/botSeed';
import { nextGaussian } from '@bots/gaussian';
import { playGame } from '@bots/playGame';
import { fingerPlanFor, planStealthWalk } from '@bots/threatTiming';
import { createRng } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { createSim, type SimCommand, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, makeBot, responses } from '../support/botSupport.ts';
import {
  CARRY,
  createTestContent,
  createTestFalseAlarm,
  createTestGeometry,
  createTestLevel,
  createTestStealthExit,
  NOISE_GAUGES,
} from '../support/testContent.ts';

// The bots and the stealth exit (story 4.9, AC 18): `perfect` walks to the door, holds its breath from the
// first step of each false alarm's telegraph to the end of its window and parries each real wake; `human`
// does the same with a reaction time and one draw for the release (so it sometimes gasps); `idle` loses
// to the first real wake; none of them ever presses a false alarm. The frozen content: a 900 ms
// telegraph and 2000 ms to sit through, a real wake after 1500 ms, an alert every 4 to 7 s, 30 % real.
const ALARM = createTestFalseAlarm();
const NO_JITTER = { reactionMs: 250, aimOffsetMs: 0, jitterSdMs: 0 };
const ALERT_GAP_MS = 3500;

async function playStealth(
  id: 'perfect' | 'human' | 'idle' | 'random',
  seed: number,
  human: Partial<typeof NO_JITTER> = {},
  untilSimMs = 60_000,
  realWakePct?: number,
) {
  const sequence = createTestStealthExit();
  const stealthStep = sequence.steps[0];
  // A steady alert every 3.5 s (just above a false alarm's whole cycle), so that the crossing meets some.
  const tuned =
    stealthStep?.kind !== 'stealth'
      ? sequence
      : {
          ...sequence,
          steps: [
            {
              ...stealthStep,
              alertGapMinMs: ALERT_GAP_MS,
              alertGapMaxMs: ALERT_GAP_MS,
              ...(realWakePct === undefined ? {} : { realWakePct }),
            },
          ],
        };
  const lvl = createTestLevel({
    carry: CARRY,
    gauges: NOISE_GAUGES,
    sequences: [tuned.id],
    sequenceDefs: { [tuned.id]: tuned },
  });
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: lvl,
    seed,
    strictInvariants: true,
  });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: tuned.id });
  const events: SimEvent[] = [];
  const settings = { human: { ...NO_JITTER, ...human } };
  playGame(sim, makeBot(id, botSetup(seed, settings, lvl)), untilSimMs, (event) =>
    events.push({ ...event }),
  );
  return { sim, events };
}

const typed = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const outcomeOf = (events: readonly SimEvent[]) => typed(events, 'SequenceEnded')[0]?.outcome;

describe('the perfect bot and the stealth exit', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'wins seed %i at the door with no gag and no gasp',
    async (seed) => {
      const { events } = await playStealth('perfect', seed);
      expect(outcomeOf(events)).toBe('succeeded');
      expect(typed(events, 'GagTriggered')).toEqual([]);
      expect(typed(events, 'BreathGasped')).toEqual([]);
    },
  );

  it('holds its breath from the first step of each false alarm’s telegraph, and lets go at the end of the window, to the ms', async () => {
    // Real wakes at 1 %: false alarms nearly always, so the run has some.
    const { sim, events } = await playStealth('perfect', 3, {}, 60_000, 1);
    const alarms = typed(events, 'ThreatTelegraphed').filter((event) => event.kind === ALARM.id);
    expect(alarms.length).toBeGreaterThan(0);
    const holds = sim.journal().entries.filter((entry) => entry.command.type === 'HoldAnywhere');
    const letGos = sim.journal().entries.filter((entry) => entry.command.type === 'ReleaseHold');
    expect(holds.length).toBeGreaterThanOrEqual(alarms.length);
    const first = alarms[0];
    const open = typed(events, 'WindowOpened').find((event) => event.threatId === first?.threatId);
    expect(holds[0]?.command.t).toBe(first?.t);
    expect(letGos[0]?.command.t).toBe((open?.t ?? Number.NaN) + (ALARM.nothingMs ?? Number.NaN));
  });

  it('never presses a false alarm: no PressThreat names a nothing', async () => {
    const { sim, events } = await playStealth('perfect', 4, {}, 60_000, 1);
    const alarmIds = new Set(
      typed(events, 'ThreatTelegraphed')
        .filter((event) => event.kind === ALARM.id)
        .map((event) => event.threatId),
    );
    expect(alarmIds.size).toBeGreaterThan(0);
    const presses = sim
      .journal()
      .entries.filter((entry) => entry.command.type === 'PressThreat')
      .map((entry) => (entry.command as { threatId: number }).threatId);
    for (const id of alarmIds) expect(presses).not.toContain(id);
  });

  it('answers every real wake with a perfect parry, however many come (a wake every 3.5 s keeps Papa from the door)', async () => {
    const { events } = await playStealth('perfect', 2, {}, 30_000, 100);
    const parries = responses(events).filter((event) => event.response === 'parry');
    expect(parries.length).toBeGreaterThan(3);
    for (const event of parries) expect(event.quality).toBe('perfect');
    expect(typed(events, 'GagTriggered')).toEqual([]);
    expect(outcomeOf(events)).toBeUndefined();
  });

  it('sends nothing at all outside a stealth step', async () => {
    const lvl = createTestLevel({ carry: CARRY, sequences: ['stealth_exit'] });
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: lvl,
      seed: 1,
      strictInvariants: true,
    });
    const out: SimCommand[] = [];
    makeBot('perfect', botSetup(1, {}, lvl)).act(sim.world, out);
    expect(out).toEqual([]);
    planStealthWalk(sim.world, botSetup(1, {}, lvl).responses, out);
    expect(out).toEqual([]);
  });
});

describe('the human bot and the stealth exit', () => {
  it('holds its breath reactionMs after the telegraph and lets go at the end of the window with no jitter: no gasp', async () => {
    const { sim, events } = await playStealth('human', 5, {}, 60_000, 1);
    const alarm = typed(events, 'ThreatTelegraphed').find((event) => event.kind === ALARM.id);
    expect(alarm).toBeDefined();
    const hold = sim.journal().entries.find((entry) => entry.command.type === 'HoldAnywhere');
    expect(hold?.command.t).toBe((alarm?.t ?? Number.NaN) + NO_JITTER.reactionMs);
    expect(typed(events, 'BreathGasped')).toEqual([]);
  });

  it('draws exactly one gaussian for a false alarm’s release, so it can let go early and gasp', async () => {
    const seed = 6;
    const lvlProbe = await playStealth('human', seed, { jitterSdMs: 300 }, 60_000, 1);
    const alarm = typed(lvlProbe.events, 'ThreatTelegraphed').find(
      (event) => event.kind === ALARM.id,
    );
    expect(alarm).toBeDefined();
    const open = typed(lvlProbe.events, 'WindowOpened').find(
      (event) => event.threatId === alarm?.threatId,
    );
    const rng = createRng(botSeed(seed));
    const expectedRelease = Math.max(
      Math.round((open?.t ?? 0) + (ALARM.nothingMs ?? 0) + 300 * nextGaussian(rng)),
      (alarm?.t ?? 0) + NO_JITTER.reactionMs + 1,
    );
    const letGo = lvlProbe.sim
      .journal()
      .entries.find((entry) => entry.command.type === 'ReleaseHold');
    expect(letGo?.command.t).toBe(expectedRelease);
  });

  it('gasps early on a seed whose draw lets go before the end (and only then)', async () => {
    let sawEarly = false;
    for (let seed = 1; seed <= 12 && !sawEarly; seed++) {
      const { events } = await playStealth('human', seed, { jitterSdMs: 400 }, 40_000, 1);
      sawEarly = typed(events, 'BreathGasped').some((event) => event.reason === 'early');
    }
    expect(sawEarly).toBe(true);
  });

  it('parries every real wake with no jitter, and is never gagged for it', async () => {
    const { events } = await playStealth('human', 3, {}, 30_000, 100);
    expect(responses(events).filter((event) => event.response === 'parry').length).toBeGreaterThan(
      3,
    );
    expect(typed(events, 'GagTriggered')).toEqual([]);
  });
});

describe('the idle and random bots in the stealth exit', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'idle loses seed %i to a real wake, never a touch',
    async (seed) => {
      const { events } = await playStealth('idle', seed, {}, 120_000, 100);
      expect(outcomeOf(events)).toBe('failed');
      expect(typed(events, 'GagTriggered').map((event) => event.gag)).toEqual(['baby_woke_crying']);
    },
  );

  it('random presses a false alarm sooner or later: an acted gag', async () => {
    let sawActed = false;
    for (let seed = 1; seed <= 30 && !sawActed; seed++) {
      const { events } = await playStealth('random', seed, {}, 60_000, 1);
      sawActed = typed(events, 'GagTriggered').some((event) => event.reason === 'acted');
    }
    expect(sawActed).toBe(true);
  });
});

describe('fingerPlanFor (story 4.9)', () => {
  it('plans no finger at all for a nothing', () => {
    expect(fingerPlanFor('nothing', 80)).toEqual({ kind: 'none' });
  });
});
