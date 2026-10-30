import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPauseScreen } from './pauseScreen.ts';

type Listener = (event: unknown) => void;

// The little of the DOM the pause screen and its press buttons use; the node environment has none.
class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  type = '';
  isConnected = false;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  classList = { add: () => undefined, remove: () => undefined, toggle: () => undefined };
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
  focus(): void {
    fakeDocument.activeElement = this;
  }
  click(): void {
    // A keyboard or assistive-technology activation: `click` with `detail` 0.
    for (const listener of this.listeners.get('click') ?? []) listener({ detail: 0 });
  }
}

const fakeDocument: { activeElement: FakeElement | null; createElement(): FakeElement } = {
  activeElement: null,
  createElement: () => new FakeElement(),
};

function build(mode: 'panel' | 'countdown' = 'panel') {
  const calls: string[] = [];
  const screen = createPauseScreen({
    t: (key) => key,
    mode,
    events: { emit: () => undefined } as never,
    onResume: () => calls.push('resume'),
    onRestart: () => calls.push('restart'),
    onSettings: () => calls.push('settings'),
  });
  const root = screen.element as unknown as FakeElement;
  const panel = root.children[0] as FakeElement;
  const note = panel.children[1] as FakeElement;
  const buttons = (panel.children[2] as FakeElement).children;
  return { screen, calls, note, buttons };
}

describe('createPauseScreen: the pad (story 1.17)', () => {
  beforeEach(() => {
    fakeDocument.activeElement = null;
    vi.stubGlobal('document', fakeDocument);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('setPadDisconnected', () => {
    it('shows the line and hides it again, empty', () => {
      const { screen, note } = build();
      expect(note.hidden).toBe(true);
      screen.setPadDisconnected(true);
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe('pause.gamepad_disconnected');
      screen.setPadDisconnected(false);
      expect(note.hidden).toBe(true);
      expect(note.textContent).toBe('');
    });

    it('is idempotent: asking for what is already so changes nothing', () => {
      const { screen, note } = build();
      screen.setPadDisconnected(false);
      expect(note.hidden).toBe(true);
      screen.setPadDisconnected(true);
      note.textContent = 'kept';
      screen.setPadDisconnected(true);
      expect(note.textContent).toBe('kept');
    });

    it('is a status for assistive technology', () => {
      expect(build().note.attributes.get('role')).toBe('status');
    });
  });

  describe('activateFocused', () => {
    it('presses the focused button', () => {
      const { screen, calls, buttons } = build();
      buttons[1]?.focus();
      expect(screen.activateFocused()).toBe(true);
      expect(calls).toEqual(['restart']);
    });

    it('presses the first button when none has focus', () => {
      const { screen, calls } = build();
      expect(screen.activateFocused()).toBe(true);
      expect(calls).toEqual(['resume']);
    });

    it('takes nothing during the countdown', () => {
      const { screen, calls } = build('countdown');
      expect(screen.activateFocused()).toBe(false);
      expect(calls).toEqual([]);
    });
  });

  describe('the actions (story 2.8)', () => {
    it('lists Reprendre, Recommencer and Réglages, in that order', () => {
      const { buttons } = build();
      expect(buttons.map((button) => button.textContent)).toEqual([
        'pause.resume',
        'pause.restart',
        'pause.settings',
      ]);
    });

    it('opens the settings from the third button', () => {
      const { screen, calls, buttons } = build();
      buttons[2]?.focus();
      screen.activateFocused();
      expect(calls).toEqual(['settings']);
    });
  });

  describe('moveFocus', () => {
    it('moves the focus like the arrow keys, wrapping', () => {
      const { screen, buttons } = build();
      buttons[0]?.focus();
      expect(screen.moveFocus('ArrowDown')).toBe(true);
      expect(fakeDocument.activeElement).toBe(buttons[1]);
      expect(screen.moveFocus('ArrowDown')).toBe(true);
      expect(fakeDocument.activeElement).toBe(buttons[2]);
      expect(screen.moveFocus('ArrowDown')).toBe(true);
      expect(fakeDocument.activeElement).toBe(buttons[0]);
      expect(screen.moveFocus('ArrowUp')).toBe(true);
      expect(fakeDocument.activeElement).toBe(buttons[2]);
    });

    it('ignores other keys and the countdown', () => {
      const panel = build();
      expect(panel.screen.moveFocus('KeyA')).toBe(false);
      expect(build('countdown').screen.moveFocus('ArrowDown')).toBe(false);
    });
  });

  describe('back', () => {
    it('resumes from the panel', () => {
      const { screen, calls } = build();
      screen.back();
      expect(calls).toEqual(['resume']);
    });

    it('does nothing during the countdown', () => {
      const { screen, calls } = build('countdown');
      screen.back();
      expect(calls).toEqual([]);
    });
  });
});
