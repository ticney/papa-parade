import { describe, expect, it } from 'vitest';
import testFeel from '../../../../tests/support/testFeel.json' with { type: 'json' };
import {
  type CalibrationAudio,
  type CalibrationScreenOptions,
  type CalibrationScreenPhase,
  createCalibrationScreen,
} from './calibrationScreen.ts';

const feel = testFeel.calibration;
const INTERVAL_MS = 60_000 / feel.bpm;

type Listener = (event: unknown) => void;

// The little of the DOM the screen and its press button use; the node environment has none.
class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  type = '';
  tabIndex = 0;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  readonly classList = {
    add: (...names: string[]) => this.setClasses([...this.classes(), ...names]),
    remove: (...names: string[]) =>
      this.setClasses(this.classes().filter((name) => !names.includes(name))),
    contains: (name: string) => this.classes().includes(name),
  };
  private classes(): string[] {
    return this.className.split(/\s+/).filter((name) => name !== '');
  }
  private setClasses(names: string[]): void {
    this.className = [...new Set(names)].join(' ');
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  click(): void {
    this.dispatch('click', { detail: 0 });
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const doc = { createElement: () => new FakeElement() };

/** An animation-frame scheduler the test steps by hand; the clock is the frame's time. */
function createFrames() {
  let nowAtReal = 0;
  let nextHandle = 1;
  let pending: { handle: number; run: (atReal: number) => void } | null = null;
  return {
    scheduler: {
      request(run: (atReal: number) => void) {
        pending = { handle: nextHandle++, run };
        return pending.handle;
      },
      cancel(handle: number) {
        if (pending?.handle === handle) pending = null;
      },
    },
    now: () => nowAtReal,
    get isPending() {
      return pending !== null;
    },
    /** Runs one frame at `atReal`. */
    frame(atReal: number) {
      nowAtReal = atReal;
      const frame = pending;
      pending = null;
      frame?.run(atReal);
    },
    /** Steps frames of 16 ms until `untilAtReal`, calling `each` after every frame. */
    runTo(untilAtReal: number, each?: (atReal: number) => void) {
      while (pending !== null && nowAtReal + 16 <= untilAtReal) {
        this.frame(nowAtReal + 16);
        each?.(nowAtReal);
      }
    },
  };
}

function createAudio(availability: 'ready' | 'pending' | 'unavailable' = 'ready') {
  const state = { availability, clockS: 10 as number | null, failAt: -1 };
  const scheduled: { atS: number; isCancelled: boolean }[] = [];
  const audio: CalibrationAudio = {
    availability: () => state.availability,
    clockS: () => state.clockS,
    scheduleBeep(atS) {
      if (scheduled.length === state.failAt) return null;
      const beep = { atS, isCancelled: false };
      scheduled.push(beep);
      return {
        cancel() {
          beep.isCancelled = true;
        },
      };
    },
  };
  return { audio, state, scheduled };
}

function build(
  overrides: Partial<CalibrationScreenOptions> = {},
  availability: 'ready' | 'pending' | 'unavailable' = 'ready',
) {
  const frames = createFrames();
  const sound = createAudio(availability);
  const target = new FakeElement();
  const log: string[] = [];
  const phases: CalibrationScreenPhase[] = [];
  const beats: number[] = [];
  const offsets = { audio: null as number | null, visual: null as number | null };
  let reduced = false;
  const screen = createCalibrationScreen({
    t: (key) => key,
    feel,
    startAt: 'audio',
    audio: sound.audio,
    frames: frames.scheduler,
    now: frames.now,
    target: target as never,
    isMotionReduced: () => reduced,
    onPhase: (phase) => phases.push(phase),
    onBeat: (count) => beats.push(count),
    onAudioDone: (offsetMs) => {
      offsets.audio = offsetMs;
      log.push('audio done');
    },
    onAudioSkipped: (reason) => log.push(`audio skipped: ${reason}`),
    onVisualDone: (offsetMs) => {
      offsets.visual = offsetMs;
      log.push('visual done');
    },
    onFinished: () => log.push('finished'),
    doc: doc as never,
    ...overrides,
  });
  const root = screen.element as unknown as FakeElement;
  const [prompt, ring, disc, skipButton] = root.children as [
    FakeElement,
    FakeElement,
    FakeElement,
    FakeElement,
  ];
  const tap = (timeStamp: number) =>
    target.dispatch('pointerdown', { isPrimary: true, button: 0, timeStamp });
  return {
    screen,
    root,
    prompt,
    ring,
    disc,
    skipButton,
    frames,
    sound,
    target,
    log,
    phases,
    beats,
    offsets,
    tap,
    setReduced: (next: boolean) => {
      reduced = next;
    },
  };
}

describe('createCalibrationScreen', () => {
  it('is an ink screen with a prompt, a ring, a disc and a skip button; focus goes to the screen', () => {
    const { root, prompt, ring, disc, skipButton, screen } = build();
    expect(root.className).toBe('pp-overlay pp-calibration-screen');
    expect(root.tabIndex).toBe(-1);
    expect(screen.initialFocus).toBe(root);
    expect(prompt.textContent).toBe('calibration.audio_prompt');
    expect(skipButton.textContent).toBe('calibration.skip_audio');
    expect(skipButton.type).toBe('button');
    expect(ring.hidden).toBe(false);
    expect(disc.hidden).toBe(true);
    expect(skipButton.hidden).toBe(false);
  });

  describe('the audio phase', () => {
    it('schedules the beeps on the audio clock from one reading, with no latency added', () => {
      const env = build();
      env.frames.frame(100); // the first frame: the sound is ready
      expect(env.sound.scheduled).toHaveLength(feel.beatCount);
      env.sound.scheduled.forEach((beep, i) => {
        expect(beep.atS).toBeCloseTo(10 + (feel.leadInMs + i * INTERVAL_MS) / 1000, 9);
      });
    });

    it('pops the ring when a frame reaches the beat, for pulseMs, and counts the beats', () => {
      const env = build();
      env.frames.frame(100);
      const firstBeatAtReal = 0 + feel.leadInMs; // `now()` is 100 at the reading
      const first = 100 + feel.leadInMs;
      env.frames.runTo(first - 20);
      expect(env.ring.classList.contains('pp-calibration-on')).toBe(false);
      env.frames.runTo(first + 16);
      expect(env.ring.classList.contains('pp-calibration-on')).toBe(true);
      expect(env.beats.at(-1)).toBe(1);
      env.frames.runTo(first + feel.pulseMs + 40);
      expect(env.ring.classList.contains('pp-calibration-on')).toBe(false);
      expect(firstBeatAtReal).toBe(feel.leadInMs);
    });

    it('measures the lag of the taps and goes on to the visual phase', () => {
      const env = build();
      env.frames.frame(0);
      const lastBeat = feel.leadInMs + (feel.beatCount - 1) * INTERVAL_MS;
      // Tap exactly 120 ms after each planned beat: the stamps are the events' own.
      for (let i = 0; i < feel.beatCount; i++) {
        env.tap(feel.leadInMs + i * INTERVAL_MS + 120);
      }
      env.frames.runTo(lastBeat + feel.tailMs + 40);
      expect(env.offsets.audio).toBe(120);
      expect(env.phases.at(-1)).toBe('visual');
      expect(env.prompt.textContent).toBe('calibration.visual_prompt');
      expect(env.ring.hidden).toBe(true);
      expect(env.disc.hidden).toBe(false);
      expect(env.skipButton.hidden).toBe(true);
    });

    it('does not count a tap before the run, in the wait for the sound', () => {
      const env = build({}, 'pending');
      env.frames.frame(0);
      env.tap(5);
      env.sound.state.availability = 'ready';
      env.frames.frame(16);
      for (let i = 0; i < feel.beatCount; i++) env.tap(16 + feel.leadInMs + i * INTERVAL_MS + 50);
      env.frames.runTo(16 + feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      expect(env.offsets.audio).toBe(50);
    });

    it('is skipped, as unavailable, when there is no sound at all', () => {
      const env = build({}, 'unavailable');
      env.frames.frame(0);
      expect(env.log).toEqual(['audio skipped: unavailable']);
      expect(env.phases.at(-1)).toBe('visual');
      expect(env.sound.scheduled).toEqual([]);
    });

    it('waits up to audioWaitMs for a sound that is not ready, then skips', () => {
      const env = build({}, 'pending');
      env.frames.frame(0);
      env.frames.runTo(feel.audioWaitMs - 20);
      expect(env.log).toEqual([]);
      env.frames.runTo(feel.audioWaitMs + 40);
      expect(env.log).toEqual(['audio skipped: unavailable']);
    });

    it('starts as soon as a pending sound turns ready', () => {
      const env = build({}, 'pending');
      env.frames.frame(0);
      env.frames.frame(16);
      expect(env.sound.scheduled).toEqual([]);
      env.sound.state.availability = 'ready';
      env.frames.frame(32);
      expect(env.sound.scheduled).toHaveLength(feel.beatCount);
    });

    it('cancels every beep it scheduled and skips when one cannot be scheduled', () => {
      const env = build();
      env.sound.state.failAt = 3;
      env.frames.frame(0);
      expect(env.sound.scheduled.every((beep) => beep.isCancelled)).toBe(true);
      expect(env.log).toEqual(['audio skipped: unavailable']);
    });

    it('is skipped as unavailable when the audio clock is gone', () => {
      const env = build();
      env.sound.state.clockS = null;
      env.frames.frame(0);
      expect(env.log).toEqual(['audio skipped: unavailable']);
    });
  });

  describe('too few taps', () => {
    it('shows the string and waits, without restarting on its own', () => {
      const env = build();
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      expect(env.phases.at(-1)).toBe('retry');
      expect(env.prompt.textContent).toBe('calibration.too_few_taps');
      expect(env.frames.isPending).toBe(false);
      expect(env.log).toEqual([]);
    });

    it('the next tap starts the phase over, and is not counted in it', () => {
      const env = build();
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      const scheduledBefore = env.sound.scheduled.length;
      env.tap(5000);
      expect(env.phases.at(-1)).toBe('audio');
      expect(env.beats.at(-1)).toBe(0);
      expect(env.prompt.textContent).toBe('calibration.audio_prompt');
      env.frames.frame(5016);
      expect(env.sound.scheduled.length).toBe(scheduledBefore + feel.beatCount);
      // Taps from that new run only: the tap that restarted it is not among them.
      for (let i = 0; i < feel.beatCount; i++) {
        env.tap(5016 + feel.leadInMs + i * INTERVAL_MS + 30);
      }
      env.frames.runTo(5016 + feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      expect(env.offsets.audio).toBe(30);
    });

    it('keeps the skip button in the audio phase retry', () => {
      const env = build();
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      expect(env.skipButton.hidden).toBe(false);
    });
  });

  describe('skipping the audio phase', () => {
    it('cancels every beep and goes to the visual phase, from the button', () => {
      const env = build();
      env.frames.frame(0);
      env.skipButton.click();
      expect(env.sound.scheduled.every((beep) => beep.isCancelled)).toBe(true);
      expect(env.log).toEqual(['audio skipped: player']);
      expect(env.phases.at(-1)).toBe('visual');
    });

    it('works from the screen (pad B) while waiting for the sound', () => {
      const env = build({}, 'pending');
      env.frames.frame(0);
      env.screen.skip();
      expect(env.log).toEqual(['audio skipped: player']);
    });

    it('does nothing in the visual phase', () => {
      const env = build({ startAt: 'visual' });
      env.screen.skip();
      expect(env.log).toEqual([]);
      expect(env.phases.at(-1)).toBe('visual');
    });

    it('stops the press on the button from reaching the window as a tap', () => {
      const env = build();
      let isStopped = false;
      env.skipButton.dispatch('pointerdown', {
        stopPropagation: () => {
          isStopped = true;
        },
      });
      expect(isStopped).toBe(true);
    });
  });

  describe('the visual phase', () => {
    it('takes the frame that turns the disc on as the beat, not the planned time', () => {
      const env = build({ startAt: 'visual' });
      // Frames land at 7, 23, 39...: the first planned beat (1007) falls between two frames, so the
      // frame that flashes is later than planned, and a tap 90 ms after it measures 90, not 90 + the lateness.
      env.frames.frame(7);
      let seen = 0;
      let flashFrame = 0;
      env.frames.runTo(7 + feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40, (atReal) => {
        if ((env.beats.at(-1) ?? 0) > seen) {
          seen = env.beats.at(-1) ?? 0;
          if (seen === 1) flashFrame = atReal;
          env.tap(atReal + 90);
        }
      });
      expect(flashFrame).toBeGreaterThan(7 + feel.leadInMs);
      expect(env.offsets.visual).toBe(90);
    });

    it('measures the offset against the frames that flashed', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      const flashedAt: number[] = [];
      let seen = 0;
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40, (atReal) => {
        if ((env.beats.at(-1) ?? 0) > seen) {
          seen = env.beats.at(-1) ?? 0;
          flashedAt.push(atReal);
          env.tap(atReal + 70);
        }
      });
      expect(flashedAt).toHaveLength(feel.beatCount);
      expect(env.offsets.visual).toBe(70);
      expect(env.phases.at(-1)).toBe('done');
      expect(env.prompt.textContent).toBe('calibration.done');
    });

    it('flashes the disc for pulseMs and no longer', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + 20);
      expect(env.disc.classList.contains('pp-calibration-on')).toBe(true);
      env.frames.runTo(feel.leadInMs + feel.pulseMs + 60);
      expect(env.disc.classList.contains('pp-calibration-on')).toBe(false);
    });

    it('never flashes faster than the bpm allows: one flash per beat interval', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + 3 * INTERVAL_MS + 40);
      expect(env.beats.at(-1)).toBe(4);
    });
  });

  describe('the end', () => {
    function toDone() {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      let seen = 0;
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40, (atReal) => {
        if ((env.beats.at(-1) ?? 0) > seen) {
          seen = env.beats.at(-1) ?? 0;
          env.tap(atReal + 40);
        }
      });
      return env;
    }

    it('holds « Calé ! » for doneHoldMs, then finishes once', () => {
      const env = toDone();
      expect(env.log).toEqual(['visual done']);
      const at = env.frames.now();
      env.frames.runTo(at + feel.doneHoldMs - 40);
      expect(env.log).toEqual(['visual done']);
      env.frames.runTo(at + feel.doneHoldMs + 80);
      expect(env.log).toEqual(['visual done', 'finished']);
      env.frames.runTo(at + feel.doneHoldMs + 400);
      expect(env.log).toEqual(['visual done', 'finished']);
    });

    it('a rebuilt screen can begin at « done » and holds the message again', () => {
      const env = build({ startAt: 'done' });
      expect(env.prompt.textContent).toBe('calibration.done');
      env.frames.frame(0);
      env.frames.runTo(feel.doneHoldMs + 40);
      expect(env.log).toEqual(['finished']);
    });
  });

  describe('taps', () => {
    it('counts only a primary pointer with the main button', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      env.target.dispatch('pointerdown', { isPrimary: false, button: 0, timeStamp: 1 });
      env.target.dispatch('pointerdown', { isPrimary: true, button: 2, timeStamp: 2 });
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      expect(env.phases.at(-1)).toBe('retry');
    });

    it('counts Space, once per press, and swallows it so a focused button is not clicked', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      let prevented = 0;
      const key = (code: string, repeat: boolean, timeStamp: number) =>
        env.target.dispatch('keydown', {
          code,
          repeat,
          timeStamp,
          preventDefault: () => {
            prevented++;
          },
        });
      key('Space', true, 1);
      key('Enter', false, 2);
      key('KeyA', false, 3);
      expect(prevented).toBe(0);
      key('Space', false, 4);
      expect(prevented).toBe(1);
    });

    it('takes a pad A with its own edge stamp, and `now()` when it has none', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      let seen = 0;
      env.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40, (atReal) => {
        if ((env.beats.at(-1) ?? 0) > seen) {
          seen = env.beats.at(-1) ?? 0;
          // The pad's own edge stamp, 25 ms after the flash.
          env.screen.activate(atReal + 25);
        }
      });
      expect(env.offsets.visual).toBe(25);
      const bare = build({ startAt: 'visual' });
      bare.frames.frame(0);
      let beatsSeen = 0;
      bare.frames.runTo(feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40, () => {
        if ((bare.beats.at(-1) ?? 0) > beatsSeen) {
          beatsSeen = bare.beats.at(-1) ?? 0;
          bare.screen.activate();
        }
      });
      expect(bare.offsets.visual).toBe(0);
    });

    it('ignores a tap while the screen is stopped', () => {
      const env = build({ startAt: 'visual' });
      env.frames.frame(0);
      env.screen.stop();
      env.tap(500);
      env.screen.restart();
      env.frames.frame(16);
      env.frames.runTo(16 + feel.leadInMs + 7 * INTERVAL_MS + feel.tailMs + 40);
      expect(env.phases.at(-1)).toBe('retry');
    });
  });

  describe('the page in the background', () => {
    it('stop cancels the scheduled beeps and the frames; restart begins the stage over from 0 beats', () => {
      const env = build();
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + INTERVAL_MS + 40);
      expect(env.beats.at(-1)).toBe(2);
      env.screen.stop();
      expect(env.sound.scheduled.every((beep) => beep.isCancelled)).toBe(true);
      expect(env.frames.isPending).toBe(false);
      expect(env.ring.classList.contains('pp-calibration-on')).toBe(false);
      env.screen.restart();
      expect(env.beats.at(-1)).toBe(0);
      env.frames.frame(10_000);
      expect(env.sound.scheduled).toHaveLength(2 * feel.beatCount);
      expect(env.sound.scheduled.slice(feel.beatCount).every((beep) => !beep.isCancelled)).toBe(
        true,
      );
    });

    it('restarts the stage it was in: the visual one after a skip', () => {
      const env = build();
      env.frames.frame(0);
      env.screen.skip();
      env.screen.stop();
      env.screen.restart();
      expect(env.phases.at(-1)).toBe('visual');
      expect(env.log).toEqual(['audio skipped: player']);
    });

    it('restart waits for the sound again: a resume is asynchronous', () => {
      const env = build();
      env.frames.frame(0);
      env.screen.stop();
      env.sound.state.availability = 'pending';
      env.screen.restart();
      env.frames.frame(16);
      expect(env.sound.scheduled).toHaveLength(feel.beatCount);
      env.sound.state.availability = 'ready';
      env.frames.frame(32);
      expect(env.sound.scheduled).toHaveLength(2 * feel.beatCount);
    });
  });

  describe('reduced motion', () => {
    it('marks the screen at each beat so the ring keeps its opacity pop and drops its scale', () => {
      const env = build({ startAt: 'visual' });
      env.setReduced(true);
      env.frames.frame(0);
      env.frames.runTo(feel.leadInMs + 40);
      expect(env.root.classList.contains('pp-calibration-reduced')).toBe(true);
      env.setReduced(false);
      env.frames.runTo(feel.leadInMs + INTERVAL_MS + 40);
      expect(env.root.classList.contains('pp-calibration-reduced')).toBe(false);
      // The beat itself still happened: it is information.
      expect(env.beats.at(-1)).toBe(2);
    });
  });

  describe('dispose', () => {
    it('removes its window listeners, cancels the beeps and the frame', () => {
      const env = build();
      env.frames.frame(0);
      expect(env.target.count('pointerdown')).toBe(1);
      expect(env.target.count('keydown')).toBe(1);
      env.screen.dispose();
      expect(env.target.count('pointerdown')).toBe(0);
      expect(env.target.count('keydown')).toBe(0);
      expect(env.sound.scheduled.every((beep) => beep.isCancelled)).toBe(true);
      expect(env.frames.isPending).toBe(false);
    });

    it('never finishes after it was disposed', () => {
      const env = build({ startAt: 'done' });
      env.screen.dispose();
      env.frames.frame(0);
      env.frames.frame(feel.doneHoldMs + 100);
      expect(env.log).toEqual([]);
    });
  });
});
