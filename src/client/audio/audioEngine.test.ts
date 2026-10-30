import { AUDIO_LOAD_TIMEOUT_MS, MUSIC_START_LEAD_MS } from '@shared/constants';
import { log } from '@shared/log';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeAudioContext,
  type FakeAudioContext,
} from '../../../tests/support/fakeAudioContext.ts';
import { createTestFeedback } from '../../../tests/support/testContent.ts';
import testFeel from '../../../tests/support/testFeel.json' with { type: 'json' };
import {
  type AudioEngine,
  createAudioEngine,
  type LoopName,
  type MusicMood,
} from './audioEngine.ts';
import type { AudioStateName } from './webAudio.ts';

// A spy, not `log.buffer()`: the ring buffer is capped, so an offset into it stops being valid once it is full.
const warnSpy = vi.spyOn(log, 'warn');

beforeAll(() => {
  log.setLevel('error');
});

const warnings = (): string[] =>
  warnSpy.mock.calls.filter(([channel]) => channel === 'audio').map(([, message]) => message);

const M4A = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3,
]);
const HTML = new TextEncoder().encode('<!doctype html>');
const CLIPS = [
  'baby_babble_loop',
  'music_crawler_calm',
  'music_crawler_tense',
  'music_stay_awake',
  'papa_bump',
  'ui_calibration_beep',
];
const MUSIC_FEEL = testFeel.music;

