import type { FeedbackTable } from '@content/schemas/feedback';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim, type SimObjectSpec, type World } from '@sim';
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
  resultScreen: {
    rowCountUpMs: 600,
    rowStaggerMs: 200,
    starsDelayMs: 300,
    starIntervalMs: 450,
    actionsDelayMs: 400,
    inputGraceMs: 0,
  },
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
    layered: {
      audio: { clip: 'resp_parry', bus: 'sfx', gainPct: 100 },
      layers: [
        { clip: 'baby_laugh_perfect', bus: 'voice', gainPct: 90 },
        { clip: 'env_applause', bus: 'sfx', gainPct: 40 },
      ],
      visual: { kind: 'soundWave', anchor: 'threat', maxRadiusM: 1.2, durationMs: 450 },
      haptic: 'heavy',
    },
    threatPop: {
      audio: { clip: 'resp_parry', bus: 'sfx', gainPct: 80 },
      visual: { kind: 'soundWave', anchor: 'threat', maxRadiusM: 0.8, durationMs: 350 },
      haptic: 'medium',
    },
    objectRing: {
      audio: { clip: 'tel_phone_ring', bus: 'sfx', gainPct: 90 },
      visual: { kind: 'soundWave', anchor: 'object', maxRadiusM: 0.8, durationMs: 900 },
      haptic: 'light',
    },
    babyRing: {
      audio: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 100 },
      visual: { kind: 'soundWave', anchor: 'baby', maxRadiusM: 1, durationMs: 500 },
      haptic: 'light',
    },
    pulsing: {
      audio: { clip: 'tel_outlet', bus: 'sfx', gainPct: 80 },
      visual: {
        kind: 'soundWave',
        anchor: 'threat',
        maxRadiusM: 0.6,
        durationMs: 300,
        pulses: 3,
        pulseIntervalMs: 120,
      },
      haptic: 'light',
    },
    flashy: {
      audio: { clip: 'resp_parry', bus: 'sfx', gainPct: 100 },
      visual: { kind: 'soundWave', anchor: 'papa', maxRadiusM: 1.2, durationMs: 450 },
      flash: { peakOpacityPct: 35, durationMs: 180 },
      haptic: 'heavy',
      camera: { kind: 'shake', amplitudeM: 0.05, durationMs: 200 },
    },
    flashOnly: { flash: { peakOpacityPct: 20, durationMs: 100 } },
    star: {
      audio: { clip: 'ui_star_stamp', bus: 'ui', gainPct: 90 },
      visual: { kind: 'uiElement' },
      haptic: 'heavy',
    },
  },
  events: {
    PapaBlocked: 'full',
    NoiseAlertReached: 'flashOnly',
    CountdownTicked: 'tick',
    BabyStateChanged: 'babyRing',
    ResultLastStarStamped: 'star',
  },
};

const OBJECTS: readonly SimObjectSpec[] = [
  { id: 'coffee_machine', kind: 'coffee_machine', xM: -2, zM: 1.5, yM: 1 },
  { id: 'phone', kind: 'phone', xM: 3.25, zM: -0.75, yM: 0.8 },
];

