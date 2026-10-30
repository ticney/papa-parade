import type { Bot, BotId } from '@bots/bot';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { SimCommand, World } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, makeBot } from '../support/botSupport.ts';

// The bots in a lullaby walk (story 4.5, AC 19): they read `world.sequence.beat` through `@sim`,
// never the content. A fake world is enough: the bots only read the slice and the clock.
function worldAt(
  now: number,
  beat: { isRunning?: boolean; nextBeatAt?: number | null } = {},
): Readonly<World> {
  return {
    time: { sim: asSimMs(now) },
    threats: [],
    silence: { threatId: null, zoneEnteredAt: null, startedAt: null },
    papa: { xM: 0, zM: 0 },
    sequence: {
      beat: { isRunning: beat.isRunning ?? true, nextBeatAt: beat.nextBeatAt ?? null },
    },
  } as unknown as Readonly<World>;
}

const SETTINGS = {
  human: { reactionMs: 250, aimOffsetMs: 0, jitterSdMs: 60 },
  random: { actionsPerSec: 2, floorReachM: 3, maxHoldMs: 800 },
};

function bot(id: BotId, seed = 1): Bot {
  return makeBot(id, botSetup(seed, SETTINGS));
}

/** Steps a bot over `[fromMs, untilMs)` with the beat in play given by `beatAt(now)`; returns its commands. */
function drive(
  who: Bot,
  fromMs: number,
  untilMs: number,
  beatAt: (now: number) => number | null,
): SimCommand[] {
  const all: SimCommand[] = [];
  for (let now = fromMs; now < untilMs; now += STEP_MS) {
    const out: SimCommand[] = [];
    const nextBeatAt = beatAt(now);
    who.act(worldAt(now, { isRunning: nextBeatAt !== null, nextBeatAt }), out);
    all.push(...out);
  }
  return all;
}

describe('the perfect bot in a beats step', () => {
  it('taps each judged beat dead on, once, in whole ms', () => {
    // Beats every 700 ms: the beat in play moves on when the previous one has passed.
    const beatAt = (now: number) => 5000 + Math.floor(Math.max(0, now - 4900) / 700) * 700 + 0.4;
    const commands = drive(bot('perfect'), 4000, 8000, beatAt);
    const taps = commands.filter((c) => c.type === 'TapBeat');
    expect(taps.map((c) => c.t)).toEqual([5000, 5700, 6400, 7100, 7800]);
    expect(commands.every((c) => c.type === 'TapBeat')).toBe(true);
  });

  it('taps nothing outside a beats step, and a beat that is already late at once', () => {
    expect(drive(bot('perfect'), 0, 1000, () => null)).toEqual([]);
    const late = drive(bot('perfect'), 5100, 5200, () => 5000);
    expect(late.map((c) => c.t)).toEqual([5100]);
  });

  it('taps a beat only once however many steps it stays in play', () => {
    const commands = drive(bot('perfect'), 4000, 5600, () => 5000);
    expect(commands.filter((c) => c.type === 'TapBeat')).toHaveLength(1);
  });
});

describe('the human bot in a beats step', () => {
  it('plans one tap per beat around it, with no reaction floor, and sends it once', () => {
    const who = bot('human', 7);
    const commands = drive(who, 4000, 6000, () => 5000);
    const taps = commands.filter((c) => c.type === 'TapBeat');
    expect(taps).toHaveLength(1);
    // Within a few sd of the beat (sd 60): nowhere near `telegraph + reactionMs`.
    expect(Math.abs((taps[0]?.t ?? 0) - 5000)).toBeLessThan(300);
  });

  it('drops the plan of a beat that is settled before the tap is sent', () => {
    const who = bot('human', 7);
    // The beat in play is 9000, planned at 4000; at 4010 it has moved on to 9700: the tap for 9000 is
    // dropped, and the next one is planned for 9700.
    const out: SimCommand[] = [];
    who.act(worldAt(4000, { nextBeatAt: 9000 }), out);
    expect(out).toEqual([]);
    who.act(worldAt(4010, { nextBeatAt: 9700 }), out);
    const later = drive(who, 4020, 11_000, () => 9700);
    const times = [...out, ...later].filter((c) => c.type === 'TapBeat').map((c) => c.t);
    expect(times).toHaveLength(1);
    expect(Math.abs((times[0] ?? 0) - 9700)).toBeLessThan(300);
  });

  it('is deterministic per seed and varies with it', () => {
    const a = drive(bot('human', 3), 4000, 6000, () => 5000);
    const b = drive(bot('human', 3), 4000, 6000, () => 5000);
    const c = drive(bot('human', 4), 4000, 6000, () => 5000);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('the random bot in a beats step', () => {
  it('taps at its rate and does nothing else', () => {
    const commands = drive(bot('random', 2), 0, 60_000, () => 1);
    const taps = commands.filter((c) => c.type === 'TapBeat');
    // 2 actions per second over 60 s: about 120, whatever the seed.
    expect(taps.length).toBeGreaterThan(60);
    expect(taps.length).toBeLessThan(180);
    expect(commands).toHaveLength(taps.length);
  });

  it('acts as it always did outside a beats step: the usual actions, no tap to the beat', () => {
    // The proof that its draws did not move is the CLI table of the story (the salon's report with
    // and without this story, identical for all four bots); here, that the branch stays out of the way.
    const plain = drive(bot('random', 5), 0, 20_000, () => null);
    expect(plain).toEqual(drive(bot('random', 5), 0, 20_000, () => null));
    expect(plain.some((c) => c.type === 'TapFloor' || c.type === 'Move')).toBe(true);
    expect(plain.some((c) => c.type === 'TapBeat')).toBe(false);
  });
});

describe('the idle bot in a beats step', () => {
  it('taps nothing: the misses wake the baby', () => {
    expect(drive(bot('idle'), 0, 5000, () => 3000)).toEqual([]);
  });
});
