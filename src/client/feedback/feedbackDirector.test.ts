import type { FeedbackTable } from '@content/schemas/feedback';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim, type World } from '@sim';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import type { LevelFx } from '../render/levelScene.ts';
import { createFeedbackDirector } from './feedbackDirector.ts';

beforeAll(() => {
  log.setLevel('error');
});

// A spy, not `log.buffer()`: the ring buffer is capped, so an offset into it stops being valid once full.
const warnSpy = vi.spyOn(log, 'warn');

const world: World = (
  await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel(),
    seed: 1,
  })
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
  const state = {
    throwOnAudio: false,
    throwOnHaptic: false,
    throwOnScene: false,
    throwOnGetScene: false,
    throwOnMotionQuery: false,
    throwOnCue: false,
  };
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
      if (state.throwOnGetScene) throw new Error('no scene today');
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
    prefersReducedMotion: () => {
      if (state.throwOnMotionQuery) throw new Error('no matchMedia');
      return options.reducedMotion ?? false;
    },
    onCue: (id) => {
      if (state.throwOnCue) throw new Error('mirror on fire');
      trace.push(`cue:${id}`);
    },
  });
  const warnings = (): string[] =>
    warnSpy.mock.calls.filter(([channel]) => channel === 'feedback').map(([, message]) => message);
  const start = warnings().length;
  return { director, trace, state, newWarnings: () => warnings().slice(start) };
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
    const { director, trace, state, newWarnings } = setup();
    state.throwOnAudio = true;
    expect(() => director.handle('PapaBlocked', world)).not.toThrow();
    expect(trace).toEqual([
      'haptic:medium',
      `wave:${world.papa.xM},${world.papa.zM},0.6,350,4200`,
      'shake:0.05,200,4200',
      'cue:full',
    ]);
    expect(newWarnings()).toEqual([expect.stringContaining('sound for PapaBlocked failed')]);
  });

  it('plays the other parts, and warns, when the vibration or the scene throws', () => {
    const haptic = setup();
    haptic.state.throwOnHaptic = true;
    haptic.director.handle('PapaBlocked', world);
    expect(haptic.trace[0]).toBe('audio:papa_bump,sfx,70');
    expect(haptic.trace.some((line) => line.startsWith('wave:'))).toBe(true);
    expect(haptic.newWarnings()).toEqual([
      expect.stringContaining('vibration for PapaBlocked failed'),
    ]);

    const scene = setup();
    scene.state.throwOnScene = true;
    expect(() => scene.director.handle('PapaBlocked', world)).not.toThrow();
    expect(scene.trace).toEqual(['audio:papa_bump,sfx,70', 'haptic:medium', 'cue:full']);
    expect(scene.newWarnings()).toEqual([
      expect.stringContaining('ring for PapaBlocked failed'),
      expect.stringContaining('camera effect for PapaBlocked failed'),
    ]);
  });

  it('never throws into the frame loop: a failing scene lookup, motion query or cue report is a warning', () => {
    const lookup = setup();
    lookup.state.throwOnGetScene = true;
    expect(() => lookup.director.handle('PapaBlocked', world)).not.toThrow();
    expect(lookup.trace).toEqual(['audio:papa_bump,sfx,70', 'haptic:medium', 'cue:full']);
    expect(lookup.newWarnings()).toEqual([expect.stringContaining('scene lookup')]);

    // A motion query that fails counts as reduced motion: no shake, the ring still plays.
    const motion = setup();
    motion.state.throwOnMotionQuery = true;
    expect(() => motion.director.handle('PapaBlocked', world)).not.toThrow();
    expect(motion.trace.some((line) => line.startsWith('shake:'))).toBe(false);
    expect(motion.trace.some((line) => line.startsWith('wave:'))).toBe(true);
    expect(motion.newWarnings()).toEqual([expect.stringContaining('motion query')]);

    const cue = setup();
    cue.state.throwOnCue = true;
    expect(() => cue.director.handle('PapaBlocked', world)).not.toThrow();
    expect(cue.newWarnings()).toEqual([expect.stringContaining('cue report')]);
  });

  it('never writes the world', () => {
    const { director } = setup();
    const before = structuredClone(world);
    director.handle('PapaBlocked', world);
    director.handle('BabyStateChanged', world);
    expect(world).toEqual(before);
  });

  describe('an event that points at a cue that does not exist', () => {
    const build = (events: Record<string, string>) => {
      const trace: string[] = [];
      const start = warnSpy.mock.calls.length;
      const director = createFeedbackDirector({
        table: { ...TABLE, events },
        audio: { playOneShot: () => trace.push('audio') },
        haptics: { pulse: () => trace.push('haptic') },
        getScene: () => null,
        prefersReducedMotion: () => false,
        onCue: (id) => trace.push(`cue:${id}`),
      });
      return {
        director,
        trace,
        newWarnings: () =>
          warnSpy.mock.calls
            .slice(start)
            .filter(([channel]) => channel === 'feedback')
            .map(([, message]) => message),
      };
    };

    it('plays nothing and warns once, when the table is built (content:check refuses it, a build that skipped it must say so)', () => {
      const { director, trace, newWarnings } = build({ PapaBlocked: 'nope' });
      expect(newWarnings()).toEqual([expect.stringContaining('PapaBlocked')]);
      director.handle('PapaBlocked', world);
      expect(trace).toEqual([]);
      expect(newWarnings()).toHaveLength(1);
    });

    it.each(['constructor', 'toString', '__proto__'])(
      'does not resolve the cue id %s to a member of Object.prototype',
      (id) => {
        const { director, trace, newWarnings } = build({ PapaBlocked: id });
        director.handle('PapaBlocked', world);
        expect(trace).toEqual([]);
        expect(newWarnings()).toEqual([expect.stringContaining(id)]);
      },
    );
  });
});