function setup(
  options: {
    reducedMotion?: boolean;
    hasScene?: boolean;
    hasObjects?: boolean;
    /** The 3 Hz rule skipped the flash. */
    flashSkipped?: boolean;
    hasFlash?: boolean;
    /** Puts the visual reports in the trace, in order with the other parts. */
    traceVisuals?: boolean;
  } = {},
) {
  const trace: string[] = [];
  const visuals: string[] = [];
  const fx: LevelFx = {
    soundWave: (xM, zM, maxRadiusM, durationMs, startAt) =>
      trace.push(`wave:${xM},${zM},${maxRadiusM},${durationMs},${startAt}`),
    shake: (amplitudeM, durationMs, startAt) =>
      trace.push(`shake:${amplitudeM},${durationMs},${startAt}`),
    gag: () => {},
    liftBaby: () => {},
  };
  const state = {
    throwOnAudio: false,
    throwOnClip: null as string | null,
    throwOnHaptic: false,
    throwOnScene: false,
    throwOnGetScene: false,
    throwOnMotionQuery: false,
    throwOnCue: false,
    throwOnFlash: false,
    throwOnVisual: false,
  };
  const director = createFeedbackDirector({
    table: TABLE,
    audio: {
      playOneShot: (clip, bus, gainPct) => {
        if (state.throwOnAudio || state.throwOnClip === clip) throw new Error('speaker on fire');
        trace.push(`audio:${clip},${bus},${gainPct}`);
      },
    },
    haptics: {
      pulse: (kind) => {
        if (state.throwOnHaptic) throw new Error('motor on fire');
        trace.push(`haptic:${kind}`);
      },
    },
    getObjects: () => (options.hasObjects === false ? [] : OBJECTS),
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
          gag: () => {},
          liftBaby: () => {},
        };
      }
      return fx;
    },
    prefersReducedMotion: () => {
      if (state.throwOnMotionQuery) throw new Error('no matchMedia');
      return options.reducedMotion ?? false;
    },
    flash:
      options.hasFlash === false
        ? undefined
        : (peakOpacityPct, durationMs, isMotionReduced) => {
            if (state.throwOnFlash) throw new Error('screen on fire');
            if (options.flashSkipped) return false;
            trace.push(`flash:${peakOpacityPct},${durationMs},${isMotionReduced}`);
            return true;
          },
    onVisual: (id, kind) => {
      if (state.throwOnVisual) throw new Error('log on fire');
      if (options.traceVisuals) trace.push(`visual:${id},${kind}`);
      visuals.push(`${id},${kind}`);
    },
    onCue: (id) => {
      if (state.throwOnCue) throw new Error('mirror on fire');
      trace.push(`cue:${id}`);
    },
  });
  const warnings = (): string[] =>
    warnSpy.mock.calls.filter(([channel]) => channel === 'feedback').map(([, message]) => message);
  const start = warnings().length;
  return { director, trace, visuals, state, newWarnings: () => warnings().slice(start) };
}

