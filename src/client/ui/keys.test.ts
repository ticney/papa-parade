import { describe, expect, it } from 'vitest';
import type { AppState } from '../app/appFsm.ts';
import type { PauseState } from '../app/pauseController.ts';
import { escapeAction, isStartKey, type KeyLike, nextFocusIndex } from './keys.ts';

const PLAIN: Omit<KeyLike, 'code'> = {
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
};

describe('isStartKey', () => {
  it.each(['Space', 'Enter', 'KeyA', 'ArrowUp', 'Digit1', 'Tab'])('%s starts the game', (code) => {
    expect(isStartKey({ ...PLAIN, code })).toBe(true);
  });

  it.each([
    'ShiftLeft',
    'ShiftRight',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
    'CapsLock',
    'Escape',
  ])('%s does not', (code) => {
    expect(isStartKey({ ...PLAIN, code })).toBe(false);
  });

  it('ignores a repeating key and chords with Ctrl, Cmd or Alt', () => {
    expect(isStartKey({ ...PLAIN, code: 'KeyA', repeat: true })).toBe(false);
    expect(isStartKey({ ...PLAIN, code: 'KeyR', ctrlKey: true })).toBe(false);
    expect(isStartKey({ ...PLAIN, code: 'KeyR', metaKey: true })).toBe(false);
    expect(isStartKey({ ...PLAIN, code: 'KeyR', altKey: true })).toBe(false);
  });
});

describe('escapeAction', () => {
  const APP_STATES: AppState[] = ['boot', 'start', 'loading', 'level', 'result', 'oops'];
  const PAUSE_STATES: PauseState[] = ['running', 'paused', 'resuming'];

  it('toggles pause in a level: running → pause, paused → resume, resuming → pause again', () => {
    const base = { appState: 'level', isPortrait: false, repeat: false } as const;
    expect(escapeAction({ ...base, pauseState: 'running' })).toBe('pause');
    expect(escapeAction({ ...base, pauseState: 'paused' })).toBe('resume');
    expect(escapeAction({ ...base, pauseState: 'resuming' })).toBe('pause');
  });

  it('does nothing outside a level, whatever the pause state', () => {
    for (const appState of APP_STATES.filter((state) => state !== 'level')) {
      for (const pauseState of PAUSE_STATES) {
        expect(escapeAction({ appState, pauseState, isPortrait: false, repeat: false })).toBeNull();
      }
    }
  });

  it('does nothing in portrait (it must not resume under the overlay) or on a repeat', () => {
    for (const pauseState of PAUSE_STATES) {
      expect(
        escapeAction({ appState: 'level', pauseState, isPortrait: true, repeat: false }),
      ).toBeNull();
      expect(
        escapeAction({ appState: 'level', pauseState, isPortrait: false, repeat: true }),
      ).toBeNull();
    }
  });
});

describe('nextFocusIndex', () => {
  it('moves forward with Down and Right, wrapping', () => {
    expect(nextFocusIndex(3, 0, 'ArrowDown')).toBe(1);
    expect(nextFocusIndex(3, 2, 'ArrowDown')).toBe(0);
    expect(nextFocusIndex(3, 1, 'ArrowRight')).toBe(2);
  });

  it('moves back with Up and Left, wrapping', () => {
    expect(nextFocusIndex(3, 1, 'ArrowUp')).toBe(0);
    expect(nextFocusIndex(3, 0, 'ArrowUp')).toBe(2);
    expect(nextFocusIndex(3, 2, 'ArrowLeft')).toBe(1);
  });

  it('starts from the first or last button when none has focus', () => {
    expect(nextFocusIndex(3, -1, 'ArrowDown')).toBe(0);
    expect(nextFocusIndex(3, -1, 'ArrowUp')).toBe(2);
  });

  it('ignores other keys and an empty panel', () => {
    expect(nextFocusIndex(3, 0, 'Enter')).toBeNull();
    expect(nextFocusIndex(0, -1, 'ArrowDown')).toBeNull();
    expect(nextFocusIndex(Number.NaN, 0, 'ArrowDown')).toBeNull();
  });
});
