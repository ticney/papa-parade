import type { AudioBus } from '@content/schemas/feedback';
import type { Feel } from '@content/schemas/feel';
import type { CalibrationResult } from '@content/schemas/save';
import type { Emitter } from '@shared/emitter';
import { log } from '@shared/log';
import type { SaveStore } from '../save/saveStore.ts';
import type { OverlayScreen } from '../ui/overlayScreen.ts';
import {
  type AudioSkipReason,
  type CalibrationAudio,
  type CalibrationFrames,
  type CalibrationScreen,
  type CalibrationScreenOptions,
  type CalibrationScreenPhase,
  type CalibrationStage,
  type CalibrationTapTarget,
  createCalibrationScreen,
} from '../ui/screens/calibrationScreen.ts';
import type { Translator } from '../ui/strings.ts';
import type { AppFsm, AppState } from './appFsm.ts';
import type { ClientEvents } from './clientEvents.ts';

/** The beep of the audio phase, from `feedback.json › calibration`. */
export interface CalibrationBeep {
  clip: string;
  bus: AudioBus;
  gainPct: number;
}

/** The slice of the audio engine the flow needs. */
export interface CalibrationFlowAudio {
  readonly state: string;
  readonly currentTimeS: number | null;
  preload(clips: readonly string[]): Promise<void>;
  resume(): void;
  playOneShotAt(
    clip: string,
    bus: AudioBus,
    gainPct: number,
    atS: number,
  ): { cancel(): void } | null;
}

export interface CalibrationFlowDeps {
  appFsm: AppFsm;
  events: Emitter<ClientEvents>;
  t: Translator;
  /** `feel.calibration` of the base feel, read at each (re)start: no level is live to retune it. */
  getFeel(): Feel['calibration'];
  beep: CalibrationBeep;
  audio: CalibrationFlowAudio;
  saveStore: Pick<SaveStore, 'setCalibration'>;
  /** `${capabilities.target}-${touch ? 'touch' : 'desktop'}`: never a user-agent. */
  device: string;
  /** The wall clock as an ISO date, for the save only (never the sim's time). */
  nowIso(): string;
  frames: CalibrationFrames;
  nowAtReal(): number;
  target: CalibrationTapTarget;
  /** The page's visibility: a hidden page stops the phase, a visible one starts it over. */
  page: {
    readonly visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
  };
  isMotionReduced(): boolean;
  /** `levelSession.start()`: the first launch goes straight to the load of Age 1. */
  startLevel(): void;
  /** The debug build mirrors the stage and the beat count. */
  onPhase?(phase: CalibrationScreenPhase): void;
  onBeat?(count: number): void;
  /** Tests build the screen themselves. Default: `createCalibrationScreen`. */
  buildScreen?(options: CalibrationScreenOptions): CalibrationScreen;
}

export interface CalibrationFlow {
  /**
   * Opens the calibration and, when it ends, goes back to `returnTo`: `'loading'` starts the level
   * (the first launch), any other state is entered (story 2.8's settings row). The measure replaces
   * the stored one. Ignored while a calibration is already running.
   */
  startRecalibration(returnTo: AppState): void;
  /** The screen for the overlay host. A portrait overlay rebuilds it: the flow's state survives, the stage restarts. */
  createScreen(): OverlayScreen;
  /** Whether a calibration is under way. */
  readonly isRunning: boolean;
}

interface RunState {
  returnTo: AppState;
  stage: CalibrationStage;
  audioOffsetMs: number | null;
  audioSkipped: boolean;
  visualOffsetMs: number | null;
  /** The beep has settled in the engine (decoded, or given up on). */
  isPreloaded: boolean;
  hasWarnedAudio: boolean;
}

/**
 * The first-launch and recalibration flow (story 2.7, architecture P5). It owns what must outlive
 * the screen: the stage and the offsets measured so far, so that a turned phone (the portrait
 * overlay rebuilds the screen) restarts the stage it was in and not the whole calibration. The
 * screen measures; this saves, tells the game (`CalibrationDone`) and moves on.
 */
