import { MUSIC_FILTER_OPEN_HZ, MUSIC_START_LEAD_MS } from '@shared/constants';
import { log } from '@shared/log';
import type { ThreatState } from '@sim';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createFakeAudioContext,
  type FakeAudioContext,
  type FakeGain,
  type FakeParam,
  type FakeSource,
} from '../../../tests/support/fakeAudioContext.ts';
import { createTestFeedback } from '../../../tests/support/testContent.ts';
import testFeel from '../../../tests/support/testFeel.json' with { type: 'json' };
import {
  type AdaptiveMusic,
  createAdaptiveMusic,
  isSlowMoActive,
  isTensionActive,
  type MusicFeel,
} from './adaptiveMusic.ts';
import { createBusGraph } from './buses.ts';
import type { AudioBufferLike } from './webAudio.ts';

const warnSpy = vi.spyOn(log, 'warn');

beforeAll(() => {
  log.setLevel('error');
});

afterEach(() => {
  warnSpy.mockClear();
});

const audioWarnings = (): string[] =>
  warnSpy.mock.calls.filter(([channel]) => channel === 'audio').map(([, message]) => message);

const FEEL: MusicFeel = testFeel.music;
const DEF = createTestFeedback().loops.music;
const CALM: AudioBufferLike = { duration: 8 };

interface Rig {
  music: AdaptiveMusic;
  fake: FakeAudioContext;
  buffers: Map<string, AudioBufferLike>;
  playing: boolean[];
  feel: { current: MusicFeel };
  calmSource(): FakeSource;
  tenseSource(): FakeSource;
  /** Nodes in creation order: fade, calm stem gain, tense stem gain. */
  fade(): FakeGain;
  calmGain(): FakeGain;
  tenseGain(): FakeGain;
}

function rig(
  options: { buffers?: [string, AudioBufferLike][]; state?: 'running' | 'suspended' } = {},
): Rig {
  const fake = createFakeAudioContext({ state: options.state ?? 'running' });
  const buffers = new Map<string, AudioBufferLike>(
    options.buffers ?? [
      [DEF.stems.calm, CALM],
      [DEF.stems.tense, CALM],
    ],
  );
  const playing: boolean[] = [];
  const feel = { current: FEEL };
  const music = createAdaptiveMusic({
    context: fake,
    graph: createBusGraph(fake, createTestFeedback().buses),
    def: DEF,
    buffers,
    getFeel: () => feel.current,
    onPlayingChange: (isPlaying) => playing.push(isPlaying),
  });
  // The bus graph made 5 gains; the music's come after.
  const busGains = fake.gains.length;
  const gainAt = (index: number) => fake.gains[busGains + index] as FakeGain;
  return {
    music,
    fake,
    buffers,
    playing,
    feel,
    calmSource: () => fake.sources[0] as FakeSource,
    tenseSource: () => fake.sources[1] as FakeSource,
    fade: () => gainAt(0),
    calmGain: () => gainAt(1),
    tenseGain: () => gainAt(2),
  };
}

const rampsOf = (param: FakeParam) => param.events.filter((event) => event.kind === 'ramp');

describe('isTensionActive', () => {
  const threats = (...states: ThreatState[]) => states.map((state) => ({ state }));

  it.each<ThreatState>(['telegraph', 'windowOpen'])('is true while a threat is in %s', (state) => {
    expect(isTensionActive(threats('idle', state))).toBe(true);
  });

  it.each<ThreatState>(['idle', 'hidden', 'resolved', 'gag'])(
    'is calm for a threat in %s',
    (state) => {
      expect(isTensionActive(threats(state, state))).toBe(false);
    },
  );

  it('is calm with no threat at all', () => {
    expect(isTensionActive([])).toBe(false);
  });

  it('is true when only the last of several threats is on', () => {
    expect(isTensionActive(threats('resolved', 'gag', 'hidden', 'telegraph'))).toBe(true);
  });
});

