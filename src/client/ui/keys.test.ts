import { describe, expect, it } from 'vitest';
import type { AppState } from '../app/appFsm.ts';
import type { OverlayKind } from '../app/overlay.ts';
import type { PauseState } from '../app/pauseController.ts';
import type { PadButton } from '../input/gamepadInput.ts';
import {
  escapeAction,
  isStartKey,
  type KeyLike,
  nextFocusIndex,
  type PadAction,
  padAction,
} from './keys.ts';

const PLAIN: Omit<KeyLike, 'code'> = {
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
};

describe('isStartKey', () => {
  it.each(['Space', 'Enter', 'NumpadEnter', 'KeyA', 'ArrowUp', 'Digit1', 'Numpad5', 'Backspace'])(
    '%s starts the game',
    (code) => {
      expect(isStartKey({ ...PLAIN, code })).toBe(true);
    },
  );

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
    'NumLock',
    'ScrollLock',
    'Escape',
    'Tab',
    'F1',
    'F5',
    'F12',
    'F24',
    'ContextMenu',
    'PrintScreen',
    'Pause',
    'OSLeft',
    'MediaPlayPause',
    'AudioVolumeUp',
    'BrowserBack',
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

  it('goes back one level in the settings and the credits (story 2.8), whatever the pause state', () => {
    for (const appState of ['settings', 'credits'] as const) {
      for (const pauseState of PAUSE_STATES) {
        expect(escapeAction({ appState, pauseState, isPortrait: false, repeat: false })).toBe(
          'back',
        );
      }
    }
  });

  it('does not go back in portrait or on a repeat', () => {
    for (const appState of ['settings', 'credits'] as const) {
      expect(
        escapeAction({ appState, pauseState: 'paused', isPortrait: true, repeat: false }),
      ).toBe(null);
      expect(
        escapeAction({ appState, pauseState: 'paused', isPortrait: false, repeat: true }),
      ).toBe(null);
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

describe('padAction (story 1.17)', () => {
  const BUTTONS: PadButton[] = ['confirm', 'back', 'start', 'up', 'down', 'left', 'right'];
  const act = (
    appState: AppState,
    pauseState: PauseState,
    overlay: OverlayKind | null,
    button: PadButton,
  ) => padAction({ appState, pauseState, overlay, button });

  it('starts the game on A or Start from the start screen, and ignores the rest', () => {
    for (const button of BUTTONS) {
      const expected: PadAction = button === 'confirm' || button === 'start' ? 'activate' : null;
      expect(act('start', 'running', 'start', button), button).toBe(expected);
    }
  });

  it('presses « Réessayer » on A from the « Oups » screen, and ignores the rest (Start included)', () => {
    for (const button of BUTTONS) {
      expect(act('oops', 'running', 'oops', button), button).toBe(
        button === 'confirm' ? 'activate' : null,
      );
    }
  });

  it('skips or presses « Rejouer » on A from the Result screen, and ignores the rest (story 1.22)', () => {
    for (const pauseState of ['running', 'paused'] as const) {
      for (const button of BUTTONS) {
        expect(act('result', pauseState, 'result', button), button).toBe(
          button === 'confirm' ? 'activate' : null,
        );
      }
    }
  });

  it('moves the focus of the pause panel with the D-pad, activates with A, goes back with B', () => {
    expect(act('level', 'paused', 'pause', 'up')).toBe('ArrowUp');
    expect(act('level', 'paused', 'pause', 'down')).toBe('ArrowDown');
    expect(act('level', 'paused', 'pause', 'left')).toBe('ArrowLeft');
    expect(act('level', 'paused', 'pause', 'right')).toBe('ArrowRight');
    expect(act('level', 'paused', 'pause', 'confirm')).toBe('activate');
    expect(act('level', 'paused', 'pause', 'back')).toBe('back');
  });

  it('drives the settings and the credits (story 2.8): D-pad moves, A presses, B goes back, Start nothing', () => {
    for (const overlay of ['settings', 'credits'] as const) {
      const appState = overlay;
      for (const pauseState of ['paused', 'running'] as const) {
        expect(act(appState, pauseState, overlay, 'up')).toBe('ArrowUp');
        expect(act(appState, pauseState, overlay, 'down')).toBe('ArrowDown');
        expect(act(appState, pauseState, overlay, 'left')).toBe('ArrowLeft');
        expect(act(appState, pauseState, overlay, 'right')).toBe('ArrowRight');
        expect(act(appState, pauseState, overlay, 'confirm')).toBe('activate');
        expect(act(appState, pauseState, overlay, 'back')).toBe('back');
        expect(act(appState, pauseState, overlay, 'start')).toBeNull();
      }
    }
  });

  it('takes nothing over the settings in portrait', () => {
    for (const button of BUTTONS) {
      expect(act('settings', 'paused', 'portrait', button), button).toBeNull();
    }
  });

  it('does what Escape does on Start: pause, resume, or cancel the countdown', () => {
    expect(act('level', 'running', null, 'start')).toBe('pause');
    expect(act('level', 'paused', 'pause', 'start')).toBe('resume');
    expect(act('level', 'resuming', 'pause', 'start')).toBe('pause');
  });

  it('never pauses, parries or acts on B in play (D15), nor on any other button but Start', () => {
    for (const button of BUTTONS) {
      if (button === 'start') continue;
      expect(act('level', 'running', null, button), button).toBeNull();
    }
  });

  it('takes nothing but Start while the countdown runs', () => {
    for (const button of BUTTONS) {
      if (button === 'start') continue;
      expect(act('level', 'resuming', 'pause', button), button).toBeNull();
    }
  });

  it('takes nothing in portrait, over the loading screen, or with no level', () => {
    for (const button of BUTTONS) {
      for (const pauseState of ['running', 'paused', 'resuming'] as const) {
        expect(act('level', pauseState, 'portrait', button), `${pauseState} ${button}`).toBeNull();
      }
      expect(act('loading', 'running', 'loading', button), button).toBeNull();
      expect(act('boot', 'running', null, button), button).toBeNull();
      expect(act('result', 'running', null, button), button).toBeNull();
    }
  });
});
