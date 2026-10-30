import type { Feel } from '@content/schemas/feel';
import { MS_PER_MINUTE } from '@shared/constants';
import { log } from '@shared/log';
import { computePhaseOffset } from '../../input/calibration.ts';
import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import type { Translator } from '../strings.ts';

/** The part of the calibration the screen is in: the two measures, then « Calé ! ». */
export type CalibrationStage = 'audio' | 'visual' | 'done';

/** What the debug mirror shows: the stage, or `retry` while a phase waits for a tap to start over. */
export type CalibrationScreenPhase = CalibrationStage | 'retry';

/** Why the audio phase was skipped: the player pressed the button, or the audio could not play. */
export type AudioSkipReason = 'player' | 'unavailable';

/** One animation frame at a time; the timestamp is `performance.now()`'s scale, like `event.timeStamp`. */
export interface CalibrationFrames {
  request(run: (atReal: number) => void): number;
  cancel(handle: number): void;
}

/**
 * What the audio phase needs of the sound: whether a beep can play now, the audio clock, and a way
 * to schedule one beep on it. No latency is ever added: the latency is what is being measured.
 */
export interface CalibrationAudio {
  /** `pending`: the context or the beep is not ready yet (a resume, a decode). `unavailable`: it never will be. */
  availability(): 'ready' | 'pending' | 'unavailable';
  /** The audio clock, in seconds, or null when there is no context. */
  clockS(): number | null;
  /** Schedules the beep at `atS` on that clock. Null: it could not be scheduled. */
  scheduleBeep(atS: number): { cancel(): void } | null;
}

/** The slice of `window` the screen taps on. */
export interface CalibrationTapTarget {
  addEventListener(type: 'pointerdown', listener: (event: PointerEvent) => void): void;
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'pointerdown', listener: (event: PointerEvent) => void): void;
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void): void;
}

export interface CalibrationScreenOptions {
  t: Translator;
  feel: Feel['calibration'];
  /** Where to begin: a rebuilt screen (the portrait overlay) restarts the stage the flow was in. */
  startAt: CalibrationStage;
  audio: CalibrationAudio;
  frames: CalibrationFrames;
  /** Real ms now, `performance.now()`'s scale. */
  now(): number;
  target: CalibrationTapTarget;
  /** Read at each beat: under reduced motion the ring keeps its opacity pop and drops its scale. */
  isMotionReduced(): boolean;
  /** The stage or `retry` changed (the flow remembers the stage; the debug build mirrors it). */
  onPhase(phase: CalibrationScreenPhase): void;
  /** Beats shown in the current run, from 0 at each (re)start (the debug build mirrors it). */
  onBeat(count: number): void;
  onAudioDone(offsetMs: number): void;
  onAudioSkipped(reason: AudioSkipReason): void;
  onVisualDone(offsetMs: number): void;
  /** « Calé ! » has been up for `doneHoldMs`: the flow ends. */
  onFinished(): void;
  /** Tests pass a fake; default `document`. */
  doc?: Pick<Document, 'createElement'>;
}

export interface CalibrationScreen extends OverlayScreen {
  /** A tap, from the pad (A): `atReal` is its edge stamp. */
  activate(atReal?: number): void;
  /** The skip button's action (pad B too). Only in the audio stage. */
  skip(): void;
  /** Stops the run: scheduled beeps cancelled, taps discarded, nothing shown changes. The page went to the background. */
  stop(): void;
  /** Starts the current stage over from its beginning, with no prompt. The page came back. */
  restart(): void;
}

type Mode = 'idle' | 'waiting' | 'running' | 'retry' | 'done' | 'ended';

/**
 * The calibration screen (story 2.7, EXPERIENCE.md › Calibration): an audio phase (8 beeps, a ring
 * that pops at each), a visual phase (8 flashes of a disc), then « Calé ! ». The player taps on
 * each beat (a touch anywhere, Space, or A); every tap is stamped by its own event, never by
 * `performance.now()` in a handler. The screen only measures: it hands the offset of each phase to
 * the flow, which owns the state that outlives a rebuild. All of its timing goes through the injected
 * frame scheduler and clock, so a test drives it without a browser.
 *
 * The beat times are **real** times. Audio: the beeps are scheduled on the audio clock at the start
 * of the run and their real times follow from one reading of both clocks. Visual: a beat is the
 * timestamp of the frame that turns the disc on, not the planned time.
 */