describe('feedbackDirector: a cue anchored on an object (story 1.20)', () => {
  it('starts the ring at the x and z of the object the event names, and plays the rest', () => {
    const { director, trace, newWarnings } = setup();
    director.playCue('objectRing', world, null, 'phone');
    expect(trace).toEqual([
      'audio:tel_phone_ring,sfx,90',
      'haptic:light',
      'wave:3.25,-0.75,0.8,900,4200',
      'cue:objectRing',
    ]);
    expect(newWarnings()).toEqual([]);
  });

  it('warns and skips only the ring for an object the level does not have, or none at all', () => {
    for (const objectId of ['kettle', null, undefined]) {
      const { director, trace, newWarnings } = setup();
      director.playCue('objectRing', world, null, objectId);
      expect(trace, String(objectId)).toEqual([
        'audio:tel_phone_ring,sfx,90',
        'haptic:light',
        'cue:objectRing',
      ]);
      expect(newWarnings(), String(objectId)).toEqual([
        expect.stringContaining('ring for cue objectRing skipped: no object'),
      ]);
    }
  });

  it('skips the ring, with a warning, when the director was given no objects', () => {
    const { director, trace, newWarnings } = setup({ hasObjects: false });
    director.playCue('objectRing', world, null, 'phone');
    expect(trace.some((line) => line.startsWith('wave:'))).toBe(false);
    expect(newWarnings()).toHaveLength(1);
  });

  it('ignores the threat id for an object cue, and the object id for a threat cue', () => {
    const { director, trace } = setup();
    director.playCue('objectRing', world, 99, 'phone');
    expect(trace).toContain('wave:3.25,-0.75,0.8,900,4200');
    const threat = setup();
    threat.director.playCue('threatPop', world, null, 'phone');
    expect(threat.trace.some((line) => line.startsWith('wave:'))).toBe(false);
    expect(threat.newWarnings()).toEqual([expect.stringContaining('no threat')]);
  });
});

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

  it('draws nothing for a uiElement visual, with or without a world, and plays the sound and the vibration without a warning (story 1.22)', () => {
    for (const from of [null, world]) {
      const { director, trace, newWarnings } = setup();
      director.handle('ResultLastStarStamped', from);
      expect(trace).toEqual(['audio:ui_star_stamp,ui,90', 'haptic:heavy', 'cue:star']);
      expect(newWarnings()).toEqual([]);
    }
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

  describe('playCue', () => {
    const withThreat = (): World => {
      const threat = { id: 7, xM: -3.95, zM: 0.5 };
      return { ...world, threats: [threat] } as unknown as World;
    };

    it('plays the sound, the vibration and a ring at the threat the cue is about, in the order of handle', () => {
      const { director, trace } = setup();
      director.playCue('threatPop', withThreat(), 7);
      expect(trace).toEqual([
        'audio:resp_parry,sfx,80',
        'haptic:medium',
        'wave:-3.95,0.5,0.8,350,4200',
        'cue:threatPop',
      ]);
    });

    it('plays the cue of an event table too, by its id', () => {
      const { director, trace } = setup();
      director.playCue('full', world, null);
      expect(trace[0]).toBe('audio:papa_bump,sfx,70');
      expect(trace).toContain('cue:full');
    });

    it('skips the ring, with a warning, when the threat is not named or not in the world; the rest still plays', () => {
      const none = setup();
      none.director.playCue('threatPop', withThreat(), null);
      expect(none.trace).toEqual(['audio:resp_parry,sfx,80', 'haptic:medium', 'cue:threatPop']);
      expect(none.newWarnings()).toEqual([expect.stringContaining('no threat to anchor')]);

      const missing = setup();
      missing.director.playCue('threatPop', withThreat(), 99);
      expect(missing.trace.some((line) => line.startsWith('wave:'))).toBe(false);
      expect(missing.newWarnings()).toEqual([expect.stringContaining('no threat to anchor')]);
    });

    it('warns and plays nothing for a cue the table does not have, including Object.prototype members', () => {
      for (const id of ['nope', 'constructor', '__proto__']) {
        const { director, trace, newWarnings } = setup();
        director.playCue(id, world, null);
        expect(trace, id).toEqual([]);
        expect(newWarnings(), id).toEqual([expect.stringContaining(id)]);
      }
    });

    it("plays a cue's layers right after its audio and before the haptic, in order, with one cue report (story 2.3)", () => {
      const { director, trace } = setup();
      director.playCue('layered', withThreat(), 7);
      expect(trace).toEqual([
        'audio:resp_parry,sfx,100',
        'audio:baby_laugh_perfect,voice,90',
        'audio:env_applause,sfx,40',
        'haptic:heavy',
        'wave:-3.95,0.5,1.2,450,4200',
        'cue:layered',
      ]);
    });

    it('warns once for a layer that throws, and the next layer, the haptic and the ring still play', () => {
      const { director, trace, state, newWarnings } = setup();
      state.throwOnClip = 'baby_laugh_perfect';
      expect(() => director.playCue('layered', withThreat(), 7)).not.toThrow();
      expect(trace).toEqual([
        'audio:resp_parry,sfx,100',
        'audio:env_applause,sfx,40',
        'haptic:heavy',
        'wave:-3.95,0.5,1.2,450,4200',
        'cue:layered',
      ]);
      expect(newWarnings()).toEqual([expect.stringContaining('sound layer')]);
    });

    it('guards each part like handle does', () => {
      const { director, trace, state, newWarnings } = setup();
      state.throwOnAudio = true;
      expect(() => director.playCue('threatPop', withThreat(), 7)).not.toThrow();
      expect(trace[0]).toBe('haptic:medium');
      expect(newWarnings()).toEqual([expect.stringContaining('sound for cue threatPop failed')]);
    });
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

describe('feedbackDirector: pulses, flash and the visual report (story 2.4)', () => {
  const withThreat = (): World =>
    ({ ...world, threats: [{ id: 7, xM: -3.95, zM: 0.5 }] }) as unknown as World;

  it('queues the pulses of a wave on the sim clock, one haptic for all of them', () => {
    const { director, trace, newWarnings } = setup({ traceVisuals: true });
    const threat = { id: 7, xM: -3.95, zM: 0.5 };
    director.playCue('pulsing', withThreat(), threat.id);
    expect(trace).toEqual([
      'audio:tel_outlet,sfx,80',
      'haptic:light',
      `wave:${threat.xM},${threat.zM},0.6,300,4200`,
      `wave:${threat.xM},${threat.zM},0.6,300,4320`,
      `wave:${threat.xM},${threat.zM},0.6,300,4440`,
      'visual:pulsing,soundWave',
      'cue:pulsing',
    ]);
    expect(newWarnings()).toEqual([]);
  });

  it('reports a pulsing wave once, not once per pulse', () => {
    const { director, trace } = setup({ traceVisuals: true });
    director.playCue('pulsing', withThreat(), 7);
    expect(trace.filter((line) => line.startsWith('visual:'))).toEqual([
      'visual:pulsing,soundWave',
    ]);
  });

  it('plays the ring, then the flash, then the camera, then reports the cue', () => {
    const { director, trace } = setup({ traceVisuals: true });
    director.playCue('flashy', world, null);
    expect(trace).toEqual([
      'audio:resp_parry,sfx,100',
      'haptic:heavy',
      `wave:${world.papa.xM},${world.papa.zM},1.2,450,4200`,
      'visual:flashy,soundWave',
      'flash:35,180,false',
      'visual:flashy,flash',
      'shake:0.05,200,4200',
      'cue:flashy',
    ]);
  });

  it('asks for the border glow under reduced motion, and plays no camera effect', () => {
    const { director, trace } = setup({ reducedMotion: true, traceVisuals: true });
    director.playCue('flashy', world, null);
    expect(trace).toContain('flash:35,180,true');
    expect(trace.some((line) => line.startsWith('shake:'))).toBe(false);
  });

  it('flashes with no world: a client event may flash', () => {
    const { director, trace } = setup({ traceVisuals: true });
    director.handle('NoiseAlertReached', null);
    expect(trace).toEqual(['flash:20,100,false', 'visual:flashOnly,flash', 'cue:flashOnly']);
  });

  it('does not report a flash that the 3 Hz rule skipped, and still reports the cue', () => {
    const { director, trace, newWarnings } = setup({ flashSkipped: true, traceVisuals: true });
    director.playCue('flashy', world, null);
    expect(trace).not.toContain('visual:flashy,flash');
    expect(trace).toContain('visual:flashy,soundWave');
    expect(trace).toContain('shake:0.05,200,4200');
    expect(trace.at(-1)).toBe('cue:flashy');
    expect(newWarnings()).toEqual([]);
  });

  it('skips a flash when the director was given no flash dep, without a warning', () => {
    const { director, trace, newWarnings } = setup({ hasFlash: false, traceVisuals: true });
    director.playCue('flashy', world, null);
    expect(trace.some((line) => line.startsWith('flash:'))).toBe(false);
    expect(trace).not.toContain('visual:flashy,flash');
    expect(newWarnings()).toEqual([]);
  });

  it('warns once for a flash that throws, and the camera and the cue still run', () => {
    const { director, trace, state, newWarnings } = setup({ traceVisuals: true });
    state.throwOnFlash = true;
    director.playCue('flashy', world, null);
    expect(newWarnings()).toEqual([expect.stringContaining('flash for cue flashy failed')]);
    expect(trace).not.toContain('visual:flashy,flash');
    expect(trace).toContain('shake:0.05,200,4200');
    expect(trace.at(-1)).toBe('cue:flashy');
  });

  it('counts a failing motion query as reduced motion for the flash', () => {
    const { director, trace, state } = setup({ traceVisuals: true });
    state.throwOnMotionQuery = true;
    director.playCue('flashy', world, null);
    expect(trace).toContain('flash:35,180,true');
  });

  it('reports a uiElement visual once, and draws nothing', () => {
    const { director, trace, newWarnings } = setup({ traceVisuals: true });
    director.handle('ResultLastStarStamped', null);
    expect(trace).toEqual([
      'audio:ui_star_stamp,ui,90',
      'haptic:heavy',
      'visual:star,uiElement',
      'cue:star',
    ]);
    expect(newWarnings()).toEqual([]);
  });

  it('does not report a ring that was skipped for a missing anchor, nor one that throws', () => {
    const skipped = setup({ traceVisuals: true });
    skipped.director.playCue('pulsing', world, null);
    expect(skipped.trace.some((line) => line.startsWith('visual:'))).toBe(false);
    const thrown = setup({ traceVisuals: true });
    thrown.state.throwOnScene = true;
    thrown.director.playCue('flashy', world, null);
    expect(thrown.trace).not.toContain('visual:flashy,soundWave');
    expect(thrown.trace).toContain('visual:flashy,flash');
  });

  it('warns once when the visual report throws, and the cue is still reported', () => {
    const { director, trace, state, newWarnings } = setup({ traceVisuals: true });
    state.throwOnVisual = true;
    director.playCue('flashy', world, null);
    expect(newWarnings().filter((line) => line.includes('visual report'))).toHaveLength(2);
    expect(trace.at(-1)).toBe('cue:flashy');
  });
});
