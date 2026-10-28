import { describe, expect, it } from 'vitest';
import { createSilenceBubble, SILENCE_BUBBLE_CLASSES } from './silenceBubble.ts';

/** The few things of the DOM that the bubble touches. */
class FakeElement {
  className = '';
  textContent = '';
  hidden = false;
  readonly style: { top: string } = { top: '' };
  readonly attributes = new Map<string, string>();
  classWrites = 0;
  topWrites = 0;
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const strings: Record<string, string> = {
  'hud.silence_bubble': '…',
  'hud.silence_bubble_label': 'Silence',
};

function setup(point = { x: 700, y: 200 }, viewport = { width: 844, height: 390 }) {
  const calls: number[][] = [];
  const doc = { createElement: () => new FakeElement() } as unknown as Document;
  const bubble = createSilenceBubble(doc, {
    t: (key) => strings[key] ?? key,
    project: (xM, yM, zM, out) => {
      calls.push([xM, yM, zM]);
      out.x = point.x;
      out.y = point.y;
      return true;
    },
    viewport: () => viewport,
    targetHeightM: () => 0.2,
    hudBottomPx: () => 56,
  });
  const element = bubble.element as unknown as FakeElement;
  // Counts the writes of the two properties the bubble changes after creation.
  let className = element.className;
  let top = element.style.top;
  Object.defineProperty(element, 'className', {
    get: () => className,
    set: (value: string) => {
      className = value;
      element.classWrites++;
    },
  });
  Object.defineProperty(element.style, 'top', {
    get: () => top,
    set: (value: string) => {
      top = value;
      element.topWrites++;
    },
  });
  const world = {
    silence: { threatId: 7, zoneEnteredAt: 100, startedAt: 2100 },
    threats: [{ id: 7, xM: 1.5, zM: -2.6 }],
  } as unknown as Parameters<typeof bubble.update>[1];
  return {
    bubble,
    element,
    world,
    calls,
    setPoint: (next: { x: number; y: number }) => Object.assign(point, next),
  };
}

describe('createSilenceBubble', () => {
  it('is a hidden « … » with a spoken name, built from the strings', () => {
    const { element } = setup();
    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe('…');
    expect(element.attributes.get('aria-label')).toBe('Silence');
    expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.root);
  });

  it('shows on the edge of the side the zone is on: the right of a zone right of the centre', () => {
    const { bubble, element, world } = setup({ x: 700, y: 200 });
    bubble.update(true, world);
    expect(element.hidden).toBe(false);
    expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.right);
    expect(element.className).not.toContain(SILENCE_BUBBLE_CLASSES.left);
  });

  it('shows on the left for a zone left of the centre', () => {
    const { bubble, element, world } = setup({ x: 120, y: 200 });
    bubble.update(true, world);
    expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.left);
  });

  it('aims at the threat of the silence, at the baby, centred on the projected point', () => {
    const { bubble, world, calls, element } = setup({ x: 700, y: 200 });
    bubble.update(true, world);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(1.5);
    expect(calls[0]?.[2]).toBe(-2.6);
    expect(element.style.top).toBe('171px'); // 200 − half of 58
  });

  it('stays under the HUD row and above the bottom third', () => {
    const high = setup({ x: 700, y: -50 });
    high.bubble.update(true, high.world);
    expect(Number.parseInt(high.element.style.top, 10)).toBeGreaterThanOrEqual(56 + 8);
    const low = setup({ x: 700, y: 1000 });
    low.bubble.update(true, low.world);
    expect(Number.parseInt(low.element.style.top, 10) + 58).toBeLessThanOrEqual(390 * 0.667);
  });

  it('writes the DOM only on a change: the frames between two edges touch nothing', () => {
    const { bubble, element, world, calls } = setup();
    for (let i = 0; i < 100; i++) bubble.update(false, world);
    expect(element.classWrites).toBe(0);
    bubble.update(true, world);
    const writes = [element.classWrites, element.topWrites];
    for (let i = 0; i < 100; i++) bubble.update(true, world);
    expect([element.classWrites, element.topWrites]).toEqual(writes);
    expect(calls).toHaveLength(1);
    bubble.update(false, world);
    expect(element.hidden).toBe(true);
    for (let i = 0; i < 100; i++) bubble.update(false, world);
    expect(calls).toHaveLength(1);
  });

  it('places itself again on a resize while shown, and not while hidden', () => {
    const { bubble, element, world, calls, setPoint } = setup({ x: 700, y: 200 });
    bubble.relayout();
    expect(calls).toHaveLength(0);
    bubble.update(true, world);
    setPoint({ x: 100, y: 180 });
    bubble.relayout();
    expect(calls).toHaveLength(2);
    expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.left);
    expect(element.style.top).toBe('151px');
  });

  it('stays hidden while the point cannot be projected (no camera), places itself as soon as it can, never unplaced', () => {
    const doc = { createElement: () => new FakeElement() } as unknown as Document;
    let canProject = false;
    const bubble = createSilenceBubble(doc, {
      t: (key) => key,
      project: (_xM, _yM, _zM, out) => {
        if (!canProject) return false;
        out.x = 100;
        out.y = 180;
        return true;
      },
      viewport: () => ({ width: 800, height: 400 }),
      targetHeightM: () => 0.2,
      hudBottomPx: () => 56,
    });
    const world = {
      silence: { threatId: 1, zoneEnteredAt: 0, startedAt: 0 },
      threats: [{ id: 1, xM: 0, zM: 0 }],
    } as unknown as Parameters<typeof bubble.update>[1];
    bubble.update(true, world);
    expect(bubble.element.hidden).toBe(true);
    canProject = true;
    bubble.update(true, world);
    expect(bubble.element.hidden).toBe(false);
    expect(bubble.element.className).toContain(SILENCE_BUBBLE_CLASSES.left);
    expect(bubble.element.style.top).toBe('151px');
    bubble.update(false, undefined);
    expect(bubble.element.hidden).toBe(true);
  });

  it('falls back to the right edge under the HUD row when the silence names no known threat', () => {
    const { bubble, element } = setup();
    bubble.update(true, {
      silence: { threatId: 99, zoneEnteredAt: 0, startedAt: 0 },
      threats: [],
    } as unknown as Parameters<typeof bubble.update>[1]);
    expect(element.hidden).toBe(false);
    expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.right);
    expect(element.style.top).toBe('64px');
  });
});