interface Setup {
  engine: AudioEngine;
  fake: FakeAudioContext;
  fetched: string[];
  states: AudioStateName[];
  counts: number[];
  loopChanges: [LoopName, boolean][];
  moodChanges: [MusicMood, boolean][];
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
  const moodChanges: [MusicMood, boolean][] = [];
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
    onMusicMoodChange: (mood, isOn) => moodChanges.push([mood, isOn]),
    getMusicFeel: () => MUSIC_FEEL,
  });
  return {
    engine,
    fake,
    fetched,
    states,
    counts,
    loopChanges,
    moodChanges,
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
    const fake = createFakeAudioContext();
    let created = 0;
    const s = setup(() => {
      created++;
      return fake;
    });
    expect(s.engine.unlock().ok).toBe(true);
    expect(s.engine.unlock().ok).toBe(true);
    expect(created).toBe(1);
    expect(fake.sources).toHaveLength(1);
  });

  describe('with the default context', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('creates an AudioContext with latencyHint "interactive"', () => {
      const fake = createFakeAudioContext();
      const received: unknown[] = [];
      vi.stubGlobal('AudioContext', function FakeConstructor(options: unknown) {
        received.push(options);
        return fake;
      });
      const engine = createAudioEngine({
        table: createTestFeedback(),
        getMusicFeel: () => MUSIC_FEEL,
      });
      expect(engine.unlock().ok).toBe(true);
      expect(received).toEqual([{ latencyHint: 'interactive' }]);
    });

    it('is an err with a warning, not a throw, when the browser has no Web Audio', () => {
      vi.stubGlobal('AudioContext', undefined);
      const engine = createAudioEngine({
        table: createTestFeedback(),
        getMusicFeel: () => MUSIC_FEEL,
      });
      const before = warnings().length;
      expect(engine.unlock()).toMatchObject({
        ok: false,
        error: { message: 'audio unlock failed: no Web Audio' },
      });
      expect(warnings().slice(before)).toEqual(['audio unlock failed: no Web Audio']);
    });
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

  it('closes the context it created when the bus graph cannot be built', () => {
    const s = setup();
    s.fake.failures.createGain = new Error('out of nodes');
    s.engine.unlock();
    expect(s.fake.calls).toContain('close');
    expect(s.fake.state).toBe('closed');
    expect(s.engine.state).toBe('none');
  });

  it('keeps no music on that closed context when the unlock fails after the music was built', async () => {
    const s = setup();
    s.fake.addEventListener = () => {
      throw new Error('no listeners');
    };
    expect(s.engine.unlock().ok).toBe(false);
    // The unlock's own silent source is already there: no stem may join it.
    const before = s.fake.sources.length;
    await s.engine.preload(CLIPS);
    s.engine.startLevelLoops();
    s.engine.setMusicMuted(true);
    s.engine.setMusicMuted(false);
    expect(s.fake.sources).toHaveLength(before);
    expect(s.loopChanges).toEqual([]);
  });

  it('warns, and does not throw, when closing that context fails too', async () => {
    const s = setup();
    s.fake.failures.createGain = new Error('out of nodes');
    s.fake.failures.close = new Error('already closed');
    expect(() => s.engine.unlock()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.newWarnings()).toContain('audio close failed: already closed');
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
    expect(s.fake.decoded).toHaveLength(CLIPS.length);
    expect(s.engine.decodedCount).toBe(CLIPS.length);
    expect(s.counts).toEqual([CLIPS.length, CLIPS.length]);
  });

  it('shares an in-flight fetch between two overlapping calls', async () => {
    await Promise.all([s.engine.preload(CLIPS), s.engine.preload(CLIPS)]);
    expect(s.fetched).toHaveLength(CLIPS.length);
  });

  it('warns and skips an HTML body, a 404 and a decode rejection, and still loads the others', async () => {
    s.answer.set('baby_babble_loop', HTML);
    s.answer.set('music_crawler_calm', new Error('HTTP 404'));
    await s.engine.preload(CLIPS);
    expect(s.engine.decodedCount).toBe(CLIPS.length - 2);
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

  it('gives up after loadTimeoutMs when a decode never settles, warns once, and resolves', async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeAudioContext();
      fake.decodeAudioData = () => new Promise(() => {});
      const hung = setup(() => fake);
      hung.engine.unlock();
      const done = vi.fn();
      const loading = hung.engine.preload(CLIPS).then(done);
      await vi.advanceTimersByTimeAsync(0);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(AUDIO_LOAD_TIMEOUT_MS);
      await loading;
      expect(done).toHaveBeenCalledOnce();
      expect(hung.newWarnings()).toEqual([expect.stringContaining('audio preload gave up after')]);
      expect(hung.engine.decodedCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours a loadTimeoutMs option and clears its timer when the clips load in time', async () => {
    vi.useFakeTimers();
    try {
      const fast = createAudioEngine({
        table: createTestFeedback(),
        createContext: () => createFakeAudioContext(),
        fetchBytes: () => Promise.resolve(M4A),
        baseUrl: './',
        loadTimeoutMs: 50,
        getMusicFeel: () => MUSIC_FEEL,
      });
      fast.unlock();
      await fast.preload(CLIPS);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

  it('plays nothing while the context is not running, so cues do not pile up', async () => {
    const s = await ready();
    const sources = s.fake.sources.length;
    for (const state of ['suspended', 'interrupted', 'closed'] as const) {
      s.fake.setState(state);
      s.engine.playOneShot('papa_bump', 'sfx', 100);
    }
    expect(s.fake.sources).toHaveLength(sources);
    expect(s.newWarnings()).toEqual([]);
    s.fake.setState('running');
    s.engine.playOneShot('papa_bump', 'sfx', 100);
    expect(s.fake.sources).toHaveLength(sources + 1);
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

describe('playOneShotAt and currentTimeS (story 2.7)', () => {
  it('reads the audio clock, and null until there is a context', async () => {
    const s = setup();
    expect(s.engine.currentTimeS).toBeNull();
    s.engine.unlock();
    s.fake.currentTime = 12.5;
    expect(s.engine.currentTimeS).toBe(12.5);
  });

  it('schedules the clip on the audio clock, through the bus gain at the cue gain', async () => {
    const s = await ready();
    const handle = s.engine.playOneShotAt('ui_calibration_beep', 'ui', 70, 3.25);
    expect(handle).not.toBeNull();
    const source = s.fake.sources.at(-1);
    const gain = s.fake.gains.at(-1);
    expect(source?.startCalls).toEqual([3.25]);
    expect(gain?.gain.value).toBe(0.7);
    expect(gain?.connections).toEqual([s.fake.gains[4]]);
    expect(source?.connections).toEqual([gain]);
  });

  it('cancels a beep that has not sounded: the source is stopped and disconnected', async () => {
    const s = await ready();
    const handle = s.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 5);
    handle?.cancel();
    const source = s.fake.sources.at(-1);
    expect(source?.stopCalls).toEqual([undefined]);
    expect(source?.isDisconnected).toBe(true);
    expect(s.fake.gains.at(-1)?.isDisconnected).toBe(true);
  });

  it('cancels once: a second cancel does nothing, and neither warns', async () => {
    const s = await ready();
    const handle = s.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 5);
    handle?.cancel();
    handle?.cancel();
    expect(s.fake.sources.at(-1)?.stopCalls).toHaveLength(1);
    expect(s.newWarnings()).toEqual([]);
  });

  it('does not throw when stopping a source that already ended', async () => {
    const s = await ready();
    const handle = s.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 5);
    // The fake throws, as a browser does, on a stop that comes before any start.
    s.fake.sources.at(-1)?.startCalls.splice(0);
    expect(() => handle?.cancel()).not.toThrow();
    expect(s.newWarnings()).toEqual([]);
  });

  it('answers null, silently, with no context, an undecoded clip, or a context not running', async () => {
    const none = setup();
    expect(none.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 1)).toBeNull();
    none.engine.unlock();
    expect(none.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 1)).toBeNull();
    const s = await ready();
    expect(s.engine.playOneShotAt('papa_bump_unknown', 'sfx', 100, 1)).toBeNull();
    const sources = s.fake.sources.length;
    for (const state of ['suspended', 'interrupted', 'closed'] as const) {
      s.fake.setState(state);
      expect(s.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 1)).toBeNull();
    }
    expect(s.fake.sources).toHaveLength(sources);
    expect(s.newWarnings()).toEqual([]);
  });

  it('warns and answers null, without throwing, when the context fails', async () => {
    const s = await ready();
    s.fake.failures.start = new Error('InvalidStateError');
    expect(s.engine.playOneShotAt('ui_calibration_beep', 'ui', 100, 1)).toBeNull();
    expect(s.newWarnings()).toEqual([
      expect.stringContaining('audio one-shot ui_calibration_beep failed: InvalidStateError'),
    ]);
  });
});

describe('the music mute of the suspicious silence (story 1.21)', () => {
  it('fades the music out on the mute and restarts it on the unmute, once per edge', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.setMusicMuted(true);
    s.engine.setMusicMuted(true);
    s.engine.setMusicMuted(true);
    expect(s.loopChanges).toEqual([
      ['music', true],
      ['music', false],
    ]);
    s.engine.setMusicMuted(false);
    s.engine.setMusicMuted(false);
    // The pair, twice: each start builds both stems, together.
    expect(s.fake.sources.length - before).toBe(4);
    expect(s.loopChanges.at(-1)).toEqual(['music', true]);
  });

  it('leaves the babble alone', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.engine.setMusicMuted(true);
    expect(s.loopChanges).toContainEqual(['babble', true]);
    expect(s.loopChanges).not.toContainEqual(['babble', false]);
  });

  it('with no level loops active, a mute starts nothing and an unmute starts nothing', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.setMusicMuted(true);
    s.engine.setMusicMuted(false);
    expect(s.fake.sources.length).toBe(before);
    expect(s.loopChanges).toEqual([]);
  });

  it('a level start unmutes: the music plays again after the loops were stopped while muted', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setMusicMuted(true);
    s.engine.stopLevelLoops();
    s.engine.startLevelLoops();
    expect(s.loopChanges.at(-1)).toEqual(['music', true]);
  });

  it('does nothing when the context is not there', () => {
    const s = setup();
    expect(() => {
      s.engine.setMusicMuted(true);
      s.engine.setMusicMuted(false);
    }).not.toThrow();
  });
});

