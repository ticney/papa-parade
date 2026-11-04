import type { Bot, BotOptions, BotResponse, BotSetup } from '@bots/bot';
import { playGame } from '@bots/playGame';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { createSim, type SimCommand, type SimEvent, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, makeBot, playBotGame, responses } from '../support/botSupport.ts';
import {
  CARRY,
  createTestBots,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../support/testContent.ts';

// The human model of story 3.14, rule by rule (AC 1-3). Each rule is checked by comparing two
// settings on the same seeds, so that a test able to pass by accident cannot (the 3.5 / 3.12 lesson).

type Human = BotOptions['human'];

/** The frozen human settings with some keys replaced. */
function human(patch: Partial<Human> = {}): Human {
  return { ...createTestBots().human, ...patch };
}

const NO_NOISE = { offsetMs: 0, sdMs: 0 };

/** The setup, told only about the defs that ask for `response` (the others are left alone), or all of them. */
function onlyAnswering(setup: BotSetup, response?: BotResponse): BotSetup {
  if (response === undefined) return setup;
  const known = Object.entries(setup.responses).filter(([, asked]) => asked === response);
  return { ...setup, responses: Object.fromEntries(known) };
}

// ---------------------------------------------------------------------------------------------
// Reaction time (AC 1) and the read error by what is shown (AC 2): whole games.
// ---------------------------------------------------------------------------------------------

describe('the human bot, reaction time (AC 1)', () => {
  /** Press instants minus their telegraph, over a few games with the aim far before the reaction floor. */
  async function reactionsOf(settings: Human): Promise<number[]> {
    const lags: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const readError = {
        withChronoRing: { offsetMs: -2000, sdMs: 0 },
        withoutChronoRing: NO_NOISE,
      };
      const { sim, events } = await playBotGame('human', seed, {
        untilSimMs: 40_000,
        settings: { human: { ...settings, readError } },
      });
      const telegraphs = events.flatMap((event) =>
        event.type === 'ThreatTelegraphed' ? [{ threatId: event.threatId, t: event.t }] : [],
      );
      const presses = sim.journal().entries.filter((entry) => entry.command.type === 'PressThreat');
      expect(presses.length).toBeGreaterThanOrEqual(2);
      for (const { command } of presses) {
        // Each press is paired with the last telegraph of its own threat before it (a threat rearms),
        // not with the telegraph at the same rank.
        const { threatId } = command as { threatId: number };
        const own = telegraphs.filter((telegraph) => telegraph.threatId === threatId);
        const last = own.filter((telegraph) => telegraph.t <= command.t).at(-1);
        lags.push(command.t - (last?.t ?? Number.NaN));
      }
    }
    return lags;
  }

  it('with no spread, the reaction is max(min, mean) to the ms, every time', async () => {
    const lags = await reactionsOf(
      human({ reactionMeanMs: 300, reactionSdMs: 0, reactionMinMs: 0 }),
    );
    expect(new Set(lags)).toEqual(new Set([300]));
    const floored = await reactionsOf(
      human({ reactionMeanMs: 100, reactionSdMs: 0, reactionMinMs: 400 }),
    );
    expect(new Set(floored)).toEqual(new Set([400]));
  });

  it('with a spread, the reactions differ, are whole ms and never go under the minimum', async () => {
    const lags = await reactionsOf(
      human({ reactionMeanMs: 250, reactionSdMs: 100, reactionMinMs: 200 }),
    );
    expect(new Set(lags).size).toBeGreaterThan(5);
    for (const lag of lags) {
      expect(Number.isInteger(lag)).toBe(true);
      expect(lag).toBeGreaterThanOrEqual(200);
    }
    // A mean of 250 and an sd of 100 over a floor of 200 does reach above 300 now and then.
    expect(Math.max(...lags)).toBeGreaterThan(300);
  });
});