describe('isSlowMoActive', () => {
  const world = (scale: number) => ({ time: { scale } });

  it('is on while the scale is strictly under the bound', () => {
    expect(isSlowMoActive(world(0.5), 1)).toBe(true);
    expect(isSlowMoActive(world(0.999), 1)).toBe(true);
  });

  it('is off at the bound and above', () => {
    expect(isSlowMoActive(world(1), 1)).toBe(false);
    expect(isSlowMoActive(world(0.7), 0.7)).toBe(false);
  });

  it('follows a lower bound, so that a mild slow-mo can be left out', () => {
    expect(isSlowMoActive(world(0.8), 0.7)).toBe(false);
    expect(isSlowMoActive(world(0.5), 0.7)).toBe(true);
  });
});

describe('createAdaptiveMusic, the start', () => {
  it('creates both stems, looped, started with the same `when`, strictly after now', () => {
    const r = rig();
    r.fake.currentTime = 3;
    r.music.start(false, false);
    expect(r.fake.sources).toHaveLength(2);
    const startAtS = 3 + MUSIC_START_LEAD_MS / 1000;
    expect(r.calmSource().startCalls).toEqual([startAtS]);
    expect(r.tenseSource().startCalls).toEqual([startAtS]);
    expect(startAtS).toBeGreaterThan(r.fake.currentTime);
    expect(r.calmSource().loop).toBe(true);
    expect(r.tenseSource().loop).toBe(true);
    expect(r.calmSource().buffer).toBe(r.buffers.get(DEF.stems.calm));
    expect(r.tenseSource().buffer).toBe(r.buffers.get(DEF.stems.tense));
  });

  it('wires stem → stem gain → one low-pass → one fade gain → the music bus', () => {
    const r = rig();
    r.music.start(false, false);
    const [filter] = r.fake.filters;
    expect(r.fake.filters).toHaveLength(1);
    expect(filter?.type).toBe('lowpass');
    expect(r.calmSource().connections).toEqual([r.calmGain()]);
    expect(r.tenseSource().connections).toEqual([r.tenseGain()]);
    expect(r.calmGain().connections).toEqual([filter]);
    expect(r.tenseGain().connections).toEqual([filter]);
    expect(filter?.connections).toEqual([r.fade()]);
    expect(r.fade().connections).toEqual([r.fake.gains[1]]); // the music bus
  });

  it('is calm at rest: only the calm stem audible, filter open, rate 1', () => {
    const r = rig();
    r.music.start(false, false);
    expect(r.calmGain().gain.value).toBe(1);
    expect(r.tenseGain().gain.value).toBe(0);
    expect(r.fake.filters[0]?.frequency.value).toBe(MUSIC_FILTER_OPEN_HZ);
    expect(r.calmSource().playbackRate.value).toBe(1);
    expect(r.tenseSource().playbackRate.value).toBe(1);
  });

  it('fades the whole music in to gainPct / 100 over fadeMs, from the start of the stems', () => {
    const r = rig();
    r.fake.currentTime = 2;
    r.music.start(false, false);
    expect(r.fade().gain.events).toEqual([
      { kind: 'set', value: 0, timeS: 2 },
      {
        kind: 'ramp',
        value: DEF.gainPct / 100,
        timeS: 2 + MUSIC_START_LEAD_MS / 1000 + DEF.fadeMs / 1000,
      },
    ]);
  });

  it('starts in the mood it is given, with no ramp for the stems', () => {
    const r = rig();
    r.music.start(true, true);
    expect(r.tenseGain().gain.value).toBe(1);
    expect(r.calmGain().gain.value).toBe(FEEL.tense.calmGainPct / 100);
    expect(r.fake.filters[0]?.frequency.value).toBe(FEEL.slowMo.lowpassHz);
    for (const source of [r.calmSource(), r.tenseSource()]) {
      expect(source.playbackRate.value).toBe(FEEL.slowMo.playbackRatePct / 100);
      expect(source.playbackRate.events).toEqual([]);
    }
    expect(r.tenseGain().gain.events).toEqual([]);
    expect(r.calmGain().gain.events).toEqual([]);
  });

  it('is idempotent while playing, and reports one start for the pair', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.start(false, false);
    expect(r.fake.sources).toHaveLength(2);
    expect(r.music.isPlaying).toBe(true);
    expect(r.playing).toEqual([true]);
  });
});

