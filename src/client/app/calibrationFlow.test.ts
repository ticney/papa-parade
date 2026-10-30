import { createEmitter } from '@shared/emitter';
import { log } from '@shared/log';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import testFeel from '../../../tests/support/testFeel.json' with { type: 'json' };
import type {
  CalibrationScreen,
  CalibrationScreenOptions,
} from '../ui/screens/calibrationScreen.ts';
import { createAppFsm } from './appFsm.ts';
import { type CalibrationFlowDeps, createCalibrationFlow } from './calibrationFlow.ts';
import type { ClientEvents } from './clientEvents.ts';

const warnSpy = vi.spyOn(log, 'warn');

beforeAll(() => {
  log.setLevel('error');
});

const audioWarnings = (): string[] =>
  warnSpy.mock.calls.filter(([channel]) => channel === 'audio').map(([, message]) => message);

function setup() {
  const events = createEmitter<ClientEvents>();
  const appFsm = createAppFsm({ events });
  const done: ClientEvents['CalibrationDone'][] = [];
  events.on('CalibrationDone', (payload) => done.push(payload));
  const saved: unknown[] = [];
  const calls: string[] = [];
  const audio = {
    state: 'running',
    currentTimeS: 5 as number | null,
    preloaded: [] as string[][],
    resumes: 0,
    scheduled: [] as number[],
    resolvePreload: null as (() => void) | null,
    preload(clips: readonly string[]) {
      this.preloaded.push([...clips]);
      return new Promise<void>((resolve) => {
        this.resolvePreload = resolve;
      });
    },
    resume() {
      this.resumes++;
    },
    playOneShotAt(_clip: string, _bus: string, _gain: number, atS: number) {
      this.scheduled.push(atS);
      return { cancel: () => undefined };
    },
  };
  let visibility = 'visible';
  const visibilityListeners: (() => void)[] = [];
  const screens: ReturnType<typeof fakeScreen>[] = [];
  function fakeScreen(options: CalibrationScreenOptions) {
    const screen = {
      options,
      stops: 0,
      restarts: 0,
      disposed: false,
      element: {} as HTMLElement,
      initialFocus: null,
      activate: () => undefined,
      skip: () => undefined,
      stop() {
        screen.stops++;
      },
      restart() {
        screen.restarts++;
      },
      dispose() {
        screen.disposed = true;
      },
    };
    return screen;
  }
  const deps: CalibrationFlowDeps = {
    appFsm,
    events,
    t: (key) => key,
    getFeel: () => testFeel.calibration,
    beep: { clip: 'ui_calibration_beep', bus: 'ui', gainPct: 100 },
    audio: audio as never,
    saveStore: {
      setCalibration: async (calibration) => {
        saved.push(calibration);
      },
    },
    device: 'web-touch',
    nowIso: () => '2026-10-30T10:00:00.000Z',
    frames: { request: () => 1, cancel: () => undefined },
    nowAtReal: () => 0,
    target: { addEventListener: () => undefined, removeEventListener: () => undefined },
    page: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_type, listener) => visibilityListeners.push(listener),
    },
    isMotionReduced: () => false,
    startLevel: () => calls.push('startLevel'),
    onPhase: (phase) => calls.push(`phase:${phase}`),
    onBeat: (count) => calls.push(`beat:${count}`),
    buildScreen: (options) => {
      const screen = fakeScreen(options);
      screens.push(screen);
      return screen as unknown as CalibrationScreen;
    },
  };
  const flow = createCalibrationFlow(deps);
  const enterStart = (): void => appFsm.enter('start');
  // The settings as the pause opens them (story 2.8): over a level, the only entry the table has.
  const enterSettings = (): void => {
    appFsm.enter('start');
    appFsm.enter('loading');
    appFsm.enter('level');
    appFsm.enter('settings');
  };
  return {
    flow,
    appFsm,
    events,
    audio,
    saved,
    done,
    calls,
    screens,
    enterStart,
    enterSettings,
    setVisibility: (next: string) => {
      visibility = next;
      for (const listener of visibilityListeners) listener();
    },
    last: () => screens[screens.length - 1] as ReturnType<typeof fakeScreen>,
  };
}

/** Plays the measure out through the screen's callbacks, as the real screen would. */
function measure(
  screen: { options: CalibrationScreenOptions },
  offsets: { audio: number | null; visual: number },
): void {
  const { options } = screen;
  if (offsets.audio === null) options.onAudioSkipped('player');
  else options.onAudioDone(offsets.audio);
  options.onVisualDone(offsets.visual);
}

