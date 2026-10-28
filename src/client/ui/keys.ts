import type { AppState } from '../app/appFsm.ts';
import type { OverlayKind } from '../app/overlay.ts';
import type { PauseState } from '../app/pauseController.ts';
import type { PadButton } from '../input/gamepadInput.ts';

/** The parts of a `KeyboardEvent` the key rules read (so tests need no DOM). */
export interface KeyLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

// Keys that are not a player's gesture: modifiers on their own, Escape (pause and back), Tab
// (moving focus), the function keys (F5 reloads, F12 opens the devtools), and the keys of the
// browser, the system and the media player.
const NOT_A_START_KEY = new Set([
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
  'ContextMenu',
  'PrintScreen',
  'Pause',
]);
const NOT_A_START_KEY_PREFIX = /^(F\d{1,2}|OS|Media|AudioVolume|Browser|Launch|Lang)/;

/**
 * Does this key press start the game from the start screen? Any key does, except the ones above, a
 * held key repeating, and a chord with Ctrl, Cmd or Alt (a browser shortcut, not a player's gesture).
 */
export function isStartKey(key: KeyLike): boolean {
  if (key.repeat || key.ctrlKey || key.metaKey || key.altKey) return false;
  return !NOT_A_START_KEY.has(key.code) && !NOT_A_START_KEY_PREFIX.test(key.code);
}

export type EscapeAction = 'pause' | 'resume';

export interface EscapeInput {
  appState: AppState;
  pauseState: PauseState;
  isPortrait: boolean;
  repeat: boolean;
}

/**
 * What Escape does (story 1.5, D14). In a level: running → pause; paused → resume; resuming →
 * pause again (it cancels the countdown and re-opens the panel). Anywhere else, in portrait, or on
 * a repeating key: nothing.
 */
export function escapeAction(input: EscapeInput): EscapeAction | null {
  if (input.repeat || input.isPortrait || input.appState !== 'level') return null;
  return input.pauseState === 'paused' ? 'resume' : 'pause';
}

/**
 * Which button gets focus after an arrow key inside a panel: Down and Right go forward, Up and
 * Left go back, both wrapping. `current` is -1 when no button has focus. Any other key: `null`.
 */
export function nextFocusIndex(count: number, current: number, code: string): number | null {
  if (!(count > 0)) return null;
  if (code === 'ArrowDown' || code === 'ArrowRight') return current < 0 ? 0 : (current + 1) % count;
  if (code === 'ArrowUp' || code === 'ArrowLeft')
    return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

export interface PadInput {
  appState: AppState;
  pauseState: PauseState;
  /** The overlay actually shown (portrait covers whatever else is due). */
  overlay: OverlayKind | null;
  button: PadButton;
}

/**
 * What a pad button does outside the sim (story 1.17, UX-DR5, UX-DR7). `pause` and `resume` are
 * what Escape does (`escapeAction`); `ArrowUp` and the like move the focus of the pause panel;
 * `activate` presses the focused button (the panel) or the screen's own action (start, « Oups »,
 * the Result screen);
 * `back` is B on the panel: it resumes. A button in play that is not Start is the mapper's or
 * nothing: B never pauses (it will dodge, story 5.1). Portrait, the loading screen and a
 * countdown take nothing, except Start, which cancels the countdown like Escape.
 */
export type PadAction =
  | 'pause'
  | 'resume'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'activate'
  | 'back'
  | null;

const PAD_FOCUS: Readonly<Partial<Record<PadButton, PadAction>>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

export function padAction(input: PadInput): PadAction {
  const { appState, pauseState, overlay, button } = input;
  if (overlay === 'start') return button === 'confirm' || button === 'start' ? 'activate' : null;
  if (overlay === 'oops') return button === 'confirm' ? 'activate' : null;
  // A skips the Result sequence, then presses « Rejouer » (the screen's own `activate`).
  if (overlay === 'result') return button === 'confirm' ? 'activate' : null;
  if (appState !== 'level') return null;
  if (button === 'start') {
    if (overlay !== null && overlay !== 'pause') return null;
    return escapeAction({ appState, pauseState, isPortrait: false, repeat: false });
  }
  if (overlay !== 'pause' || pauseState !== 'paused') return null;
  if (button === 'confirm') return 'activate';
  if (button === 'back') return 'back';
  return PAD_FOCUS[button] ?? null;
}