describe('createAdaptiveMusic, the stop', () => {
  it('fades the music out and stops both stems at the same time', () => {
    const r = rig();
    r.music.start(false, false);
    r.fake.currentTime = 5;
    r.music.stop();
    r.music.stop();
    const stopAtS = 5 + DEF.fadeMs / 1000;
    expect(r.calmSource().stopCalls).toEqual([stopAtS]);
    expect(r.tenseSource().stopCalls).toEqual([stopAtS]);
    expect(r.fade().gain.events.slice(-3)).toEqual([
      { kind: 'cancel', value: 0, timeS: 5 },
      { kind: 'set', value: 1, timeS: 5 }, // the fake's gain never moves
      { kind: 'ramp', value: 0, timeS: stopAtS },
    ]);
    expect(r.music.isPlaying).toBe(false);
    expect(r.playing).toEqual([true, false]);
  });

  it('stops both at once when the clock is frozen', () => {
    const r = rig({ state: 'suspended' });
    r.music.start(false, false);
    r.music.stop();
    expect(r.calmSource().stopCalls).toEqual([0]);
    expect(r.tenseSource().stopCalls).toEqual([0]);
  });

  it('disconnects every node once the stem has ended', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.stop();
    r.calmSource().onended?.(undefined as never);
    r.tenseSource().onended?.(undefined as never);
    for (const node of [
      r.calmSource(),
      r.tenseSource(),
      r.calmGain(),
      r.tenseGain(),
      r.fade(),
      r.fake.filters[0],
    ]) {
      expect(node?.isDisconnected).toBe(true);
    }
  });

  it('starts again from the beginning with a new pair', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.stop();
    r.music.start(true, false);
    expect(r.fake.sources).toHaveLength(4);
    expect(r.fake.sources[2]?.startCalls).toHaveLength(1);
    expect(r.fake.sources[3]?.startCalls).toEqual(r.fake.sources[2]?.startCalls);
    expect(r.playing).toEqual([true, false, true]);
  });

  it('forgets a music that failed to stop, silences it, warns once', () => {
    const r = rig();
    r.music.start(false, false);
    r.tenseSource().stop = () => {
      throw new Error('already stopped');
    };
    r.music.stop();
    r.music.stop();
    expect(audioWarnings().filter((m) => m.includes('failed to stop'))).toHaveLength(1);
    expect(r.calmSource().isDisconnected).toBe(true);
    expect(r.tenseSource().isDisconnected).toBe(true);
    expect(r.music.isPlaying).toBe(false);
  });
});