describe('the human bot, read error by what is shown (AC 2)', () => {
  const WIDE = {
    withChronoRing: { offsetMs: 0, sdMs: 60 },
    withoutChronoRing: { offsetMs: 0, sdMs: 600 },
  };

  async function perfectsOf(isChronoRingShown: boolean, readError: Human['readError']) {
    let perfect = 0;
    let all = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { events } = await playBotGame('human', seed, {
        untilSimMs: 40_000,
        settings: { human: human({ readError }) },
        isChronoRingShown,
      });
      for (const response of responses(events)) {
        all++;
        if (response.quality === 'perfect') perfect++;
      }
    }
    expect(all).toBeGreaterThan(40);
    return perfect;
  }

  it('hidden ring with a wide error gets fewer perfects than the shown one, on the same seeds', async () => {
    const shown = await perfectsOf(true, WIDE);
    const hidden = await perfectsOf(false, WIDE);
    expect(shown).toBeGreaterThan(hidden + 10);
  }, 30_000);

  it('uses the offset of its mode: shown aims early, hidden aims at the centre', async () => {
    const readError = { withChronoRing: { offsetMs: -1000, sdMs: 0 }, withoutChronoRing: NO_NOISE };
    for (const [isChronoRingShown, quality] of [
      [true, 'fail'],
      [false, 'perfect'],
    ] as const) {
      const { events } = await playBotGame('human', 1, {
        untilSimMs: 30_000,
        settings: { human: human({ readError }) },
        isChronoRingShown,
      });
      expect(responses(events).length).toBeGreaterThanOrEqual(1);
      for (const response of responses(events)) {
        expect(response.quality).toBe(quality);
        if (quality === 'fail') expect(response.reason).toBe('early');
      }
    }
  });

  it('the mode changes nothing when both modes have the same error', async () => {
    const same = {
      withChronoRing: { offsetMs: 10, sdMs: 60 },
      withoutChronoRing: { offsetMs: 10, sdMs: 60 },
    };
    const a = await playBotGame('human', 2, {
      untilSimMs: 30_000,
      settings: { human: human({ readError: same }) },
      isChronoRingShown: true,
    });
    const b = await playBotGame('human', 2, {
      untilSimMs: 30_000,
      settings: { human: human({ readError: same }) },
      isChronoRingShown: false,
    });
    expect(hashJson(a.sim.journal())).toBe(hashJson(b.sim.journal()));
  });

  it('perfect, random and idle ignore the mode', async () => {
    for (const id of ['perfect', 'random', 'idle'] as const) {
      const shown = await playBotGame(id, 3, { untilSimMs: 20_000, isChronoRingShown: true });
      const hidden = await playBotGame(id, 3, { untilSimMs: 20_000, isChronoRingShown: false });
      expect(hashJson(hidden.sim.journal()), id).toBe(hashJson(shown.sim.journal()));
    }
  });
});

describe('the human bot, what has no ring does not depend on the mode (AC 2)', () => {
  const MODES = {
    withChronoRing: { offsetMs: -500, sdMs: 300 },
    withoutChronoRing: { offsetMs: 400, sdMs: 900 },
  };

  /** One game of a sequence of the frozen content, with the ring shown or not. */
  async function playSequence(
    sequenceId: string,
    isChronoRingShown: boolean,
    settings: Human,
    only?: BotResponse,
  ) {
    const level = createTestLevel({ carry: CARRY, sequences: [sequenceId] });
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level,
      seed: 1,
      strictInvariants: true,
    });
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId });
    const events: SimEvent[] = [];
    const setup: BotSetup = {
      ...onlyAnswering(botSetup(1, { human: settings }, level), only),
      isChronoRingShown,
    };
    playGame(sim, makeBot('human', setup), 40_000, (event) => events.push({ ...event }));
    return { sim, events };
  }

  it('a wait (the bedtime duel) is the same game with the ring shown or hidden', async () => {
    const settings = human({ readError: MODES });
    const shown = await playSequence('bedtime_duel', true, settings, 'wait');
    const hidden = await playSequence('bedtime_duel', false, settings, 'wait');
    expect(shown.events.some((event) => event.type === 'WaitSignalGiven')).toBe(true);
    expect(hashJson(hidden.sim.journal())).toBe(hashJson(shown.sim.journal()));
  });

  it('a bomb drop uses the mode for its release, and only for its release', async () => {
    const settings = human({
      reactionSdMs: 0,
      readError: {
        withChronoRing: NO_NOISE,
        withoutChronoRing: { offsetMs: 80, sdMs: 0 },
      },
      aimOffsetMs: -300,
      jitterSdMs: 0,
    });
    const shown = await playSequence('bomb_drop', true, settings);
    const hidden = await playSequence('bomb_drop', false, settings);
    const timesOf = (game: { sim: Awaited<ReturnType<typeof playSequence>>['sim'] }) =>
      game.sim
        .journal()
        .entries.filter((entry) => ['PressThreat', 'Release'].includes(entry.command.type))
        .map((entry) => entry.command.t);
    const [pressShown, releaseShown] = timesOf(shown);
    const [pressHidden, releaseHidden] = timesOf(hidden);
    expect(pressHidden).toBe(pressShown);
    expect((releaseHidden ?? Number.NaN) - (releaseShown ?? Number.NaN)).toBe(80);
  });

  it('a lullaby beat is tapped at the same instant whatever the mode', () => {
    const beatWorld = (now: number): Readonly<World> =>
      ({
        time: { sim: asSimMs(now) },
        threats: [],
        silence: { threatId: null, zoneEnteredAt: null, startedAt: null },
        cycle: { index: 0, nextAt: null, completedAt: null },
        flow: { state: 'playing', enteredAt: 0, finalRushAt: null },
        props: [],
        papa: { xM: 0, zM: 0, state: 'idle' },
        sequence: {
          beat: { isRunning: true, nextBeatAt: 3000 },
          stealth: { isRunning: false },
        },
      }) as unknown as Readonly<World>;
    const tapsOf = (isChronoRingShown: boolean): number[] => {
      const bot = makeBot('human', {
        ...botSetup(7, { human: human({ readError: MODES, jitterSdMs: 40 }) }),
        isChronoRingShown,
      });
      const taps: SimCommand[] = [];
      for (let now = 2000; now < 3600; now += STEP_MS) bot.act(beatWorld(now), taps);
      return taps.filter((command) => command.type === 'TapBeat').map((command) => command.t);
    };
    expect(tapsOf(true)).toHaveLength(1);
    expect(tapsOf(false)).toEqual(tapsOf(true));
  });
});