export function createCalibrationFlow(deps: CalibrationFlowDeps): CalibrationFlow {
  const { appFsm, events, audio } = deps;
  const buildScreen = deps.buildScreen ?? createCalibrationScreen;
  let run: RunState | null = null;
  let current: CalibrationScreen | null = null;

  const warnAudioSkipped = (state: RunState, reason: AudioSkipReason): void => {
    if (reason !== 'unavailable' || state.hasWarnedAudio) return;
    state.hasWarnedAudio = true;
    // A game started with a pad is the known case: a pad press is no user activation (boot.ts).
    log.warn('audio', 'calibration: audio cannot play, the audio phase is skipped', {
      audioState: audio.state,
    });
  };

  const finish = (state: RunState): void => {
    run = null;
    const visualOffsetMs = state.visualOffsetMs ?? 0;
    // A skipped audio phase borrows the visual offset: the audio offset is stored, unread until E4.
    const audioOffsetMs = state.audioSkipped
      ? visualOffsetMs
      : (state.audioOffsetMs ?? visualOffsetMs);
    const result: CalibrationResult = {
      visualOffsetMs,
      audioOffsetMs,
      audioSkipped: state.audioSkipped,
      measuredAt: deps.nowIso(),
      device: deps.device,
    };
    // In memory at once (the next input is corrected); the write settles on its own and warns on failure.
    void deps.saveStore.setCalibration(result);
    log.info('input', 'calibration done', {
      visualOffsetMs,
      audioOffsetMs,
      audioSkipped: state.audioSkipped,
    });
    events.emit('CalibrationDone', {
      visualOffsetMs,
      audioOffsetMs,
      audioSkipped: state.audioSkipped,
    });
    if (state.returnTo === 'loading') deps.startLevel();
    else appFsm.enter(state.returnTo);
  };

  const audioPort = (state: RunState): CalibrationAudio => ({
    availability: () => {
      if (audio.state === 'none') return 'unavailable';
      return state.isPreloaded && audio.state === 'running' ? 'ready' : 'pending';
    },
    clockS: () => audio.currentTimeS,
    scheduleBeep: (atS) =>
      audio.playOneShotAt(deps.beep.clip, deps.beep.bus, deps.beep.gainPct, atS),
  });

  // The page left or came back. A hidden page stops the phase; the context was suspended by the
  // pause (nothing resumes it outside a level), so coming back resumes it and starts the stage over.
  deps.page.addEventListener('visibilitychange', () => {
    if (appFsm.state !== 'calibration') return;
    if (deps.page.visibilityState === 'hidden') {
      current?.stop();
      return;
    }
    audio.resume();
    current?.restart();
  });

  events.on('AppStateChanged', ({ from }) => {
    // Left by some other way than the end: forget the run, the next one starts clean.
    if (from === 'calibration') run = null;
  });

  return {
    get isRunning() {
      return run !== null;
    },
    startRecalibration(returnTo) {
      if (run !== null) return;
      const state: RunState = {
        returnTo,
        stage: 'audio',
        audioOffsetMs: null,
        audioSkipped: false,
        visualOffsetMs: null,
        isPreloaded: false,
        hasWarnedAudio: false,
      };
      run = state;
      // The beep decodes while the screen comes up; the audio phase starts when this has settled.
      // `preload` never rejects.
      void audio.preload([deps.beep.clip]).then(() => {
        state.isPreloaded = true;
      });
      appFsm.enter('calibration');
    },
    createScreen() {
      if (run === null) {
        // `calibration` is entered only by `startRecalibration`: a screen without a run is a bug.
        log.warn('boot', 'the calibration screen was built with no calibration running');
        run = {
          returnTo: 'loading',
          stage: 'audio',
          audioOffsetMs: null,
          audioSkipped: false,
          visualOffsetMs: null,
          isPreloaded: true,
          hasWarnedAudio: false,
        };
      }
      const state = run;
      const screen = buildScreen({
        t: deps.t,
        feel: deps.getFeel(),
        startAt: state.stage,
        audio: audioPort(state),
        frames: deps.frames,
        now: deps.nowAtReal,
        target: deps.target,
        isMotionReduced: deps.isMotionReduced,
        onPhase: (phase) => {
          if (phase !== 'retry') state.stage = phase;
          deps.onPhase?.(phase);
        },
        onBeat: (count) => deps.onBeat?.(count),
        onAudioDone: (offsetMs) => {
          state.audioOffsetMs = offsetMs;
          state.audioSkipped = false;
        },
        onAudioSkipped: (reason) => {
          state.audioSkipped = true;
          state.audioOffsetMs = null;
          warnAudioSkipped(state, reason);
        },
        onVisualDone: (offsetMs) => {
          state.visualOffsetMs = offsetMs;
        },
        onFinished: () => finish(state),
      });
      current = screen;
      return {
        ...screen,
        dispose() {
          if (current === screen) current = null;
          screen.dispose();
        },
      };
    },
  };
}