describe('createAdaptiveMusic, the guards', () => {
  it('plays the calm stem alone when the tense one is not decoded; the tension does nothing', () => {
    const r = rig({ buffers: [[DEF.stems.calm, CALM]] });
    r.music.start(false, false);
    expect(r.fake.sources).toHaveLength(1);
    expect(r.music.isPlaying).toBe(true);
    const events = r.calmGain().gain.events.length;
    r.music.applyMood(true, false);
    expect(r.calmGain().gain.events).toHaveLength(events);
    expect(audioWarnings()).toEqual([]);
  });

  it('starts a lone calm stem in a tense mood with no ducking', () => {
    const r = rig({ buffers: [[DEF.stems.calm, CALM]] });
    r.music.start(true, false);
    expect(r.calmGain().gain.value).toBe(1);
  });

  it('plays nothing when the calm stem is missing, once, with no new warning', () => {
    const r = rig({ buffers: [[DEF.stems.tense, CALM]] });
    for (let frame = 0; frame < 5; frame++) r.music.start(false, false);
    expect(r.fake.sources).toHaveLength(0);
    expect(r.music.isPlaying).toBe(false);
    expect(r.playing).toEqual([]);
    expect(audioWarnings()).toEqual([]);
  });

  it('tries again after clearSkipped, once the stem is decoded', () => {
    const r = rig({ buffers: [] });
    r.music.start(false, false);
    r.buffers.set(DEF.stems.calm, CALM);
    r.music.start(false, false);
    expect(r.fake.sources).toHaveLength(0);
    r.music.clearSkipped();
    r.music.start(false, false);
    expect(r.fake.sources).toHaveLength(1);
  });

  it('warns once when the stems differ in length by more than a couple of ms, and plays anyway', () => {
    const r = rig({
      buffers: [
        [DEF.stems.calm, { duration: 8 }],
        [DEF.stems.tense, { duration: 8.05 }],
      ],
    });
    r.music.start(false, false);
    r.music.stop();
    r.music.start(false, false);
    expect(audioWarnings()).toEqual(['music stems differ in length: they will drift']);
    expect(r.music.isPlaying).toBe(true);
  });

  it('accepts a difference within the tolerance', () => {
    const r = rig({
      buffers: [
        [DEF.stems.calm, { duration: 8 }],
        [DEF.stems.tense, { duration: 8.001 }],
      ],
    });
    r.music.start(false, false);
    expect(audioWarnings()).toEqual([]);
  });

  it('skips the music for the level with one warning when a node throws, and does not throw', () => {
    const r = rig();
    r.fake.failures.createBiquadFilter = new Error('no filter');
    expect(() => {
      for (let frame = 0; frame < 5; frame++) r.music.start(false, false);
    }).not.toThrow();
    expect(audioWarnings()).toEqual(['audio music failed to start: no filter']);
    expect(r.music.isPlaying).toBe(false);
    expect(r.playing).toEqual([]);
  });

  it('stops a stem already started and disconnects everything when the second start throws', () => {
    const r = rig();
    const original = r.fake.createBufferSource.bind(r.fake);
    let created = 0;
    r.fake.createBufferSource = () => {
      const source = original();
      created += 1;
      if (created === 2) {
        source.start = () => {
          throw new Error('InvalidStateError');
        };
      }
      return source;
    };
    expect(() => r.music.start(false, false)).not.toThrow();
    expect(audioWarnings()).toEqual(['audio music failed to start: InvalidStateError']);
    // The calm stem had started: it is told to stop at once and nothing is left connected.
    expect(r.calmSource().stopCalls).toEqual([0]);
    for (const node of [r.calmSource(), r.tenseSource(), r.calmGain(), r.tenseGain(), r.fade()]) {
      expect(node.isDisconnected).toBe(true);
    }
    expect(r.music.isPlaying).toBe(false);
  });
});

describe('createAdaptiveMusic, the tension', () => {
  it('ramps the tense gain to 1 and ducks the calm one over fadeInMs', () => {
    const r = rig();
    r.music.start(false, false);
    r.fake.currentTime = 10;
    r.music.applyMood(true, false);
    const arriveS = 10 + FEEL.tense.fadeInMs / 1000;
    expect(r.tenseGain().gain.events).toEqual([
      { kind: 'cancel', value: 0, timeS: 10 },
      { kind: 'set', value: 0, timeS: 10 }, // from the current value: silent at rest
      { kind: 'ramp', value: 1, timeS: arriveS },
    ]);
    expect(r.calmGain().gain.events.at(-1)).toEqual({
      kind: 'ramp',
      value: FEEL.tense.calmGainPct / 100,
      timeS: arriveS,
    });
  });

  it('ramps back over fadeOutMs when no threat is on any more', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(true, false);
    r.fake.currentTime = 20;
    r.music.applyMood(false, false);
    const arriveS = 20 + FEEL.tense.fadeOutMs / 1000;
    expect(r.tenseGain().gain.events.at(-1)).toEqual({ kind: 'ramp', value: 0, timeS: arriveS });
    expect(r.calmGain().gain.events.at(-1)).toEqual({ kind: 'ramp', value: 1, timeS: arriveS });
  });

  it('starts a change mid-ramp from the current value', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(true, false);
    // Half-way up: the gain is where the ramp has taken it.
    r.tenseGain().gain.value = 0.5;
    r.fake.currentTime = 0.3;
    r.music.applyMood(false, false);
    expect(r.tenseGain().gain.events.slice(-3)).toEqual([
      { kind: 'cancel', value: 0, timeS: 0.3 },
      { kind: 'set', value: 0.5, timeS: 0.3 },
      { kind: 'ramp', value: 0, timeS: 0.3 + FEEL.tense.fadeOutMs / 1000 },
    ]);
  });

  it('schedules nothing for the same mood twice', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(true, false);
    const count = r.tenseGain().gain.events.length;
    r.music.applyMood(true, false);
    r.music.applyMood(true, false);
    expect(r.tenseGain().gain.events).toHaveLength(count);
    expect(r.fake.filters[0]?.frequency.events).toEqual([]);
  });

  it('sets the value at once when the duration is 0', () => {
    const r = rig();
    r.feel.current = { ...FEEL, tense: { ...FEEL.tense, fadeInMs: 0 } };
    r.music.start(false, false);
    r.fake.currentTime = 4;
    r.music.applyMood(true, false);
    expect(r.tenseGain().gain.events).toEqual([
      { kind: 'cancel', value: 0, timeS: 4 },
      { kind: 'set', value: 1, timeS: 4 },
    ]);
  });

  it('reads the feel at each transition, not once', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(true, false);
    r.feel.current = { ...FEEL, tense: { ...FEEL.tense, fadeOutMs: 4321 } };
    r.fake.currentTime = 7;
    r.music.applyMood(false, false);
    expect(r.tenseGain().gain.events.at(-1)).toEqual({ kind: 'ramp', value: 0, timeS: 7 + 4.321 });
  });

  it('does nothing when the music is not playing', () => {
    const r = rig();
    expect(() => r.music.applyMood(true, true)).not.toThrow();
    r.music.start(false, false);
    r.music.stop();
    expect(() => r.music.applyMood(true, true)).not.toThrow();
  });

  it('warns and goes on when a ramp throws', () => {
    const r = rig();
    r.music.start(false, false);
    r.tenseGain().gain.cancelScheduledValues = () => {
      throw new Error('bad param');
    };
    expect(() => r.music.applyMood(true, false)).not.toThrow();
    expect(audioWarnings()).toEqual(['audio music mood failed: bad param']);
  });
});

