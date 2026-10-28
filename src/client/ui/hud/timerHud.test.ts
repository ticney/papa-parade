import { describe, expect, it } from 'vitest';
import { createTimerHud, formatClock } from './timerHud.ts';

/** The few things of the DOM that the timer touches. */
class FakeNode {
  className = '';
  textContent = '';
  textWrites = 0;
  attributes = new Map<string, string>();
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  prepend(...nodes: FakeNode[]): void {
    for (const node of nodes) node.parent = this;
    this.children.unshift(...nodes);
  }
  replaceWith(next: FakeNode): void {
    const siblings = this.parent?.children;
    if (siblings === undefined) return;
    siblings[siblings.indexOf(this)] = next;
    next.parent = this.parent;
    this.parent = null;
  }
  /** Every node of the tree below, this one included. */
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

function build() {
  const doc = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  } as unknown as Pick<Document, 'createElement' | 'createElementNS'>;
  const strings: Record<string, string> = { 'hud.timer_variant_nap': 'Sieste' };
  const hud = createTimerHud(doc, { t: (key) => strings[key] ?? key });
  return { hud, root: hud.element as unknown as FakeNode };
}

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [1, '0:01'],
    [9, '0:09'],
    [59, '0:59'],
    [60, '1:00'],
    [61, '1:01'],
    [167, '2:47'],
    [180, '3:00'],
    [600, '10:00'],
  ])('%d s reads %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });

  it('floors a fraction and never goes below 0:00', () => {
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('createTimerHud', () => {
  it('is a timer pill: role, class, and digits in the numeric type', () => {
    const { root } = build();
    expect(root.className).toBe('pp-hud-timer');
    expect(root.attributes.get('role')).toBe('timer');
    const digits = root.children.find((child) => child.className.includes('pp-hud-timer-digits'));
    expect(digits?.className).toContain('pp-type-numeric');
    expect(digits?.tag).toBe('span');
  });

  it('puts the variant icon before the digits, hidden from assistive technology', () => {
    const { hud, root } = build();
    hud.setVariant('nap');
    expect(root.children.map((child) => child.tag)).toEqual(['svg', 'span']);
    const icon = root.children[0] as FakeNode;
    expect(icon.attributes.get('aria-hidden')).toBe('true');
    expect(icon.attributes.get('focusable')).toBe('false');
    expect(icon.attributes.get('viewBox')).toBe('0 0 28 28');
    // A head, a hair bun, two closed eyes and a Z.
    expect(icon.children.map((child) => child.className)).toEqual([
      'pp-hud-timer-face',
      'pp-hud-timer-bun',
      'pp-hud-timer-line',
      'pp-hud-timer-line',
    ]);
  });

  it('replaces the icon, never adds a second, when the variant is set again', () => {
    const { hud, root } = build();
    hud.setVariant('nap');
    const first = root.children[0];
    hud.setVariant('nap');
    expect(root.children).toHaveLength(2);
    expect(root.children[0]).not.toBe(first);
  });

  it('shows the time as m:ss and says the variant and the time in its aria-label', () => {
    const { hud, root } = build();
    hud.setVariant('nap');
    hud.setRemainingS(167);
    const digits = root.children[1] as FakeNode;
    expect(digits.textContent).toBe('2:47');
    expect(root.attributes.get('aria-label')).toBe('Sieste, 2:47');
    hud.setRemainingS(0);
    expect(digits.textContent).toBe('0:00');
    expect(root.attributes.get('aria-label')).toBe('Sieste, 0:00');
  });

  it('says only the time before a variant is set, and the variant once it is', () => {
    const { hud, root } = build();
    hud.setRemainingS(180);
    expect(root.attributes.get('aria-label')).toBe('3:00');
    hud.setVariant('nap');
    expect(root.attributes.get('aria-label')).toBe('Sieste, 3:00');
  });

  it('stays small: the pill, its icon and its digits are well within the HUD node budget', () => {
    const { hud, root } = build();
    hud.setVariant('nap');
    expect(root.all().length).toBeLessThanOrEqual(8);
  });

  it('puts no colour in the markup: the icon takes its colours from CSS classes', () => {
    const { hud, root } = build();
    hud.setVariant('nap');
    for (const node of root.all()) {
      expect(node.attributes.has('fill')).toBe(false);
      expect(node.attributes.has('stroke')).toBe(false);
      expect(node.attributes.has('style')).toBe(false);
    }
  });
});
