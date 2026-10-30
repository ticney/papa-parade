import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCreditsScreen } from './creditsScreen.ts';

type Listener = (event: unknown) => void;

// The little of the DOM the credits screen and its press button use; the node environment has none.
class FakeElement {
  className = '';
  textContent = '';
  type = '';
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
  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener({ detail: 0 });
  }
}

function build() {
  const calls: string[] = [];
  const screen = createCreditsScreen({ t: (key) => key, onBack: () => calls.push('back') });
  const panel = (screen.element as unknown as FakeElement).children[0] as FakeElement;
  const [title, body, actions] = panel.children as [FakeElement, FakeElement, FakeElement];
  return { screen, calls, panel, title, body, back: actions.children[0] as FakeElement };
}

describe('createCreditsScreen (story 2.8)', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a modal dialog with the credits title and the placeholder body', () => {
    const { panel, title, body } = build();
    expect(panel.attributes.get('role')).toBe('dialog');
    expect(panel.attributes.get('aria-modal')).toBe('true');
    expect(panel.attributes.get('aria-label')).toBe('credits.title');
    expect(title.textContent).toBe('credits.title');
    expect(body.textContent).toBe('credits.body');
  });

  it('puts the focus on Retour', () => {
    const { screen, back } = build();
    expect(screen.initialFocus).toBe(back as unknown as HTMLElement);
    expect(back.textContent).toBe('settings.back');
  });

  it('goes back on Retour, on A and on B or Escape', () => {
    const { screen, back, calls } = build();
    back.click();
    screen.activate?.();
    screen.back?.();
    expect(calls).toEqual(['back', 'back', 'back']);
  });

  it('unbinds Retour on dispose', () => {
    const { screen, back, calls } = build();
    screen.dispose();
    back.click();
    expect(calls).toEqual([]);
  });
});