describe('createAdaptiveMusic, the slow-mo', () => {
  it('sweeps the filter and both rates together over inMs', () => {
    const r = rig();
    r.music.start(false, false);
    r.fake.currentTime = 6;
    r.music.applyMood(false, true);
    const arriveS = 6 + FEEL.slowMo.inMs / 1000;
    expect(rampsOf(r.fake.filters[0]?.frequency as FakeParam)).toEqual([
      { kind: 'ramp', value: FEEL.slowMo.lowpassHz, timeS: arriveS },
    ]);
    for (const source of [r.calmSource(), r.tenseSource()]) {
      expect(rampsOf(source.playbackRate)).toEqual([
        { kind: 'ramp', value: FEEL.slowMo.playbackRatePct / 100, timeS: arriveS },
      ]);
    }
  });

  it('sweeps back, open and at rate 1, over outMs', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(false, true);
    r.fake.currentTime = 9;
    r.music.applyMood(false, false);
    const arriveS = 9 + FEEL.slowMo.outMs / 1000;
    expect(rampsOf(r.fake.filters[0]?.frequency as FakeParam).at(-1)).toEqual({
      kind: 'ramp',
      value: MUSIC_FILTER_OPEN_HZ,
      timeS: arriveS,
    });
    for (const source of [r.calmSource(), r.tenseSource()]) {
      expect(rampsOf(source.playbackRate).at(-1)).toEqual({
        kind: 'ramp',
        value: 1,
        timeS: arriveS,
      });
    }
  });

  it('gives both stems identical rate events, always', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(true, true);
    r.fake.currentTime = 1;
    r.music.applyMood(true, false);
    r.fake.currentTime = 2;
    r.music.applyMood(false, true);
    expect(r.calmSource().playbackRate.events.length).toBeGreaterThan(0);
    expect(r.calmSource().playbackRate.events).toEqual(r.tenseSource().playbackRate.events);
  });

  it('is independent of the tension', () => {
    const r = rig();
    r.music.start(false, false);
    r.music.applyMood(true, false);
    expect(r.fake.filters[0]?.frequency.events).toEqual([]);
    r.music.applyMood(true, true);
    expect(rampsOf(r.fake.filters[0]?.frequency as FakeParam)).toHaveLength(1);
    // The tension was not touched by the slow-mo edge.
    expect(rampsOf(r.tenseGain().gain)).toHaveLength(1);
  });

  it('still slows the calm stem when the tense one is missing', () => {
    const r = rig({ buffers: [[DEF.stems.calm, CALM]] });
    r.music.start(false, false);
    r.music.applyMood(false, true);
    expect(rampsOf(r.calmSource().playbackRate)).toHaveLength(1);
  });
});