describe('the music of a special sequence (story 4.4)', () => {
  it('plays while it is wanted, once per edge, and is faded out when it is not', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    const before = s.fake.sources.length;
    s.engine.setSequenceMusic('stay_awake');
    s.engine.setSequenceMusic('stay_awake');
    s.engine.setSequenceMusic('stay_awake');
    expect(s.fake.sources.length - before).toBe(1);
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic')).toEqual([
      ['sequenceMusic', true],
    ]);
    s.engine.setSequenceMusic(null);
    s.engine.setSequenceMusic(null);
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic')).toEqual([
      ['sequenceMusic', true],
      ['sequenceMusic', false],
    ]);
  });

  it('does not touch the level stems: the caller mutes them (setMusicMuted), the loop only plays', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    const stems = s.loopChanges.filter(([loop]) => loop === 'music');
    s.engine.setSequenceMusic('stay_awake');
    s.engine.setSequenceMusic(null);
    expect(s.loopChanges.filter(([loop]) => loop === 'music')).toEqual(stems);
  });

  it('is one looping source, started once, on a gain that fades in over its fadeMs', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    const before = s.fake.sources.length;
    const gainsBefore = s.fake.gains.length;
    s.engine.setSequenceMusic('stay_awake');
    const source = s.fake.sources[before];
    expect(source?.loop).toBe(true);
    expect(source?.startCalls).toHaveLength(1);
    // The gain it fades in: 0 now, its gain (100 %) at fadeMs (400 ms).
    expect(s.fake.gains.length - gainsBefore).toBe(1);
  });

  it('restarts clean mid-sequence: a level start clears the wanted loop, and the next frame wants none', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setSequenceMusic('stay_awake');
    // A restart: the loops stop (the wanted id is cleared), then start again for the new level.
    s.engine.stopLevelLoops();
    expect(s.loopChanges.at(-1)).not.toEqual(['sequenceMusic', true]);
    expect(s.loopChanges).toContainEqual(['sequenceMusic', false]);
    s.engine.startLevelLoops();
    const before = s.fake.sources.length;
    s.engine.setSequenceMusic(null);
    expect(s.fake.sources.length).toBe(before);
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic').length).toBe(2);
  });

  it('stops with the level when it ends mid-sequence', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setSequenceMusic('stay_awake');
    s.engine.stopLevelLoops();
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic').at(-1)).toEqual([
      'sequenceMusic',
      false,
    ]);
    // Still wanted by the next frame of a frozen level: it does not start again outside the loops.
    s.engine.setSequenceMusic('stay_awake');
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic').at(-1)).toEqual([
      'sequenceMusic',
      false,
    ]);
  });

  it('is remembered while the level loops are off and starts with them', async () => {
    const s = await ready();
    s.engine.setSequenceMusic('stay_awake');
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic')).toEqual([]);
    s.engine.startLevelLoops();
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic')).toEqual([
      ['sequenceMusic', true],
    ]);
  });

  it('skips a loop whose clip is not decoded, once, with a warning', async () => {
    const s = setup();
    s.engine.unlock();
    s.answer.set('music_stay_awake', new Error('404'));
    await s.engine.preload(CLIPS);
    s.fake.setState('running');
    s.engine.startLevelLoops();
    s.engine.setSequenceMusic('stay_awake');
    s.engine.setSequenceMusic(null);
    s.engine.setSequenceMusic('stay_awake');
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic')).toEqual([]);
    expect(s.newWarnings().filter((message) => message.includes('sequence music'))).toHaveLength(1);
  });

  it('warns once and plays nothing for an id the table does not have', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setSequenceMusic('no_such_loop');
    s.engine.setSequenceMusic(null);
    s.engine.setSequenceMusic('no_such_loop');
    expect(s.loopChanges.filter(([loop]) => loop === 'sequenceMusic')).toEqual([]);
    expect(s.newWarnings().filter((message) => message.includes('no_such_loop'))).toHaveLength(1);
  });

  it('does nothing when the context is not there', () => {
    const s = setup();
    expect(() => {
      s.engine.setSequenceMusic('stay_awake');
      s.engine.setSequenceMusic(null);
    }).not.toThrow();
  });
});