// ---------------------------------------------------------------------------------------------
// Not seeing a threat while busy (AC 3): fake worlds, the bot only reads the slices it needs.
// ---------------------------------------------------------------------------------------------

const WINDOW = { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 };

interface FakeThreat {
  id: number;
  defId: string;
  state: string;
  enteredAt: number;
  windowOpenAt: number;
}

const threatAt = (
  id: number,
  defId: string,
  enteredAt: number,
  windowOpenAt: number,
): FakeThreat => ({
  id,
  defId,
  state: 'telegraph',
  enteredAt,
  windowOpenAt,
});

function worldOf(now: number, threats: readonly FakeThreat[], papaState = 'idle'): Readonly<World> {
  return {
    time: { sim: asSimMs(now) },
    threats: threats.map((threat) => ({
      ...threat,
      xM: 0,
      zM: 0,
      feintAt: null,
      isFeintGiven: false,
      responseWindow: WINDOW,
      press: null,
      waveIndex: 0,
    })),
    silence: { threatId: null, zoneEnteredAt: null, startedAt: null },
    cycle: { index: 0, nextAt: null, completedAt: null },
    flow: { state: 'playing', enteredAt: 0, finalRushAt: null },
    props: [],
    papa: { xM: 0, zM: 0, state: papaState },
    sequence: { beat: { isRunning: false, nextBeatAt: null }, stealth: { isRunning: false } },
  } as unknown as Readonly<World>;
}

/** The ids the bot presses, in order, stepping `[fromMs, untilMs)` over the worlds `worldAt` gives. */
function pressesOf(
  bot: Bot,
  fromMs: number,
  untilMs: number,
  worldAt: (now: number) => Readonly<World>,
): { id: number; t: number }[] {
  const out: SimCommand[] = [];
  for (let now = fromMs; now < untilMs; now += STEP_MS) bot.act(worldAt(now), out);
  return out.flatMap((command) =>
    command.type === 'PressThreat' ? [{ id: command.threatId, t: command.t }] : [],
  );
}

const botWith = (seed: number, missWhileBusyPct: number, patch: Partial<BotSetup> = {}): Bot =>
  makeBot('human', { ...botSetup(seed, { human: human({ missWhileBusyPct }) }), ...patch });