export function createCalibrationScreen(options: CalibrationScreenOptions): CalibrationScreen {
  const { t, feel, audio, frames, target } = options;
  const doc = options.doc ?? document;
  const intervalMs = MS_PER_MINUTE / feel.bpm;

  const element = doc.createElement('div');
  element.className = 'pp-overlay pp-calibration-screen';
  element.tabIndex = -1;

  const prompt = doc.createElement('p');
  prompt.className = 'pp-calibration-prompt pp-type-heading';
  prompt.setAttribute('aria-live', 'polite');

  const ring = doc.createElement('div');
  ring.className = 'pp-calibration-ring';
  ring.setAttribute('aria-hidden', 'true');
  const disc = doc.createElement('div');
  disc.className = 'pp-calibration-disc';
  disc.setAttribute('aria-hidden', 'true');

  const skipButton = doc.createElement('button');
  skipButton.type = 'button';
  skipButton.className = 'pp-button pp-button-secondary pp-calibration-skip';
  skipButton.textContent = t('calibration.skip_audio');
  // A press on the button is not a tap: it never reaches the window's listener.
  skipButton.addEventListener('pointerdown', (event) => event.stopPropagation());

  element.append(prompt, ring, disc, skipButton);

  let stage: CalibrationStage = options.startAt;
  let mode: Mode = 'idle';
  let frameHandle: number | null = null;
  let beeps: { cancel(): void }[] = [];
  const beatsAtReal: number[] = [];
  const tapsAtReal: number[] = [];
  let beatCount = 0;
  let waitStartAtReal: number | null = null;
  let runStartAtReal: number | null = null;
  let doneStartAtReal: number | null = null;
  let markOffAtReal = 0;
  let isMarkOn = false;

  const cancelFrame = (): void => {
    if (frameHandle !== null) frames.cancel(frameHandle);
    frameHandle = null;
  };
  const cancelBeeps = (): void => {
    for (const beep of beeps) beep.cancel();
    beeps = [];
  };
  const setMark = (isOn: boolean): void => {
    isMarkOn = isOn;
    const mark = stage === 'audio' ? ring : disc;
    if (isOn) mark.classList.add('pp-calibration-on');
    else mark.classList.remove('pp-calibration-on');
  };
  const clearMarks = (): void => {
    isMarkOn = false;
    ring.classList.remove('pp-calibration-on');
    disc.classList.remove('pp-calibration-on');
  };
  const requestFrame = (): void => {
    if (frameHandle === null) frameHandle = frames.request(onFrame);
  };

  const showStage = (): void => {
    const isAudio = stage === 'audio';
    ring.hidden = !isAudio;
    disc.hidden = stage !== 'visual';
    skipButton.hidden = !isAudio;
    prompt.textContent = t(
      stage === 'audio'
        ? 'calibration.audio_prompt'
        : stage === 'visual'
          ? 'calibration.visual_prompt'
          : 'calibration.done',
    );
  };

  // Starts `next` from its beginning: the run's state is wiped, the stage shown, the first frame asked.
  const begin = (next: CalibrationStage): void => {
    cancelFrame();
    cancelBeeps();
    clearMarks();
    stage = next;
    beatsAtReal.length = 0;
    tapsAtReal.length = 0;
    beatCount = 0;
    waitStartAtReal = null;
    runStartAtReal = null;
    doneStartAtReal = null;
    options.onBeat(0);
    showStage();
    options.onPhase(next);
    mode = next === 'audio' ? 'waiting' : next === 'visual' ? 'running' : 'done';
    requestFrame();
  };

  const skipAudio = (reason: AudioSkipReason): void => {
    options.onAudioSkipped(reason);
    begin('visual');
  };

  // Schedules the 8 beeps on the audio clock, once the sound is ready. One reading of both clocks
  // gives every beat's real time. Returns false when it could not (the audio phase is then skipped).
  const startAudioRun = (): boolean => {
    const nowAtReal = options.now();
    const nowS = audio.clockS();
    if (nowS === null) return false;
    for (let i = 0; i < feel.beatCount; i++) {
      const atS = nowS + (feel.leadInMs + i * intervalMs) / 1000;
      const beep = audio.scheduleBeep(atS);
      if (beep === null) {
        cancelBeeps();
        return false;
      }
      beeps.push(beep);
      beatsAtReal.push(nowAtReal + (atS - nowS) * 1000);
    }
    return true;
  };

  const finishRun = (): void => {
    const result = computePhaseOffset(beatsAtReal, tapsAtReal, feel);
    if (!result.isEnough) {
      log.info('input', 'calibration: too few valid taps, waiting for a tap', {
        stage,
        validCount: result.validCount,
      });
      // No frame runs in `retry`: a pulse still on (tailMs under pulseMs) would stay lit.
      clearMarks();
      mode = 'retry';
      prompt.textContent = t('calibration.too_few_taps');
      options.onPhase('retry');
      return;
    }
    if (stage === 'audio') {
      options.onAudioDone(result.offsetMs);
      begin('visual');
    } else {
      options.onVisualDone(result.offsetMs);
      begin('done');
    }
  };

  const pop = (atReal: number): void => {
    beatCount++;
    if (options.isMotionReduced()) element.classList.add('pp-calibration-reduced');
    else element.classList.remove('pp-calibration-reduced');
    setMark(true);
    markOffAtReal = atReal + feel.pulseMs;
    options.onBeat(beatCount);
  };

  // Each branch either ends the run for now (a skip, a result, the end) or asks the next frame.
  function onFrame(atReal: number): void {
    frameHandle = null;
    if (mode === 'waiting') {
      waitStartAtReal ??= atReal;
      const availability = audio.availability();
      if (availability === 'ready' && startAudioRun()) {
        mode = 'running';
      } else if (availability !== 'pending' || atReal - waitStartAtReal >= feel.audioWaitMs) {
        // Never ready (no context, a beep that cannot be scheduled) or not ready in time.
        skipAudio('unavailable');
        return;
      } else {
        requestFrame();
        return;
      }
    }
    if (mode === 'running') {
      if (isMarkOn && atReal >= markOffAtReal) setMark(false);
      if (stage === 'audio') runAudioFrame(atReal);
      else runVisualFrame(atReal);
      return;
    }
    if (mode === 'done') {
      doneStartAtReal ??= atReal;
      if (atReal - doneStartAtReal < feel.doneHoldMs) {
        requestFrame();
        return;
      }
      mode = 'ended';
      options.onFinished();
    }
  }

  // The ring pops when the frame's time reaches the beat's.
  function runAudioFrame(atReal: number): void {
    while (beatCount < beatsAtReal.length && atReal >= (beatsAtReal[beatCount] as number)) {
      pop(atReal);
    }
    const lastBeatAtReal = beatsAtReal[beatsAtReal.length - 1] as number;
    if (atReal >= lastBeatAtReal + feel.tailMs) finishRun();
    else requestFrame();
  }

  function runVisualFrame(atReal: number): void {
    runStartAtReal ??= atReal;
    const nextBeatAtReal = runStartAtReal + feel.leadInMs + beatCount * intervalMs;
    if (beatCount < feel.beatCount && atReal >= nextBeatAtReal) {
      // The beat is this frame: the one that turns the disc on, not the planned time.
      beatsAtReal.push(atReal);
      pop(atReal);
    }
    const lastBeatAtReal = beatsAtReal[beatsAtReal.length - 1];
    if (
      beatCount >= feel.beatCount &&
      lastBeatAtReal !== undefined &&
      atReal >= lastBeatAtReal + feel.tailMs
    ) {
      finishRun();
    } else {
      requestFrame();
    }
  }

  const tap = (atReal: number): void => {
    if (mode === 'running') tapsAtReal.push(atReal);
    // The tap that starts a phase over is not counted in it.
    else if (mode === 'retry') begin(stage);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    tap(event.timeStamp);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || event.repeat) return;
    // A focused button would be clicked by Space: here Space is a tap and nothing else.
    event.preventDefault();
    tap(event.timeStamp);
  };
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('keydown', onKeyDown);

  const skip = (): void => {
    if (stage !== 'audio' || mode === 'ended' || mode === 'idle') return;
    skipAudio('player');
  };
  const unbindSkip = bindPressButton(skipButton, skip);

  begin(options.startAt);

  return {
    element,
    // The screen element, never the button: a focused button would be pressed by Enter and Space.
    initialFocus: element,
    activate(atReal) {
      tap(atReal ?? options.now());
    },
    skip,
    stop() {
      if (mode === 'ended') return;
      cancelFrame();
      cancelBeeps();
      clearMarks();
      tapsAtReal.length = 0;
      mode = 'idle';
    },
    restart() {
      if (mode === 'ended') return;
      begin(stage);
    },
    dispose() {
      cancelFrame();
      cancelBeeps();
      mode = 'ended';
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('keydown', onKeyDown);
      unbindSkip();
    },
  };
}