describe('level loops', () => {
  it('starts the music pair and, with a babbling baby, one babble source, however often it is asked', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    s.engine.setBabbling(true);
    s.engine.setBabbling(true);
    expect(s.fake.sources.length - before).toBe(3);
    const [calm, tense, babble] = s.fake.sources.slice(before);
    expect(calm?.loop).toBe(true);
    expect(tense?.loop).toBe(true);
    expect(babble?.loop).toBe(true);
    // One `music` change for the pair, not one per stem.
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
    // Created in this order: the music's fade gain, the calm and tense stem gains, the babble's.
    const [musicFade, , , babbleGain] = s.fake.gains.slice(-4);
    expect(musicFade?.connections).toEqual([s.fake.gains[1]]); // music bus
    expect(babbleGain?.connections).toEqual([s.fake.gains[3]]); // voice bus
    expect(musicFade?.gain.events).toEqual([
      { kind: 'set', value: 0, timeS: 2 },
      { kind: 'set', value: 0, timeS: 2 + MUSIC_START_LEAD_MS / 1000 },
      {
        kind: 'ramp',
        value: table.loops.music.gainPct / 100,
        timeS: 2 + MUSIC_START_LEAD_MS / 1000 + table.loops.music.fadeMs / 1000,
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
    const babbles = s.fake.sources.slice(before + 2);
    expect(babbles).toHaveLength(2);
    const fadeMs = createTestFeedback().loops.babble.fadeMs;
    expect(babbles[0]?.stopCalls).toEqual([5 + fadeMs / 1000]);
    expect(babbles[1]?.stopCalls).toEqual([]);
    const fadedGain = s.fake.gains.at(-2);
    expect(fadedGain?.gain.events.slice(-3)).toEqual([
      { kind: 'cancel', value: 0, timeS: 5 },
      // The fake's gain never moves (it starts at 1), so the fade starts from 1.
      { kind: 'set', value: 1, timeS: 5 },
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
    const [calm, tense, babble] = s.fake.sources.slice(before);
    const musicStopS = 1 + createTestFeedback().loops.music.fadeMs / 1000;
    expect(calm?.stopCalls).toEqual([musicStopS]);
    expect(tense?.stopCalls).toEqual([musicStopS]);
    expect(babble?.stopCalls).toEqual([1 + createTestFeedback().loops.babble.fadeMs / 1000]);
    // Frames of the old level that still say « babbling » must not restart the babble.
    s.engine.setBabbling(true);
    expect(s.fake.sources).toHaveLength(before + 3);

    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    expect(s.fake.sources).toHaveLength(before + 6);
    expect(s.loopChanges.filter(([name, isOn]) => name === 'music' && isOn)).toHaveLength(2);
  });

  it('stops a loop at once, not by a fade, when the context is not running', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.fake.setState('suspended');
    s.engine.stopLevelLoops();
    expect(s.fake.sources[before]?.stopCalls).toEqual([0]);
    expect(s.fake.sources[before + 1]?.stopCalls).toEqual([0]);
  });

  it('disconnects the nodes of a loop that has ended', async () => {
    const s = await ready();
    const before = s.fake.sources.length;
    s.engine.startLevelLoops();
    s.engine.stopLevelLoops();
    const music = s.fake.sources[before];
    music?.onended?.(undefined as never);
    expect(music?.isDisconnected).toBe(true);
    expect(s.fake.filters.at(-1)?.isDisconnected).toBe(true);
    expect(s.fake.gains.at(-3)?.isDisconnected).toBe(true); // the fade gain
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
    expect(s.newWarnings().at(-1)).toContain('audio music failed to start');
    expect(s.loopChanges).toEqual([]);
  });

  it('warns once, not every frame, when the babble cannot start, and tries again next level', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.fake.failures.createBufferSource = new Error('too many sources');
    const warned = s.newWarnings().length;
    for (let frame = 0; frame < 5; frame++) s.engine.setBabbling(true);
    expect(s.newWarnings().length - warned).toBe(1);
    expect(s.newWarnings().at(-1)).toContain('audio loop babble failed to start');

    // A new preload (the next level) lifts the skip.
    delete s.fake.failures.createBufferSource;
    await s.engine.preload(CLIPS);
    s.engine.setBabbling(true);
    expect(s.loopChanges.filter(([name, isOn]) => name === 'babble' && isOn)).toHaveLength(1);
  });

  it('disconnects the nodes of a loop that failed to start', async () => {
    const s = await ready();
    s.fake.failures.start = new Error('InvalidStateError');
    s.engine.startLevelLoops();
    expect(s.fake.sources.at(-1)?.isDisconnected).toBe(true);
    expect(s.fake.gains.at(-1)?.isDisconnected).toBe(true);
  });

  it('forgets a loop that failed to stop, silences it, and does not retry every frame', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setBabbling(true);
    const babble = s.fake.sources.at(-1);
    if (babble !== undefined) {
      babble.stop = () => {
        throw new Error('already stopped');
      };
    }
    const warned = s.newWarnings().length;
    for (let frame = 0; frame < 5; frame++) s.engine.setBabbling(false);
    expect(s.newWarnings().length - warned).toBe(1);
    expect(babble?.isDisconnected).toBe(true);
    expect(s.loopChanges.at(-1)).toEqual(['babble', false]);
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
    expect(s.newWarnings().at(-1)).toContain('audio music failed to stop');
    expect(s.loopChanges.at(-1)).toEqual(['music', false]);
  });
});

describe('the music mood (story 2.6)', () => {
  const tenseGainOf = (s: Setup) => s.fake.gains.at(-1);
  const calmGainOf = (s: Setup) => s.fake.gains.at(-2);

  it('is a no-op that is remembered before the unlock, and reaches the first start', async () => {
    const s = setup();
    expect(() => s.engine.setMusicMood(true, true)).not.toThrow();
    expect(s.moodChanges).toEqual([
      ['tense', true],
      ['slow', true],
    ]);
    s.engine.unlock();
    await s.engine.preload(CLIPS);
    s.fake.setState('running');
    s.engine.startLevelLoops();
    expect(tenseGainOf(s)?.gain.value).toBe(1);
    expect(calmGainOf(s)?.gain.value).toBe(MUSIC_FEEL.tense.calmGainPct / 100);
    expect(s.fake.filters.at(-1)?.frequency.value).toBe(MUSIC_FEEL.slowMo.lowpassHz);
    for (const source of s.fake.sources.slice(-2)) {
      expect(source.playbackRate.value).toBe(MUSIC_FEEL.slowMo.playbackRatePct / 100);
    }
  });

  it('is remembered between level loops, and applies at the restart after a mute', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setMusicMuted(true);
    s.engine.setMusicMood(true, false);
    s.engine.setMusicMuted(false);
    expect(tenseGainOf(s)?.gain.value).toBe(1);
    expect(calmGainOf(s)?.gain.value).toBe(MUSIC_FEEL.tense.calmGainPct / 100);
    expect(s.fake.filters.at(-1)?.frequency.value).toBe(20000);
  });

  it('reports one change per edge, and none for the same mood twice', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    for (let frame = 0; frame < 5; frame++) s.engine.setMusicMood(true, false);
    s.engine.setMusicMood(true, true);
    s.engine.setMusicMood(false, true);
    expect(s.moodChanges).toEqual([
      ['tense', true],
      ['slow', true],
      ['tense', false],
    ]);
  });

  it('ramps the live stems on an edge, and nothing on the same mood', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    const events = tenseGainOf(s)?.gain.events.length;
    s.engine.setMusicMood(true, false);
    expect(tenseGainOf(s)?.gain.events.length).toBeGreaterThan(events ?? 0);
    const after = tenseGainOf(s)?.gain.events.length;
    s.engine.setMusicMood(true, false);
    expect(tenseGainOf(s)?.gain.events.length).toBe(after);
  });

  it('is reset to calm by stopLevelLoops, whatever the last frame said', async () => {
    const s = await ready();
    s.engine.startLevelLoops();
    s.engine.setMusicMood(true, true);
    s.engine.stopLevelLoops();
    expect(s.moodChanges.slice(-2)).toEqual([
      ['tense', false],
      ['slow', false],
    ]);
    s.engine.startLevelLoops();
    expect(tenseGainOf(s)?.gain.value).toBe(0);
    expect(calmGainOf(s)?.gain.value).toBe(1);
    expect(s.fake.filters.at(-1)?.frequency.value).toBe(20000);
  });

  it('does not throw before the unlock or with no music playing', () => {
    const s = setup();
    expect(() => {
      s.engine.setMusicMood(true, true);
      s.engine.setMusicMood(false, false);
    }).not.toThrow();
  });
});
