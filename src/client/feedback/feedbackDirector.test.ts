import type { FeedbackTable } from '@content/schemas/feedback';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim, type World } from '@sim';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../../../tests/support/testContent.ts';
import type { LevelFx } from '../render/levelScene.ts';
import { createFeedbackDirector } from './feedbackDirector.ts';

beforeAll(() => {
  log.setLevel('error');
});

const world: World = (
  await createSim({ content: createTestContent(), geometry: createTestGeometry(), seed: 1 })
).world;
world.time.sim = asSimMs(4200);

const TABLE: FeedbackTable = {
  buses: {
    music: { gainPct: 50 },
    sfx: { gainPct: 90 },
    voice: { gainPct: 80 },
    ui: { gainPct: 80 },
  },
  haptics: { light: { patternMs: [15] }, medium: { patternMs: [30] }, heavy: { patternMs: [60] } },
  loops: {
    babble: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 100, fadeMs: 80 },
    music: { clip: 'music_crawler_calm', bus: 'music', gainPct: 100, fadeMs: 400 },
  },
  cues: {
    full: {
      audio: { clip: 'papa_bump', bus: 'sfx', gainPct: 70 },
      visual: { kind: 'soundWave', anchor: 'papa', maxRadiusM: 0.6, durationMs: 350 },
      haptic: 'medium',
      camera: { kind: 'shake', amplitudeM: 0.05, durationMs: 200 },
    },
    tick: { haptic: 'light' },
    babyRing: {
      audio: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 100 },
      visual: { kind: 'soundWave', anchor: 'baby', maxRadiusM: 1, durationMs: 500 },
      haptic: 'light',
    },
  },
  events: { PapaBlocked: 'full', CountdownTicked: 'tick', BabyStateChanged: 'babyRing' },
};

function setup(options: { reducedMotion?: boolean; hasScene?: boolean } = {}) {
  const trace: string[] = [];
  const fx: LevelFx = {
    soundWave: (xM, zM, maxRadiusM, durationMs, startAt) =>
      trace.push(`wave:${xM},${zM},${maxRadiusM},${durationMs},${startAt}`),
    shake: (amplitudeM, durationMs, startAt) =>
      trace.push(`shake:${amplitudeM},${durationMs},${startAt}`),
  };
  const state = { throwOnAudio: false, throwOnHaptic: false, throwOnScene: false };
  const director = createFeedbackDirector({
    table: TABLE,
    audio: {
      playOneShot: (clip, bus, gainPct) => {
        if (state.throwOnAudio) throw new Error('speaker on fire');
        trace.push(`audio:${clip},${bus},${gainPct}`);
      },
    },
    haptics: {
      pulse: (kind) => {
        if (state.throwOnHaptic) throw new Error('motor on fire');
        trace.push(`haptic:${kind}`);
      },
    },
    getScene: () => {
      if (options.hasScene === false) return null;
      if (state.throwOnScene) {
        return {
          soundWave: () => {
            throw new Error('scene on fire');
          },
          shake: () => {
            throw new Error('scene on fire');
          },
        };
      }
      return fx;
    },
    prefersReducedMotion: () => options.reducedMotion ?? false,
    onCue: (id) => trace.push(`cue:${id}`),
  });
  const warnings = (): string[] =>
    log
      .buffer()
      .filter((entry) => entry.level === 'warn' && entry.channel === 'feedback')
      .map((entry) => entry.message);
  return { director, trace, state, warnings, before: warnings().length };
}

describe('feedbackDirector', () => {
  it('plays the audio, the haptic, the visual and the camera of a listed event, in that order, in one call', () => {
    const { director, trace } = setup();
    director.handle('PapaBlocked', world);
    expect(trace).toEqual([
      'audio:papa_bump,sfx,70',
      'haptic:medium',
      `wave:${world.papa.xM},${world.papa.zM},0.6,350,4200`,
      'shake:0.05,200,4200',
      'cue:full',
    ]);
  });

  it('starts the visual at the sim time of the world, anchored on Papa or on the baby', () => {
    const { director, trace } = setup();
    director.handle('BabyStateChanged', world);
    expect(trace).toContain(`wave:${world.baby.xM},${world.baby.zM},1,500,4200`);
  });

  it('does nothing for an event the table does not list', () => {
    const { director, trace } = setup();
    director.handle('PapaArrived', world);
    director.handle('TimeScaleChanged', null);
    expect(trace).toEqual([]);
  });

  it('plays only the haptic of a cue that has only a haptic, with no world and no scene', () => {
    const { director, trace } = setup({ hasScene: false });
    director.handle('CountdownTicked', null);
    expect(trace).toEqual(['haptic:light', 'cue:tick']);
  });

  it('still plays the audio and the haptic when there is no scene or no world', () => {
    const noScene = setup({ hasScene: false });
    noScene.director.handle('PapaBlocked', world);
    expect(noScene.trace).toEqual(['audio:papa_bump,sfx,70', 'haptic:medium', 'cue:full']);
    const noWorld = setup();
    noWorld.director.handle('PapaBlocked', null);
    expect(noWorld.trace).toEqual(['audio:papa_bump,sfx,70', 'haptic:medium', 'cue:full']);
  });

  it('skips the camera under reduced motion and keeps the rest', () => {
    const { director, trace } = setup({ reducedMotion: true });
    director.handle('PapaBlocked', world);
    expect(trace.some((line) => line.startsWith('shake:'))).toBe(false);
    expect(trace.some((line) => line.startsWith('wave:'))).toBe(true);
  });

  it('plays the other parts, and warns, when the sound cannot play', () => {
    const { director, trace, state, warnings, before } = setup();
    state.throwOnAudio = true;
    expect(() => director.handle('PapaBlocked', world)).not.toThrow();
    expect(trace).toEqual([
      'haptic:medium',
      `wave:${world.papa.xM},${world.papa.zM},0.6,350,4200`,
      'shake:0.05,200,4200',
      'cue:full',
    ]);
    expect(warnings().slice(before)).toEqual([
      expect.stringContaining('sound for PapaBlocked failed'),
    ]);
  });

  it('plays the other parts when the vibration or the scene throws', () => {
    const haptic = setup();
    haptic.state.throwOnHaptic = true;
    haptic.director.handle('PapaBlocked', world);
    expect(haptic.trace[0]).toBe('audio:papa_bump,sfx,70');
    expect(haptic.trace.some((line) => line.startsWith('wave:'))).toBe(true);

    const scene = setup();
    scene.state.throwOnScene = true;
    expect(() => scene.director.handle('PapaBlocked', world)).not.toThrow();
    expect(scene.trace).toEqual(['audio:papa_bump,sfx,70', 'haptic:medium', 'cue:full']);
  });

  it('never writes the world', () => {
    const { director } = setup();
    const before = JSON.stringify(world);
    director.handle('PapaBlocked', world);
    expect(JSON.stringify(world)).toBe(before);
  });

  it('ignores an event that points at a cue that does not exist (content:check refuses it)', () => {
    const director = createFeedbackDirector({
      table: { ...TABLE, events: { PapaBlocked: 'nope' } },
      audio: { playOneShot: () => {} },
      haptics: { pulse: () => {} },
      getScene: () => null,
      prefersReducedMotion: () => false,
    });
    expect(() => director.handle('PapaBlocked', world)).not.toThrow();
  });
});
