import { log } from '@shared/log';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeAudioContext,
  type FakeAudioContext,
} from '../../../tests/support/fakeAudioContext.ts';
import { createTestFeedback } from '../../../tests/support/testContent.ts';
import { type AudioEngine, createAudioEngine, type LoopName } from './audioEngine.ts';
import type { AudioStateName } from './webAudio.ts';

beforeAll(() => {
  log.setLevel('error');
});

const warnings = (): string[] =>
  log
    .buffer()
    .filter((entry) => entry.level === 'warn' && entry.channel === 'audio')
    .map((entry) => entry.message);

const M4A = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3,
]);
const HTML = new TextEncoder().encode('<!doctype html>');
const CLIPS = ['baby_babble_loop', 'music_crawler_calm', 'papa_bump'];

interface Setup {
  engine: AudioEngine;
  fake: FakeAudioContext;
  fetched: string[];
  states: AudioStateName[];
  counts: number[];
  loopChanges: [LoopName, boolean][];
  /** Warnings logged since the setup. */
  newWarnings(): string[];
  /** Overrides what the fake network answers for a clip: bytes, or an Error to reject with. */
  answer: Map<string, Uint8Array | Error>;
}

function setup(createContext?: () => FakeAudioContext): Setup {
  const fake = createFakeAudioContext();
  const fetched: string[] = [];
  const answer = new Map<string, Uint8Array | Error>();
  const states: AudioStateName[] = [];
  const counts: number[] = [];
  const loopChanges: [LoopName, boolean][] = [];
  const before = warnings().length;
  const contexts: string[] = [];
  const engine = createAudioEngine({
    table: createTestFeedback(),
    createContext:
      createContext ??
      (() => {
        contexts.push('created');
        return fake;
      }),
    fetchBytes: (url) => {
      fetched.push(url);
      const clip = /\/([^/]+)\.m4a$/.exec(url)?.[1] ?? '';
      const reply = answer.get(clip) ?? M4A;
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
    baseUrl: './',
    onStateChange: (state) => states.push(state),
    onClipsDecoded: (count) => counts.push(count),
    onLoopChange: (loop, isOn) => loopChanges.push([loop, isOn]),
  });
  return {
    engine,
    fake,
    fetched,
    states,
    counts,
    loopChanges,
    answer,
    newWarnings: () => warnings().slice(before),
  };
}

/** An unlocked engine with every clip decoded and the context running. */
async function ready(): Promise<Setup> {
  const s = setup();
  s.engine.unlock();
  await s.engine.preload(CLIPS);
  s.fake.setState('running');
  s.fake.calls.length = 0;
  return s;
}

describe('unlock', () => {
  it('creates one context, resumes it, starts a silent buffer, and reports the states', () => {
    const s = setup();
    expect(s.engine.state).toBe('none');
    expect(s.engine.unlock()).toMatchObject({ ok: true });
    expect(s.fake.calls).toContain('resume');
    expect(s.fake.buffers).toHaveLength(1);
    expect(s.fake.sources[0]?.startCalls).toEqual([0]);
    expect(s.engine.state).toBe('running');
    expect(s.states.at(-1)).toBe('running');
  });

  it('builds four buses from the table into one master', () => {
    const s = setup();
    s.engine.unlock();
    const table = createTestFeedback();
    // master, then music, sfx, voice, ui, in that order
    expect(s.fake.gains.map((gain) => gain.gain.value)).toEqual([
      1,
      table.buses.music.gainPct / 100,
      table.buses.sfx.gainPct / 100,
      table.buses.voice.gainPct / 100,
      table.buses.ui.gainPct / 100,
    ]);
    expect(s.fake.gains[0]?.connections).toEqual([s.fake.destination]);
    for (const bus of s.fake.gains.slice(1)) expect(bus.connections).toEqual([s.fake.gains[0]]);
  });

  it('is idempotent: a second call does nothing and returns ok', () => {
    const s = setup();
    let created = 0;
    const engine = createAudioEngine({
      table: createTestFeedback(),
      createContext: () => {
        created++;
        return s.fake;
      },
    });
    expect(engine.unlock().ok).toBe(true);
    expect(engine.unlock().ok).toBe(true);
    expect(created).toBe(1);
    expect(s.fake.sources).toHaveLength(1);
  });

  it('follows the context state (suspended, interrupted, running)', () => {
    const s = setup();
    s.engine.unlock();
    s.fake.setState('interrupted');
    s.fake.setState('running');
    expect(s.states.slice(-2)).toEqual(['interrupted', 'running']);
    expect(s.engine.state).toBe('running');
  });

  it('is an err with a warning when the constructor throws, then everything is a no-op', async () => {
    const s = setup(() => {
      throw new Error('no Web Audio');
    });
    const result = s.engine.unlock();
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'audio unlock failed: no Web Audio' },
    });
    expect(s.newWarnings()).toEqual(['audio unlock failed: no Web Audio']);
    // Later calls neither throw nor warn again (but a preload says once that it is skipped).
    expect(s.engine.unlock().ok).toBe(false);
    s.engine.suspend();
    s.engine.resume();
    s.engine.playOneShot('papa_bump', 'sfx', 100);
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.engine.stopLevelLoops();
    await s.engine.preload(CLIPS);
    await s.engine.preload(CLIPS);
    expect(s.newWarnings()).toEqual([
      'audio unlock failed: no Web Audio',
      'audio preload skipped: no audio context, the game is silent',
    ]);
    expect(s.engine.state).toBe('none');
  });

  it('is an err when the bus graph cannot be built', () => {
    const s = setup();
    s.fake.failures.createGain = new Error('out of nodes');
    expect(s.engine.unlock().ok).toBe(false);
    expect(s.newWarnings()).toEqual(['audio unlock failed: out of nodes']);
  });
});

