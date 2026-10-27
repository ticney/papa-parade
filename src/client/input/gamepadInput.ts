import {
  PAD_BUTTON_BACK,
  PAD_BUTTON_CONFIRM,
  PAD_BUTTON_DPAD_DOWN,
  PAD_BUTTON_DPAD_LEFT,
  PAD_BUTTON_DPAD_RIGHT,
  PAD_BUTTON_DPAD_UP,
  PAD_BUTTON_START,
  PAD_STAMP_MAX_AGE_MS,
} from '@shared/constants';
import { log } from '@shared/log';

/** The few fields of a `Gamepad` the left stick and the buttons need. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly axes: ArrayLike<number>;
  /** `'standard'` for a pad with the standard layout (left stick on axes 0 and 1). */
  readonly mapping?: string;
  /** The vendor and product, e.g. `054c-0ce6-DualSense…` (Firefox) or `… (Vendor: 054c …)` (Chrome). */
  readonly id?: string;
  /** When the pad last changed, in ms on the `performance.now()` base (Chromium); 0 or absent: unknown. */
  readonly timestamp?: number;
  readonly buttons?: ArrayLike<{ readonly pressed: boolean }>;
}

/** Left-stick axes of the standard mapping: `x` to the right, `y` DOWN, each in `[-1, 1]`. */
export interface StickAxes {
  x: number;
  y: number;
}

/** The buttons the game reads, named by their role (standard layout: 0, 1, 9 and 12 to 15). */
export type PadButton = 'confirm' | 'back' | 'start' | 'up' | 'down' | 'left' | 'right';

/** Every `PadButton`, in the order of `BUTTON_INDEX`. */
export const PAD_BUTTONS: readonly PadButton[] = [
  'confirm',
  'back',
  'start',
  'up',
  'down',
  'left',
  'right',
];

/** Standard-layout index of each entry of `PAD_BUTTONS` (W3C Gamepad › Standard Gamepad layout). */
const BUTTON_INDEX: readonly number[] = [
  PAD_BUTTON_CONFIRM,
  PAD_BUTTON_BACK,
  PAD_BUTTON_START,
  PAD_BUTTON_DPAD_UP,
  PAD_BUTTON_DPAD_DOWN,
  PAD_BUTTON_DPAD_LEFT,
  PAD_BUTTON_DPAD_RIGHT,
];

/** Whose glyphs the player knows: PlayStation (✕ ○) or the Xbox style everything else gets (A B). */
export type PadFamily = 'xbox' | 'playstation';

/**
 * The family of a pad from its `Gamepad.id` (D11 of story 1.17): `054c` is Sony's USB vendor id
 * (Chrome writes `Vendor: 054c`, Firefox `054c-0ce6-…`). Anything else, an empty id included, is
 * Xbox-style.
 */
export function padFamily(id: string): PadFamily {
  return /054c|playstation|dualshock|dualsense/i.test(id) ? 'playstation' : 'xbox';
}

/** What a poll saw of the selected pad, besides its stick. One object, reused: nothing allocates. */
export interface PadState {
  /** A pad is connected and selected. False after it was true is the disconnect signal. */
  isPresent: boolean;
  family: PadFamily;
  /**
   * The real time (the base of `event.timeStamp`) to stamp a press read in this poll with (D5): the
   * pad's own timestamp when it is recent and not in the future, else the time of the poll.
   */
  stampAtReal: number;
  /** Buttons that went down since the previous poll. A held button is no new press. */
  readonly pressed: Record<PadButton, boolean>;
  /** Buttons that went up since the previous poll. */
  readonly released: Record<PadButton, boolean>;
}

export function createPadState(): PadState {
  const flags = (): Record<PadButton, boolean> => ({
    confirm: false,
    back: false,
    start: false,
    up: false,
    down: false,
    left: false,
    right: false,
  });
  return {
    isPresent: false,
    family: 'xbox',
    stampAtReal: 0,
    pressed: flags(),
    released: flags(),
  };
}