describe('the human bot, not seeing a threat while busy (AC 3)', () => {
  const OUTLET = threatAt(1, 'outlet', 1000, 2200);
  const STAIRS = threatAt(2, 'stairs', 1000, 2200);

  it('a threat first seen while free is always answered, whatever the percentage', () => {
    for (const pct of [0, 50, 100]) {
      for (let seed = 1; seed <= 5; seed++) {
        const presses = pressesOf(botWith(seed, pct), 1000, 2800, (now) => worldOf(now, [OUTLET]));
        expect(
          presses.map((press) => press.id),
          `pct ${pct}, seed ${seed}`,
        ).toEqual([1]);
      }
    }
  });

  it.each(['asleep', 'drink', 'onPhone', 'onToilet'])(
    'Papa %s: a threat first seen then is missed at 100 % and answered at 0 %',
    (papaState) => {
      const worldAt = (now: number) => worldOf(now, [OUTLET], papaState);
      expect(pressesOf(botWith(1, 100), 1000, 2800, worldAt)).toEqual([]);
      expect(pressesOf(botWith(1, 0), 1000, 2800, worldAt).map((press) => press.id)).toEqual([1]);
    },
  );

  it.each(['walkPath', 'walkDir', 'glide'])(
    'Papa %s is not busy: he is on his way',
    (papaState) => {
      const worldAt = (now: number) => worldOf(now, [OUTLET], papaState);
      expect(pressesOf(botWith(1, 100), 1000, 2800, worldAt).map((press) => press.id)).toEqual([1]);
    },
  );

  it('a threat first seen while an answer is planned and not yet sent is missed: the other one is answered', () => {
    const worldAt = (now: number) => worldOf(now, [OUTLET, STAIRS]);
    const missed = pressesOf(botWith(1, 100), 1000, 2800, worldAt);
    expect(missed.map((press) => press.id)).toEqual([1]);
    const both = pressesOf(botWith(1, 0), 1000, 2800, worldAt);
    expect(both.map((press) => press.id).sort()).toEqual([1, 2]);
  });

  it('a threat first seen while the find of a silence is pending is missed; once found, it is not', () => {
    const SILENCE = { threatId: null, zoneEnteredAt: null, startedAt: 1000 };
    const LATE = threatAt(1, 'outlet', 1100, 2400);
    const setupOf = (pct: number) =>
      botSetup(1, {
        human: human({
          reactionMeanMs: 600,
          reactionSdMs: 0,
          reactionMinMs: 0,
          missWhileBusyPct: pct,
        }),
      });
    const withSilence = (now: number): Readonly<World> =>
      ({
        ...worldOf(now, now < 1100 ? [] : [LATE]),
        silence: SILENCE,
      }) as unknown as Readonly<World>;
    // The find is planned at 1000 for 1600: at 1100 the bot's hand is on its way to the baby.
    expect(pressesOf(makeBot('human', setupOf(100)), 1000, 3000, withSilence)).toEqual([]);
    expect(
      pressesOf(makeBot('human', setupOf(0)), 1000, 3000, withSilence).map((press) => press.id),
    ).toEqual([1]);
    // Seen after the find was sent (1600), the same threat is answered even at 100 %.
    const later = (now: number): Readonly<World> =>
      ({
        ...worldOf(now, now < 1700 ? [] : [threatAt(1, 'outlet', 1700, 3000)]),
        silence: SILENCE,
      }) as unknown as Readonly<World>;
    expect(
      pressesOf(makeBot('human', setupOf(100)), 1000, 3800, later).map((press) => press.id),
    ).toEqual([1]);
  });

  it('a threat first seen while a Firmness is held is missed for good, though the finger frees later', () => {
    const firmed = { responses: { outlet: 'firm', stairs: 'parry' } as const };
    const FAR = threatAt(2, 'stairs', 1010, 4000);
    const worldAt = (now: number) => {
      // The Firmness is answered at 2000: the finger is free from then on.
      const first = now < 2000 ? OUTLET : { ...OUTLET, state: 'resolved' };
      return worldOf(now, now < 1010 ? [first] : [first, FAR]);
    };
    const setupOf = (pct: number) => ({
      ...botSetup(1, { human: human({ missWhileBusyPct: pct }) }),
      ...firmed,
    });
    const answered = pressesOf(makeBot('human', setupOf(0)), 1000, 4600, worldAt);
    expect(answered.map((press) => press.id)).toEqual([1, 2]);
    // The decision was taken while the finger was down, not later when it was free.
    const missed = pressesOf(makeBot('human', setupOf(100)), 1000, 4600, worldAt);
    expect(missed.map((press) => press.id)).toEqual([1]);
  });

  it('is decided once per cycle: free at first sight, busy later, it still answers', () => {
    const worldAt = (now: number) => worldOf(now, [OUTLET], now < 1500 ? 'idle' : 'asleep');
    expect(pressesOf(botWith(1, 100), 1000, 2800, worldAt).map((press) => press.id)).toEqual([1]);
  });

  it('a missed threat is seen afresh when it rearms', () => {
    const REARMED = threatAt(1, 'outlet', 6000, 7200);
    const worldAt = (now: number) =>
      now < 4000 ? worldOf(now, [OUTLET], 'asleep') : worldOf(now, [REARMED], 'idle');
    const presses = pressesOf(botWith(1, 100), 1000, 8000, worldAt);
    expect(presses.map((press) => press.id)).toEqual([1]);
    expect(presses[0]?.t).toBeGreaterThan(7000);
  });

  it('draws only when it can matter: at 0 % a busy bot plays the same press as a free one', () => {
    const pressAt = (papaState: string) =>
      pressesOf(botWith(4, 0), 1000, 2800, (now) => worldOf(now, [OUTLET], papaState));
    expect(pressAt('asleep')).toEqual(pressAt('idle'));
    expect(pressAt('idle')).toHaveLength(1);
  });

  it('at 50 % some busy decisions miss and some do not, over seeds', () => {
    let answered = 0;
    for (let seed = 0; seed < 40; seed++) {
      answered += pressesOf(botWith(seed, 50), 1000, 2800, (now) =>
        worldOf(now, [OUTLET], 'asleep'),
      ).length;
    }
    expect(answered).toBeGreaterThan(8);
    expect(answered).toBeLessThan(32);
  });
});