describe('suspend and resume', () => {
  it('call through to the context', () => {
    const s = setup();
    s.engine.unlock();
    s.engine.suspend();
    expect(s.fake.state).toBe('suspended');
    s.engine.resume();
    expect(s.fake.state).toBe('running');
  });

  it('are harmless twice in a row', () => {
    const s = setup();
    s.engine.unlock();
    s.engine.suspend();
    s.engine.suspend();
    s.engine.resume();
    s.engine.resume();
    expect(s.fake.state).toBe('running');
    expect(s.newWarnings()).toEqual([]);
  });

  it('do nothing on a closed context', () => {
    const s = setup();
    s.engine.unlock();
    s.fake.state = 'closed';
    s.fake.calls.length = 0;
    s.engine.suspend();
    s.engine.resume();
    expect(s.fake.calls).toEqual([]);
  });

  it('warn, never throw, on a rejection', async () => {
    const s = setup();
    s.engine.unlock();
    s.fake.failures.suspend = new Error('boom suspend');
    s.fake.failures.resume = new Error('boom resume');
    expect(() => s.engine.suspend()).not.toThrow();
    expect(() => s.engine.resume()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.newWarnings()).toEqual(
      expect.arrayContaining([
        'audio suspend failed: boom suspend',
        'audio resume failed: boom resume',
      ]),
    );
  });
});

