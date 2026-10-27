import { RESUME_COUNTDOWN_MS } from '@shared/constants';
import { createEmitter } from '@shared/emitter';
import { asRealMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import type { ClientEvents } from './clientEvents.ts';
import { createPauseController } from './pauseController.ts';

const FRAME_MS = 16;

function setup(countdownMs?: number) {
  const events = createEmitter<ClientEvents>();
  const seen: string[] = [];
  events.on('PauseRequested', (payload) => seen.push(`PauseRequested:${payload.reason}`));
  events.on('ResumeRequested', () => seen.push('ResumeRequested'));
  events.on('GameResumed', () => seen.push('GameResumed'));
  const pause = createPauseController({ events, countdownMs });
  const update = (frameAtReal: number): void => pause.update(asRealMs(frameAtReal));
  /** Runs frames FRAME_MS apart from `startAtReal` until the controller is running; returns the frames used. */
  function countFramesToRunning(startAtReal: number, limit = 10_000): number {
    let frames = 0;
    for (let at = startAtReal; frames < limit; at += FRAME_MS) {
      update(at);
      frames++;
      if (pause.state === 'running') return frames;
    }
    return frames;
  }
  return {
    pause,
    seen,
    update,
    countFramesToRunning,
    countdownMs: countdownMs ?? RESUME_COUNTDOWN_MS,
  };
}

describe('createPauseController › states', () => {
  it('starts running with no countdown', () => {
    const { pause, seen } = setup();
    expect(pause.state).toBe('running');
    expect(pause.countdownRemainingMs).toBe(0);
    expect(seen).toEqual([]);
  });

  it('goes running → paused → resuming → running and emits each transition once, in order', () => {
    const { pause, seen, update, countFramesToRunning } = setup();
    pause.requestPause('user');
    expect(pause.state).toBe('paused');
    pause.requestResume();
    expect(pause.state).toBe('resuming');
    update(1000);
    expect(pause.state).toBe('resuming');
    countFramesToRunning(1000 + FRAME_MS);
    expect(pause.state).toBe('running');
    expect(seen).toEqual(['PauseRequested:user', 'ResumeRequested', 'GameResumed']);
  });

  it('carries the reason of the pause in PauseRequested', () => {
    for (const reason of ['visibilityHidden', 'user', 'portrait', 'gamepadDisconnected'] as const) {
      const { pause, seen } = setup();
      pause.requestPause(reason);
      expect(seen).toEqual([`PauseRequested:${reason}`]);
    }
  });

  it('emits PauseRequested once for a double pause and keeps the first reason', () => {
    const { pause, seen } = setup();
    pause.requestPause('visibilityHidden');
    pause.requestPause('user');
    expect(seen).toEqual(['PauseRequested:visibilityHidden']);
    expect(pause.state).toBe('paused');
  });

  it('ignores requestResume while running', () => {
    const { pause, seen } = setup();
    pause.requestResume();
    expect(pause.state).toBe('running');
    expect(seen).toEqual([]);
  });

  it('ignores requestResume while already resuming (the countdown does not restart)', () => {
    const { pause, seen, update } = setup();
    pause.requestPause('user');
    pause.requestResume();
    update(1000);
    update(1000 + FRAME_MS);
    const remainingBefore = pause.countdownRemainingMs;
    pause.requestResume();
    expect(pause.state).toBe('resuming');
    expect(pause.countdownRemainingMs).toBe(remainingBefore);
    expect(seen).toEqual(['PauseRequested:user', 'ResumeRequested']);
  });
});

describe('createPauseController › countdown', () => {
  it('starts at the first update after requestResume and lasts countdownMs of frame time', () => {
    const { pause, update, countdownMs } = setup();
    pause.requestPause('user');
    update(500); // frames while paused do not start anything
    update(900);
    pause.requestResume();
    expect(pause.countdownRemainingMs).toBe(countdownMs);
    update(1000);
    expect(pause.countdownRemainingMs).toBe(countdownMs);
    update(1000 + countdownMs - 1);
    expect(pause.state).toBe('resuming');
    expect(pause.countdownRemainingMs).toBe(1);
    update(1000 + countdownMs);
    expect(pause.state).toBe('running');
    expect(pause.countdownRemainingMs).toBe(0);
  });

  it('takes ceil(countdownMs / frame) frames at a steady frame rate', () => {
    const { pause, countFramesToRunning, countdownMs } = setup();
    pause.requestPause('user');
    pause.requestResume();
    const frames = countFramesToRunning(2000);
    // The first frame only starts the clock; the frame that completes it is the last one.
    expect(frames).toBe(Math.ceil(countdownMs / FRAME_MS) + 1);
  });

  it('honours a custom countdownMs', () => {
    const { pause, update } = setup(100);
    pause.requestPause('user');
    pause.requestResume();
    update(0);
    update(99);
    expect(pause.state).toBe('resuming');
    update(100);
    expect(pause.state).toBe('running');
  });

  it('counts down in frame time, not in the number of updates', () => {
    const { pause, update, countdownMs } = setup();
    pause.requestPause('user');
    pause.requestResume();
    update(0);
    for (let i = 0; i < 50; i++) update(1); // many updates, little time
    expect(pause.state).toBe('resuming');
    update(countdownMs);
    expect(pause.state).toBe('running');
  });

  it('emits GameResumed exactly once, on the frame that completes the countdown', () => {
    const { pause, seen, update, countdownMs } = setup();
    pause.requestPause('user');
    pause.requestResume();
    update(0);
    update(countdownMs);
    update(countdownMs + FRAME_MS);
    update(countdownMs + 2 * FRAME_MS);
    expect(seen.filter((name) => name === 'GameResumed')).toHaveLength(1);
  });

  it('cancels the countdown on a pause and restarts it at full length', () => {
    const { pause, seen, update, countdownMs } = setup();
    pause.requestPause('user');
    pause.requestResume();
    update(0);
    update(countdownMs - FRAME_MS); // almost there
    pause.requestPause('portrait');
    expect(pause.state).toBe('paused');
    expect(pause.countdownRemainingMs).toBe(0);
    update(countdownMs + 100); // paused frames never resume, however late
    expect(pause.state).toBe('paused');

    pause.requestResume();
    update(countdownMs + 200); // the new countdown starts here
    update(countdownMs + 200 + countdownMs - 1);
    expect(pause.state).toBe('resuming');
    update(countdownMs + 200 + countdownMs);
    expect(pause.state).toBe('running');
    expect(seen).toEqual([
      'PauseRequested:user',
      'ResumeRequested',
      'PauseRequested:portrait',
      'ResumeRequested',
      'GameResumed',
    ]);
  });

  it('reaches running from paused only through requestResume plus countdownMs of frames', () => {
    const { pause, update, countdownMs } = setup();
    pause.requestPause('user');
    for (let at = 0; at < countdownMs * 3; at += FRAME_MS) update(at);
    expect(pause.state).toBe('paused');
    pause.requestResume();
    expect(pause.state).toBe('resuming');
    const startAtReal = countdownMs * 3;
    for (let at = startAtReal; at < startAtReal + countdownMs; at += FRAME_MS) {
      update(at);
      expect(pause.state).toBe('resuming');
    }
    update(startAtReal + countdownMs);
    expect(pause.state).toBe('running');
  });

  it('ignores a non-finite frame time instead of freezing the countdown for good', () => {
    const { pause, update, countdownMs } = setup();
    pause.requestPause('user');
    pause.requestResume();
    update(Number.NaN); // would otherwise make the start time NaN and the countdown endless
    update(0);
    update(countdownMs);
    expect(pause.state).toBe('running');
  });

  it('refuses a countdown that is negative or not a number', () => {
    const events = createEmitter<ClientEvents>();
    expect(() => createPauseController({ events, countdownMs: -1 })).toThrow();
    expect(() => createPauseController({ events, countdownMs: Number.NaN })).toThrow();
  });
});