export interface GamepadInput {
  /**
   * Reads the left stick of the first connected pad with the standard mapping into `stick`, else of
   * the first connected pad that reports two axes; (0, 0) when there is none, so a pad that
   * disappears is simply "no direction". When `state` is given it is filled with the pad's
   * presence, family and button edges (standard-mapping pads only). Meant to be called once per
   * frame, whether or not a level is live: edges are relative to the previous poll.
   */
  poll(stick: StickAxes, state?: PadState): void;
}

/**
 * Gamepad API polling, with `getGamepads` injected (`navigator.getGamepads` in the browser) and
 * `nowAtReal` (`performance.now()`): a `Gamepad` is a snapshot in Chrome, so no pad is kept between
 * two polls, only which buttons were down. Buttons are read on a standard-mapping pad only (D12);
 * another pad keeps its stick and is said once.
 */
export function createGamepadInput(
  getGamepads: () => ArrayLike<GamepadLike | null | undefined>,
  nowAtReal: () => number = () => performance.now(),
): GamepadInput {
  // The previous poll's buttons, to turn levels into edges. `-1` is no pad selected.
  const wasDown: boolean[] = BUTTON_INDEX.map(() => false);
  let selectedIndex = -1;
  let selectedId: string | null = null;
  let family: PadFamily = 'xbox';
  const warnedIds = new Set<string>();

  return {
    poll(stick, state) {
      stick.x = 0;
      stick.y = 0;
      if (state !== undefined) {
        state.isPresent = false;
        for (let b = 0; b < PAD_BUTTONS.length; b++) {
          const button = PAD_BUTTONS[b] as PadButton;
          state.pressed[button] = false;
          state.released[button] = false;
        }
      }
      const pads = getGamepads();
      let fallback: GamepadLike | null = null;
      let fallbackIndex = -1;
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad === null || pad === undefined || !pad.connected) continue;
        // A pad that reports no usable stick is not "the" pad: keep looking.
        if (typeof pad.axes[0] !== 'number' || typeof pad.axes[1] !== 'number') continue;
        if (pad.mapping === 'standard') {
          fallback = pad;
          fallbackIndex = i;
          break;
        }
        // A wheel or a motion sensor can sit before a real pad: only use it when nothing better exists.
        if (fallback === null) {
          fallback = pad;
          fallbackIndex = i;
        }
      }
      if (fallback === null) {
        // Nothing is held on a pad that is gone: the next one starts from scratch.
        selectedIndex = -1;
        selectedId = null;
        return;
      }
      const x = fallback.axes[0] as number;
      const y = fallback.axes[1] as number;
      stick.x = Number.isFinite(x) ? x : 0;
      stick.y = Number.isFinite(y) ? y : 0;

      const isStandard = fallback.mapping === 'standard';
      const id = fallback.id ?? '';
      const isNewSelection = fallbackIndex !== selectedIndex || id !== selectedId;
      if (isNewSelection) {
        selectedIndex = fallbackIndex;
        selectedId = id;
        family = padFamily(id);
        if (!isStandard && !warnedIds.has(id)) {
          warnedIds.add(id);
          log.warn(
            'input',
            'this gamepad has no standard mapping: its stick works, its buttons do not',
            {
              id,
            },
          );
        }
      }
      const buttons = isStandard ? fallback.buttons : undefined;
      // Which buttons are down now; a newly selected pad's held buttons are no new press.
      let anyEdge = false;
      for (let b = 0; b < BUTTON_INDEX.length; b++) {
        const isDown = buttons?.[BUTTON_INDEX[b] as number]?.pressed === true;
        if (!isNewSelection && state !== undefined && isDown !== wasDown[b]) {
          const button = PAD_BUTTONS[b] as PadButton;
          if (isDown) state.pressed[button] = true;
          else state.released[button] = true;
          anyEdge = true;
        }
        wasDown[b] = isDown;
      }
      if (state === undefined) return;
      state.isPresent = true;
      state.family = family;
      const now = nowAtReal();
      const stamp = fallback.timestamp;
      state.stampAtReal =
        anyEdge &&
        typeof stamp === 'number' &&
        Number.isFinite(stamp) &&
        stamp > 0 &&
        stamp <= now &&
        stamp >= now - PAD_STAMP_MAX_AGE_MS
          ? stamp
          : now;
    },
  };
}