describe('preload', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
    s.engine.unlock();
  });

  it('fetches and decodes each clip once, across two calls', async () => {
    await s.engine.preload(CLIPS);
    await s.engine.preload(CLIPS);
    expect(s.fetched).toEqual(CLIPS.map((clip) => `./assets/audio/${clip}.m4a`));
    expect(s.fake.decoded).toHaveLength(3);
    expect(s.engine.decodedCount).toBe(3);
    expect(s.counts).toEqual([3, 3]);
  });

  it('shares an in-flight fetch between two overlapping calls', async () => {
    await Promise.all([s.engine.preload(CLIPS), s.engine.preload(CLIPS)]);
    expect(s.fetched).toHaveLength(3);
  });

  it('warns and skips an HTML body, a 404 and a decode rejection, and still loads the others', async () => {
    s.answer.set('baby_babble_loop', HTML);
    s.answer.set('music_crawler_calm', new Error('HTTP 404'));
    await s.engine.preload(CLIPS);
    expect(s.engine.decodedCount).toBe(1);
    expect(s.newWarnings()).toEqual([
      expect.stringMatching(/^audio clip baby_babble_loop unavailable: .*not an MP4/),
      expect.stringMatching(/^audio clip music_crawler_calm unavailable: .*HTTP 404/),
    ]);

    s.fake.failures.decode = new Error('EncodingError');
    s.answer.delete('baby_babble_loop');
    await s.engine.preload(CLIPS);
    expect(s.newWarnings().at(-1)).toMatch(
      /^audio clip baby_babble_loop unavailable: .*EncodingError/,
    );
  });

  it('never rejects, even when the clips list is empty', async () => {
    await expect(s.engine.preload([])).resolves.toBeUndefined();
  });

  it('retries a clip that failed at the next preload', async () => {
    s.answer.set('papa_bump', new Error('HTTP 503'));
    await s.engine.preload(['papa_bump']);
    s.answer.delete('papa_bump');
    await s.engine.preload(['papa_bump']);
    expect(s.engine.decodedCount).toBe(1);
  });
});

describe('playOneShot', () => {
  it('plays a decoded clip through the bus gain at the cue gain', async () => {
    const s = await ready();
    s.engine.playOneShot('papa_bump', 'sfx', 50);
    const source = s.fake.sources.at(-1);
    const gain = s.fake.gains.at(-1);
    expect(source?.startCalls).toEqual([0]);
    expect(gain?.gain.value).toBe(0.5);
    const sfxBus = s.fake.gains[2];
    expect(gain?.connections).toEqual([sfxBus]);
    expect(source?.connections).toEqual([gain]);
  });

  it('routes each bus to its own gain', async () => {
    const s = await ready();
    s.engine.playOneShot('papa_bump', 'voice', 100);
    expect(s.fake.gains.at(-1)?.connections).toEqual([s.fake.gains[3]]);
  });

  it('disconnects its nodes when it ends', async () => {
    const s = await ready();
    s.engine.playOneShot('papa_bump', 'sfx', 100);
    const source = s.fake.sources.at(-1);
    source?.onended?.(undefined as never);
    expect(source?.isDisconnected).toBe(true);
    expect(s.fake.gains.at(-1)?.isDisconnected).toBe(true);
  });

  it('does nothing for a clip that is not decoded', async () => {
    const s = setup();
    s.engine.unlock();
    const sources = s.fake.sources.length;
    s.engine.playOneShot('papa_bump', 'sfx', 100);
    expect(s.fake.sources).toHaveLength(sources);
    expect(s.newWarnings()).toEqual([]);
  });

  it('warns, and does not throw, when the context fails', async () => {
    const s = await ready();
    s.fake.failures.start = new Error('InvalidStateError');
    expect(() => s.engine.playOneShot('papa_bump', 'sfx', 100)).not.toThrow();
    expect(s.newWarnings()).toEqual([
      expect.stringContaining('audio one-shot papa_bump failed: InvalidStateError'),
    ]);
  });
});

