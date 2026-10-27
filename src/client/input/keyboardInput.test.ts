import { describe, expect, it } from 'vitest';
import {
  ACTION_KEY_CODES,
  bindKeyboard,
  createHeldKeys,
  isActionKey,
  isMoveKey,
  type KeyboardEventTarget,
  type KeySample,
  MOVE_KEY_CODES,
  type VisibilityTarget,
} from './keyboardInput.ts';

const key = (code: string, extra: Partial<KeySample> = {}): KeySample => ({
  code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe('MOVE_KEY_CODES', () => {
  it('binds the physical keys W A S D and the four arrows, by code', () => {
    expect(MOVE_KEY_CODES).toEqual({
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
    });
    for (const code of [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]) {
      expect(isMoveKey(code)).toBe(true);
    }
  });

  it('does not bind the letters of an AZERTY layout: KeyZ and KeyQ are other physical keys', () => {
    expect(isMoveKey('KeyZ')).toBe(false);
    expect(isMoveKey('KeyQ')).toBe(false);
    expect(isMoveKey('Space')).toBe(false);
  });
});

describe('ACTION_KEY_CODES (story 1.17)', () => {
  it('binds the space bar by code', () => {
    expect([...ACTION_KEY_CODES]).toEqual(['Space']);
    expect(isActionKey('Space')).toBe(true);
    expect(isActionKey('Enter')).toBe(false);
    expect(isActionKey('KeyW')).toBe(false);
  });
});

describe('createHeldKeys', () => {
  it('holds a key from keydown to keyup, and says when that changed something', () => {
    const keys = createHeldKeys();
    expect(keys.keyDown(key('KeyD'))).toBe(true);
    expect([...keys.held]).toEqual(['KeyD']);
    expect(keys.keyUp('KeyD')).toBe(true);
    expect(keys.held.size).toBe(0);
    expect(keys.keyUp('KeyD')).toBe(false);
  });

  it('ignores an auto-repeat and a key that is already held', () => {
    const keys = createHeldKeys();
    keys.keyDown(key('KeyW'));
    expect(keys.keyDown(key('KeyW', { repeat: true }))).toBe(false);
    expect(keys.keyDown(key('KeyW'))).toBe(false);
    expect(keys.held.size).toBe(1);
  });

  it('does not take a repeat as a first press', () => {
    const keys = createHeldKeys();
    expect(keys.keyDown(key('KeyW', { repeat: true }))).toBe(false);
    expect(keys.held.size).toBe(0);
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['altKey', { altKey: true }],
  ])('a chord with %s is not movement', (_name, extra) => {
    const keys = createHeldKeys();
    expect(keys.keyDown(key('KeyA', extra))).toBe(false);
    expect(keys.held.size).toBe(0);
  });

  it('keyup always releases, even after a chord began (no stuck key)', () => {
    const keys = createHeldKeys();
    keys.keyDown(key('KeyD'));
    expect(keys.keyUp('KeyD')).toBe(true);
    expect(keys.held.has('KeyD')).toBe(false);
  });

  it('ignores keys that are not movement keys', () => {
    const keys = createHeldKeys();
    expect(keys.keyDown(key('Space'))).toBe(false);
    expect(keys.keyDown(key('KeyE'))).toBe(false);
    expect(keys.held.size).toBe(0);
  });

  it('clear releases everything, and says whether anything was held', () => {
    const keys = createHeldKeys();
    expect(keys.clear()).toBe(false);
    keys.keyDown(key('KeyW'));
    keys.keyDown(key('KeyD'));
    expect(keys.clear()).toBe(true);
    expect(keys.held.size).toBe(0);
  });
});

describe('bindKeyboard', () => {
  type Listener = (event: never) => void;
  function fakeTargets() {
    const listeners = new Map<string, Set<Listener>>();
    const add = (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    };
    const remove = (type: string, listener: Listener) => listeners.get(type)?.delete(listener);
    const windowTarget = {
      addEventListener: add,
      removeEventListener: remove,
    } as unknown as KeyboardEventTarget;
    const documentTarget = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: add,
      removeEventListener: remove,
    } as unknown as VisibilityTarget & { visibilityState: DocumentVisibilityState };
    const fire = (type: string, event: object) => {
      for (const listener of listeners.get(type) ?? []) (listener as (e: object) => void)(event);
    };
    return { windowTarget, documentTarget, fire, listeners };
  }

  function setup(isLive = true) {
    const targets = fakeTargets();
    const keys = createHeldKeys();
    const changes: number[] = [];
    const actions: string[] = [];
    let live = isLive;
    const unbind = bindKeyboard(keys, targets.windowTarget, targets.documentTarget, {
      onChange: (timeStampMs) => changes.push(timeStampMs),
      isLive: () => live,
      onAction: (phase, timeStampAtReal) => actions.push(`${phase}@${timeStampAtReal}`),
    });
    const press = (code: string, extra: Record<string, unknown> = {}) => {
      const event = {
        code,
        repeat: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        timeStamp: 100,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...extra,
      };
      targets.fire('keydown', event);
      return event;
    };
    return {
      ...targets,
      keys,
      changes,
      actions,
      unbind,
      press,
      setLive: (value: boolean) => (live = value),
    };
  }

  it('lets go of every key when Cmd goes down: macOS sends no keyup for them afterwards', () => {
    const { press, keys, changes } = setup();
    press('KeyD', { timeStamp: 10 });
    press('KeyW', { timeStamp: 20 });
    expect(keys.held.size).toBe(2);
    press('MetaLeft', { timeStamp: 30, metaKey: true });
    expect(keys.held.size).toBe(0);
    expect(changes).toEqual([10, 20, 30]);
    press('MetaRight', { timeStamp: 40, metaKey: true }); // nothing held: no change
    expect(changes).toEqual([10, 20, 30]);
  });

  it('reports each change once, with the event timestamp', () => {
    const { press, fire, changes } = setup();
    press('KeyD', { timeStamp: 10 });
    press('KeyD', { timeStamp: 20, repeat: true });
    fire('keyup', { code: 'KeyD', timeStamp: 30 });
    fire('keyup', { code: 'KeyD', timeStamp: 40 });
    expect(changes).toEqual([10, 30]);
  });

  it('cancels the default action of a movement key only while a level is live', () => {
    const { press, setLive } = setup(true);
    expect(press('ArrowUp').defaultPrevented).toBe(true);
    expect(press('ArrowUp', { repeat: true }).defaultPrevented).toBe(true);
    expect(press('KeyE').defaultPrevented).toBe(false);
    setLive(false);
    expect(press('ArrowDown').defaultPrevented).toBe(false);
  });

  it('leaves a chord alone: it is not movement and the browser keeps it', () => {
    const { press, changes, keys } = setup();
    const event = press('KeyA', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(changes).toEqual([]);
    expect(keys.held.size).toBe(0);
  });

  it("keeps tracking keys when no level is live (the gate is the consumer's)", () => {
    const { press, keys, changes } = setup(false);
    press('KeyW');
    expect(keys.held.has('KeyW')).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it('clears the keys when the window loses focus, and when the page becomes hidden', () => {
    const { press, fire, keys, changes, documentTarget } = setup();
    press('KeyD');
    fire('blur', { timeStamp: 50 });
    expect(keys.held.size).toBe(0);
    expect(changes).toEqual([100, 50]);

    press('KeyA');
    fire('visibilitychange', { timeStamp: 60 }); // still visible: nothing
    expect(keys.held.size).toBe(1);
    documentTarget.visibilityState = 'hidden';
    fire('visibilitychange', { timeStamp: 70 });
    expect(keys.held.size).toBe(0);
    expect(changes).toEqual([100, 50, 100, 70]);
    fire('blur', { timeStamp: 80 }); // nothing held: no change to report
    expect(changes).toHaveLength(4);
  });

  it('unbinds everything', () => {
    const { unbind, listeners } = setup();
    unbind();
    for (const set of listeners.values()) expect(set.size).toBe(0);
  });

  describe('the action key (story 1.17)', () => {
    it('reports Space down once, with the event timestamp, and up on its keyup', () => {
      const { press, fire, actions } = setup();
      press('Space', { timeStamp: 10 });
      press('Space', { timeStamp: 20, repeat: true });
      fire('keyup', { code: 'Space', timeStamp: 30 });
      expect(actions).toEqual(['down@10', 'up@30']);
    });

    it('ignores a chord on the way down but not on the way up', () => {
      const { press, fire, actions } = setup();
      for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        const event = press('Space', { [modifier]: true });
        expect(event.defaultPrevented).toBe(false);
      }
      expect(actions).toEqual([]);
      // A Space pressed alone, then Ctrl added before it goes up: the keyup still releases.
      press('Space', { timeStamp: 40 });
      fire('keyup', { code: 'Space', timeStamp: 50, ctrlKey: true });
      expect(actions).toEqual(['down@40', 'up@50']);
    });

    it('cancels the page scroll only while a level is live', () => {
      const { press, setLive } = setup(true);
      expect(press('Space').defaultPrevented).toBe(true);
      expect(press('Space', { repeat: true }).defaultPrevented).toBe(true);
      setLive(false);
      expect(press('Space').defaultPrevented).toBe(false);
    });

    it('still reports Space when no level is live (the consumer gates), without cancelling it', () => {
      const { press, actions } = setup(false);
      const event = press('Space', { timeStamp: 5 });
      expect(event.defaultPrevented).toBe(false);
      expect(actions).toEqual(['down@5']);
    });

    it('reports a keyup whose keydown it never saw (the Space that started the game)', () => {
      const { fire, actions } = setup();
      fire('keyup', { code: 'Space', timeStamp: 9 });
      expect(actions).toEqual(['up@9']);
    });

    it('lets go on blur, on a hidden page and when Cmd goes down, only if Space is down', () => {
      const { press, fire, actions, documentTarget } = setup();
      fire('blur', { timeStamp: 1 });
      expect(actions).toEqual([]);
      press('Space', { timeStamp: 10 });
      fire('blur', { timeStamp: 20 });
      fire('blur', { timeStamp: 21 }); // already released
      press('Space', { timeStamp: 30 });
      fire('visibilitychange', { timeStamp: 35 }); // still visible
      documentTarget.visibilityState = 'hidden';
      fire('visibilitychange', { timeStamp: 40 });
      documentTarget.visibilityState = 'visible';
      press('Space', { timeStamp: 50 });
      press('MetaLeft', { timeStamp: 60, metaKey: true });
      expect(actions).toEqual(['down@10', 'up@20', 'down@30', 'up@40', 'down@50', 'up@60']);
    });

    it('does not touch the held movement keys, and a movement key does not act', () => {
      const { press, fire, keys, changes, actions } = setup();
      press('KeyD', { timeStamp: 10 });
      press('Space', { timeStamp: 20 });
      fire('keyup', { code: 'Space', timeStamp: 30 });
      expect(keys.held.has('KeyD')).toBe(true);
      expect(changes).toEqual([10]);
      expect(actions).toEqual(['down@20', 'up@30']);
    });

    it('works without an onAction binding', () => {
      const targets = fakeTargets();
      bindKeyboard(createHeldKeys(), targets.windowTarget, targets.documentTarget, {
        onChange: () => {},
        isLive: () => true,
      });
      expect(() => {
        targets.fire('keydown', { code: 'Space', repeat: false, preventDefault() {} });
        targets.fire('keyup', { code: 'Space' });
      }).not.toThrow();
    });
  });
});
