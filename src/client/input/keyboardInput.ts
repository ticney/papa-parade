/**
 * Movement keys, bound by `KeyboardEvent.code` (the physical position of the key), never by
 * `event.key`: ZQSD on an AZERTY keyboard and WASD on a QWERTY one are the same four keys, so
 * neither needs a setting. The arrows always work.
 */
export const MOVE_KEY_CODES = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;

/**
 * The action key (story 1.17): Space parries the auto-targeted threat, or acts on the nearest
 * object. Bound by code like the movement keys; the chip may show a localised name for it.
 */
export const ACTION_KEY_CODES = ['Space'] as const;

export function isActionKey(code: string): boolean {
  return (ACTION_KEY_CODES as readonly string[]).includes(code);
}

const ALL_MOVE_CODES: ReadonlySet<string> = new Set([
  ...MOVE_KEY_CODES.up,
  ...MOVE_KEY_CODES.down,
  ...MOVE_KEY_CODES.left,
  ...MOVE_KEY_CODES.right,
]);

export function isMoveKey(code: string): boolean {
  return ALL_MOVE_CODES.has(code);
}

/** The few fields of a `KeyboardEvent` the held-keys state reads. */
export interface KeySample {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** The movement keys held right now. Pure: no DOM, tested with samples. */
export interface HeldKeys {
  readonly held: ReadonlySet<string>;
  /**
   * A key went down. Returns true when it changed what is held. An auto-repeat does not, nor does
   * a key of a chord with Ctrl, Cmd or Alt (a browser shortcut, not movement).
   */
  keyDown(sample: KeySample): boolean;
  /** A key went up. It always releases, chord or not: a key must never stay stuck. Returns true on a change. */
  keyUp(code: string): boolean;
  /** Releases everything (the window lost focus). Returns true if anything was held. */
  clear(): boolean;
}

export function createHeldKeys(): HeldKeys {
  const held = new Set<string>();
  return {
    held,
    keyDown(sample) {
      if (!isMoveKey(sample.code) || sample.repeat) return false;
      if (sample.ctrlKey || sample.metaKey || sample.altKey) return false;
      if (held.has(sample.code)) return false;
      held.add(sample.code);
      return true;
    },
    keyUp(code) {
      return held.delete(code);
    },
    clear() {
      if (held.size === 0) return false;
      held.clear();
      return true;
    },
  };
}

/** The slice of `window` and `document` the keyboard binding listens on. */
export interface KeyboardEventTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  addEventListener(type: 'blur', listener: (event: Event) => void): void;
  removeEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
  removeEventListener(type: 'blur', listener: (event: Event) => void): void;
}

export interface VisibilityTarget {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: (event: Event) => void): void;
  removeEventListener(type: 'visibilitychange', listener: (event: Event) => void): void;
}

export interface KeyboardBindings {
  /** Called with the event's timestamp whenever the held keys changed. */
  onChange(timeStampMs: number): void;
  /**
   * Whether a level is being played right now. Only then is a movement key's default action (page
   * scroll with the arrows) cancelled: during a pause the arrows belong to the panel's focus.
   */
  isLive(): boolean;
  /**
   * The action key (Space) went down (`down`: not a repeat, no Ctrl, Cmd or Alt) or up (`up`: every
   * keyup, chord or not, and the window losing focus or the page hiding while it is down, so that a
   * lost keyup never holds a threat). `timeStampAtReal` is the event's timestamp. The consumer gates
   * on a live level: Space on the pause panel keeps its native activation.
   */
  onAction?(phase: 'down' | 'up', timeStampAtReal: number): void;
}

/**
 * Binds `keydown`, `keyup`, window `blur` and the page going hidden to a {@link HeldKeys}. Held
 * keys are tracked at all times; the gate is the consumer's. A lost `keyup` (alt-tab, a hidden tab)
 * must not walk Papa forever, hence the two clears. Returns the function that unbinds.
 */
export function bindKeyboard(
  keys: HeldKeys,
  windowTarget: KeyboardEventTarget,
  documentTarget: VisibilityTarget,
  bindings: KeyboardBindings,
): () => void {
  // Space is down (from a non-repeat keydown to its keyup): a lost keyup is made up for on blur.
  let isActionDown = false;
  const releaseAction = (timeStampAtReal: number): void => {
    if (!isActionDown) return;
    isActionDown = false;
    bindings.onAction?.('up', timeStampAtReal);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    // macOS sends no `keyup` for a key released while Cmd is down: pressing Cmd lets go of everything.
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      if (keys.clear()) bindings.onChange(event.timeStamp);
      releaseAction(event.timeStamp);
      return;
    }
    if (isActionKey(event.code)) {
      const isChord = event.ctrlKey || event.metaKey || event.altKey;
      if (!event.repeat && !isChord) {
        isActionDown = true;
        bindings.onAction?.('down', event.timeStamp);
      }
      // The page scroll of Space is cancelled while playing; on a panel it activates the focused button.
      if (!isChord && bindings.isLive()) event.preventDefault();
      return;
    }
    if (!isMoveKey(event.code)) return;
    const changed = keys.keyDown(event);
    // The chord check already ran inside `keyDown`; a chord or a repeat of a held key is not a change.
    if (changed) bindings.onChange(event.timeStamp);
    if (!(event.ctrlKey || event.metaKey || event.altKey) && bindings.isLive()) {
      event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (isActionKey(event.code)) {
      // Every keyup, even one whose keydown we never saw (the Space that started the game): the
      // consumer ends a press only if it holds one.
      isActionDown = false;
      bindings.onAction?.('up', event.timeStamp);
      return;
    }
    if (keys.keyUp(event.code)) bindings.onChange(event.timeStamp);
  };
  const onBlur = (event: Event): void => {
    if (keys.clear()) bindings.onChange(event.timeStamp);
    releaseAction(event.timeStamp);
  };
  const onVisibility = (event: Event): void => {
    if (documentTarget.visibilityState !== 'hidden') return;
    if (keys.clear()) bindings.onChange(event.timeStamp);
    releaseAction(event.timeStamp);
  };
  windowTarget.addEventListener('keydown', onKeyDown);
  windowTarget.addEventListener('keyup', onKeyUp);
  windowTarget.addEventListener('blur', onBlur);
  documentTarget.addEventListener('visibilitychange', onVisibility);
  return () => {
    windowTarget.removeEventListener('keydown', onKeyDown);
    windowTarget.removeEventListener('keyup', onKeyUp);
    windowTarget.removeEventListener('blur', onBlur);
    documentTarget.removeEventListener('visibilitychange', onVisibility);
  };
}