describe('level loops', () => {
  it('starts one music source and, with a babbling baby, one babble source, however often it is asked', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.engine.setBabbling(true);
    s.engine.setBabbling(true);
    expect(s.fake.sources.length - before).toBe(2);
    const [music, babble] = s.fake.sources.slice(before);
    expect(music?.loop).toBe(true);
    expect(babble?.loop).toBe(true);
    expect(s.loopChanges).toEqual([
      ['music', true],
      ['babble', true],
    ]);
  });

  it('puts each loop on its own bus, fading in over fadeMs to its gain', async () => {
    const s = await ready();
    const table = createTestFeedback();
    s.fake.currentTime = 2;
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    const [musicGain, babbleGain] = s.fake.gains.slice(-2);
    expect(musicGain?.connections).toEqual([s.fake.gains[1]]); // music bus
    expect(babbleGain?.connections).toEqual([s.fake.gains[3]]); // voice bus
    expect(musicGain?.gain.events).toEqual([
      { kind: 'set', value: 0, timeS: 2 },
      {
        kind: 'ramp',
        value: table.loops.music.gainPct / 100,
        timeS: 2 + table.loops.music.fadeMs / 1000,
      },
    ]);
  });

  it('babble on, off, on gives two sources and one fade-out', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.fake.currentTime = 5;
    s.engine.setBabbling(false);
    s.engine.setBabbling(false);
    s.engine.setBabbling(true);
    const babbles = s.fake.sources.slice(before + 1);
    expect(babbles).toHaveLength(2);
    const fadeMs = createTestFeedback().loops.babble.fadeMs;
    expect(babbles[0]?.stopCalls).toEqual([5 + fadeMs / 1000]);
    expect(babbles[1]?.stopCalls).toEqual([]);
    const fadedGain = s.fake.gains.at(-2);
    expect(fadedGain?.gain.events.slice(-3)).toEqual([
      { kind: 'cancel', value: 0, timeS: 5 },
      { kind: 'set', value: fadedGain?.gain.value, timeS: 5 },
      { kind: 'ramp', value: 0, timeS: 5 + fadeMs / 1000 },
    ]);
  });

  it('stopLevelLoops fades both out, then stops them, and a new level starts one pair again', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.fake.currentTime = 1;
    s.engine.stopLevelLoops();
    s.engine.stopLevelLoops();
    const [music, babble] = s.fake.sources.slice(before);
    expect(music?.stopCalls).toEqual([1 + createTestFeedback().loops.music.fadeMs / 1000]);
    expect(babble?.stopCalls).toEqual([1 + createTestFeedback().loops.babble.fadeMs / 1000]);
    // Frames of the old level that still say « babbling » must not restart the babble.
    s.engine.setBabbling(true);
    expect(s.fake.sources).toHaveLength(before + 2);

    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    expect(s.fake.sources).toHaveLength(before + 4);
    expect(s.loopChanges.filter(([name, isOn]) => name === 'music' && isOn)).toHaveLength(2);
  });

  it('stops a loop at once, not by a fade, when the context is not running', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.fake.setState('suspended');
    s.engine.stopLevelLoops();
    expect(s.fake.sources[before]?.stopCalls).toEqual([0]);
  });

  it('disconnects the nodes of a loop that has ended', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.stopLevelLoops();
    const music = s.fake.sources[before];
    music?.onended?.(undefined as never);
    expect(music?.isDisconnected).toBe(true);
  });

  it('does not babble outside a level', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.setBabbling(true);
    expect(s.fake.sources).toHaveLength(before);
  });

  it('skips a loop whose clip is not decoded, once, with no new warning', async () => {
    const s = setup();
    s.engine.unlock();
    s.answer.set('music_crawler_calm', new Error('HTTP 404'));
    await s.engine.preload(CLIPS);
    const warned = s.newWarnings().length;
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.engine.setBabbling(true);
    expect(s.fake.sources.length - before).toBe(1); // the babble only
    expect(s.newWarnings()).toHaveLength(warned);
  });

  it('warns and goes on when the context fails to start a loop', async () => {
    const s = await ready();
    s.fake.failures.createBufferSource = new Error('too many sources');
    expect(() => s.engine.startLevelLoops()).not.toThrow();
    expect(s.newWarnings().at(-1)).toContain('audio loop music failed to start');
    expect(s.loopChanges).toEqual([]);
  });

  it('warns and goes on when a loop fails to stop', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    const music = s.fake.sources.at(-1);
    if (music !== undefined) {
      music.stop = () => {
        throw new Error('already stopped');
      };
    }
    expect(() => s.engine.stopLevelLoops()).not.toThrow();
    expect(s.newWarnings().at(-1)).toContain('audio loop music failed to stop');
  });
});