describe('createCalibrationFlow', () => {
  it('opens the calibration, preloads the beep, and has no run until then', () => {
    const { flow, appFsm, audio, enterStart } = setup();
    enterStart();
    expect(flow.isRunning).toBe(false);
    flow.startRecalibration('loading');
    expect(flow.isRunning).toBe(true);
    expect(appFsm.state).toBe('calibration');
    expect(audio.preloaded).toEqual([['ui_calibration_beep']]);
  });

  it('leaves no run behind when the transition is refused, so a later start still opens', () => {
    const { flow, appFsm, enterStart } = setup();
    // `boot → calibration` is not in the table.
    expect(() => flow.startRecalibration('loading')).toThrow();
    expect(flow.isRunning).toBe(false);
    expect(appFsm.state).toBe('boot');
    enterStart();
    flow.startRecalibration('loading');
    expect(flow.isRunning).toBe(true);
    expect(appFsm.state).toBe('calibration');
  });

  it('ignores a second start while one is running', () => {
    const { flow, audio, enterStart } = setup();
    enterStart();
    flow.startRecalibration('loading');
    flow.startRecalibration('start');
    expect(audio.preloaded).toHaveLength(1);
  });

  it('builds the screen on the flow stage, with the base feel and the audio port', () => {
    const { flow, last, enterStart } = setup();
    enterStart();
    flow.startRecalibration('loading');
    flow.createScreen();
    expect(last().options.startAt).toBe('audio');
    expect(last().options.feel).toBe(testFeel.calibration);
  });

  describe('the audio port', () => {
    it('is pending until the beep has settled and the context runs', async () => {
      const { flow, audio, last, enterStart } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      const port = last().options.audio;
      expect(port.availability()).toBe('pending');
      audio.resolvePreload?.();
      await Promise.resolve();
      expect(port.availability()).toBe('ready');
      audio.state = 'suspended';
      expect(port.availability()).toBe('pending');
    });

    it('is unavailable with no context, and reads the audio clock', () => {
      const { flow, audio, last, enterStart } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      audio.state = 'none';
      expect(last().options.audio.availability()).toBe('unavailable');
      expect(last().options.audio.clockS()).toBe(5);
      audio.currentTimeS = null;
      expect(last().options.audio.clockS()).toBeNull();
    });

    it('schedules the beep on the audio clock', () => {
      const { flow, audio, last, enterStart } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      last().options.audio.scheduleBeep(7.5);
      expect(audio.scheduled).toEqual([7.5]);
    });
  });

  describe('the end, on a first launch', () => {
    it('saves both offsets, tells the game, and starts the level', () => {
      const { flow, saved, done, calls, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      measure(last(), { audio: 60, visual: 90 });
      last().options.onFinished();
      expect(saved).toEqual([
        {
          visualOffsetMs: 90,
          audioOffsetMs: 60,
          audioSkipped: false,
          measuredAt: '2026-10-30T10:00:00.000Z',
          device: 'web-touch',
        },
      ]);
      expect(done).toEqual([{ visualOffsetMs: 90, audioOffsetMs: 60, audioSkipped: false }]);
      expect(calls).toContain('startLevel');
      expect(flow.isRunning).toBe(false);
    });

    it('gives a skipped audio phase the visual offset, and says it was skipped', () => {
      const { flow, saved, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      measure(last(), { audio: null, visual: 120 });
      last().options.onFinished();
      expect(saved[0]).toMatchObject({
        visualOffsetMs: 120,
        audioOffsetMs: 120,
        audioSkipped: true,
      });
    });

    it('does not warn when the player skipped, and warns once when the audio cannot play', () => {
      const { flow, enterStart, last } = setup();
      enterStart();
      const before = audioWarnings().length;
      flow.startRecalibration('loading');
      flow.createScreen();
      last().options.onAudioSkipped('player');
      expect(audioWarnings().length).toBe(before);
      last().options.onAudioSkipped('unavailable');
      last().options.onAudioSkipped('unavailable');
      expect(audioWarnings().length).toBe(before + 1);
    });
  });

  describe('a recalibration (story 2.8 serves it with a table alone)', () => {
    it('resumes the audio first, so a recalibration from the pause hears its beep (D3)', () => {
      const { flow, audio, enterSettings } = setup();
      enterSettings();
      expect(audio.resumes).toBe(0);
      flow.startRecalibration('settings');
      expect(audio.resumes).toBe(1);
      expect(audio.preloaded).toHaveLength(1);
    });

    it('does not resume again for a start that is ignored', () => {
      const { flow, audio, enterSettings } = setup();
      enterSettings();
      flow.startRecalibration('settings');
      flow.startRecalibration('settings');
      expect(audio.resumes).toBe(1);
    });

    it('goes back to the state it came from, and does not start a level', () => {
      const { flow, appFsm, calls, enterSettings, last } = setup();
      enterSettings();
      flow.startRecalibration('settings');
      expect(appFsm.state as string).toBe('calibration');
      flow.createScreen();
      measure(last(), { audio: 10, visual: 20 });
      last().options.onFinished();
      expect(appFsm.state as string).toBe('settings');
      expect(calls).not.toContain('startLevel');
    });

    it('replaces the previous values: a second run starts clean', () => {
      const { flow, saved, enterSettings, last } = setup();
      enterSettings();
      flow.startRecalibration('settings');
      flow.createScreen();
      measure(last(), { audio: 10, visual: 20 });
      last().options.onFinished();
      flow.startRecalibration('settings');
      flow.createScreen();
      expect(last().options.startAt).toBe('audio');
      measure(last(), { audio: null, visual: 200 });
      last().options.onFinished();
      expect(saved).toHaveLength(2);
      expect(saved[1]).toMatchObject({ visualOffsetMs: 200, audioSkipped: true });
    });
  });

  describe('a rebuilt screen (the portrait overlay)', () => {
    it('starts the stage the flow was in, and keeps the offsets measured so far', () => {
      const { flow, screens, saved, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      last().options.onAudioDone(75);
      last().options.onPhase('visual');
      flow.createScreen();
      expect(screens).toHaveLength(2);
      expect(last().options.startAt).toBe('visual');
      last().options.onVisualDone(110);
      last().options.onFinished();
      expect(saved[0]).toMatchObject({
        audioOffsetMs: 75,
        visualOffsetMs: 110,
        audioSkipped: false,
      });
    });

    it('does not remember a retry as a stage: the stage it retries is kept', () => {
      const { flow, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      last().options.onPhase('visual');
      last().options.onPhase('retry');
      flow.createScreen();
      expect(last().options.startAt).toBe('visual');
    });

    it('starts the done message over when the screen is rebuilt during it', () => {
      const { flow, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      last().options.onPhase('done');
      flow.createScreen();
      expect(last().options.startAt).toBe('done');
    });
  });

  describe('the page in the background', () => {
    it('stops the phase when it is hidden, and resumes the audio and restarts it when it is back', () => {
      const { flow, audio, setVisibility, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      flow.createScreen();
      const startedWith = audio.resumes;
      setVisibility('hidden');
      expect(last().stops).toBe(1);
      expect(audio.resumes).toBe(startedWith);
      setVisibility('visible');
      expect(audio.resumes).toBe(startedWith + 1);
      expect(last().restarts).toBe(1);
    });

    it('does nothing outside the calibration', () => {
      const { audio, setVisibility, enterStart } = setup();
      enterStart();
      setVisibility('hidden');
      setVisibility('visible');
      expect(audio.resumes).toBe(0);
    });

    it('resumes the audio on return even with no screen mounted (the portrait overlay is up)', () => {
      const { flow, audio, setVisibility, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      const screen = flow.createScreen();
      screen.dispose();
      const startedWith = audio.resumes;
      setVisibility('hidden');
      setVisibility('visible');
      expect(audio.resumes).toBe(startedWith + 1);
      expect(last().restarts).toBe(0);
    });

    it('forgets a disposed screen, so a later return does not restart it', () => {
      const { flow, setVisibility, enterStart, last } = setup();
      enterStart();
      flow.startRecalibration('loading');
      const screen = flow.createScreen();
      const built = last();
      screen.dispose();
      expect(built.disposed).toBe(true);
      setVisibility('hidden');
      setVisibility('visible');
      expect(built.stops).toBe(0);
      expect(built.restarts).toBe(0);
    });
  });

  it('mirrors the stage and the beat count it is told about', () => {
    const { flow, calls, enterStart, last } = setup();
    enterStart();
    flow.startRecalibration('loading');
    flow.createScreen();
    last().options.onPhase('audio');
    last().options.onBeat(3);
    expect(calls).toEqual(['phase:audio', 'beat:3']);
  });

  it('forgets the run when the app leaves the calibration some other way than the end', () => {
    const { flow, appFsm, enterStart } = setup();
    enterStart();
    flow.startRecalibration('loading');
    appFsm.enter('loading');
    expect(flow.isRunning).toBe(false);
    appFsm.enter('oops');
    appFsm.enter('loading');
  });
});
