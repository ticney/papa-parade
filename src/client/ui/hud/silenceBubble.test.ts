import { log } from '@shared/log';
import { describe, expect, it } from 'vitest';
import {
  createSilenceBubble,
  SILENCE_BUBBLE_CLASSES,
  SILENCE_RING_CLASSES,
} from './silenceBubble.ts';

/** The few things of the DOM that the bubble touches. */
class FakeElement {
  className = '';
  textContent = '';
  hidden = false;
  readonly vars = new Map<string, string>();
  varWrites: Record<string, number> = {};
  readonly style: { top: string; setProperty(name: string, value: string): void } = {
    top: '',
    setProperty: (name, value) => {
      this.vars.set(name, value);
      this.varWrites[name] = (this.varWrites[name] ?? 0) + 1;
    },
  };
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  classWrites = 0;
  topWrites = 0;
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    for (const child of children) child.parentNode = this;
    this.children.push(...children);
  }
  /** `ChildNode.after`: a sibling right behind this element, in the same parent. */
  after(node: FakeElement): void {
    const parent = this.parentNode;
    if (parent === null) return;
    node.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    node.parentNode = parent;
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent === null) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentNode = null;
  }
}

/** The silence def's `findMaxMs` the fake options answer. */
const FIND_MAX_MS = 8000;

const strings: Record<string, string> = {
  'hud.silence_bubble': '…',
  'hud.silence_bubble_label': 'Silence',
};

function setup(
  point = { x: 700, y: 200 },
  viewport = { width: 844, height: 390 },
  isDirectional?: () => boolean,
) {
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
    findMaxMs: (defId) => (defId === 'silence_mischief' ? FIND_MAX_MS : null),
    ...(isDirectional === undefined ? {} : { isDirectional }),
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
    threats: [{ id: 7, defId: 'silence_mischief', xM: 1.5, zM: -2.6 }],
  } as unknown as Parameters<typeof bubble.update>[1];
  // The HUD root the bubble sits in: the ring is mounted beside it, there, while it shows.
  const host = new FakeElement();
  host.append(element);
  return {
    bubble,
    element,
    host,
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

describe('the silence bubble in a follow level (story 9.3, D8)', () => {
  it('says no direction: the right edge under the HUD row, whatever the zone’s side and height', () => {
    for (const point of [
      { x: 60, y: 250 },
      { x: 700, y: 200 },
      { x: 400, y: 30 },
    ]) {
      const { bubble, element, calls } = setup(point, undefined, () => false);
      bubble.update(true, setup().world);
      expect(element.hidden).toBe(false);
      expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.right);
      expect(element.style.top).toBe('64px');
      // The zone is never even projected.
      expect(calls).toEqual([]);
    }
  });

  it('keeps its ring, which counts down as before', () => {
    const { bubble, host, world } = setup({ x: 60, y: 250 }, undefined, () => false);
    bubble.update(true, world, 2100 + FIND_MAX_MS / 2);
    const ring = bubble.ring as unknown as FakeElement;
    expect(host.children).toContain(ring);
    expect(ring.className).toContain(SILENCE_RING_CLASSES.right);
    expect(ring.vars.get('--pp-silence-progress')).toBe('500');
  });

  it('is directional again when the answer is true (a fixed level)', () => {
    const { bubble, element } = setup({ x: 60, y: 250 }, undefined, () => true);
    bubble.update(true, setup().world);
    expect(element.className).toContain(SILENCE_BUBBLE_CLASSES.left);
  });
});

describe('the ring beside the bubble (story 2.11, AC 12)', () => {
  const ringOf = (bubble: { ring: HTMLElement }): FakeElement =>
    bubble.ring as unknown as FakeElement;
  const progressOf = (ring: FakeElement): string | undefined =>
    ring.vars.get('--pp-silence-progress');

  it('is a hidden sibling with an outline and a band, at the hold-ring’s sizes, not a child of the bubble', () => {
    const { bubble, element } = setup();
    const ring = ringOf(bubble);
    expect(ring.hidden).toBe(true);
    expect(ring).not.toBe(element);
    expect(element.children).toHaveLength(0);
    expect(ring.children.map((child) => child.className)).toEqual([
      SILENCE_RING_CLASSES.outline,
      SILENCE_RING_CLASSES.band,
    ]);
    expect(ring.vars.get('--pp-silence-ring-stroke')).toBe('5px');
    expect(ring.vars.get('--pp-silence-ring-outline')).toBe('2px');
    expect(ring.attributes.get('aria-hidden')).toBe('true');
  });

  it('shows with the bubble and fills from startedAt to startedAt + findMaxMs, in the drawn sim time', () => {
    const { bubble, world } = setup();
    const ring = ringOf(bubble);
    const startedAt = 2100;
    bubble.update(true, world, startedAt);
    expect(ring.hidden).toBe(false);
    expect(progressOf(ring)).toBe('0');
    bubble.update(true, world, startedAt + FIND_MAX_MS / 4);
    expect(progressOf(ring)).toBe('250');
    bubble.update(true, world, startedAt + FIND_MAX_MS / 2);
    expect(progressOf(ring)).toBe('500');
    bubble.update(true, world, startedAt + FIND_MAX_MS);
    expect(progressOf(ring)).toBe('1000');
    // Before the start (the drawn time trails the step) and after the end: clamped.
    bubble.update(true, world, startedAt - 5);
    expect(progressOf(ring)).toBe('0');
    bubble.update(true, world, startedAt + FIND_MAX_MS + 500);
    expect(progressOf(ring)).toBe('1000');
  });

  it('sits on the same side and at the same height as the bubble, on its centre side', () => {
    const right = setup({ x: 700, y: 200 });
    right.bubble.update(true, right.world, 3000);
    expect(ringOf(right.bubble).className).toContain(SILENCE_RING_CLASSES.right);
    expect(ringOf(right.bubble).style.top).toBe(right.element.style.top);
    const left = setup({ x: 120, y: 200 });
    left.bubble.update(true, left.world, 3000);
    expect(ringOf(left.bubble).className).toContain(SILENCE_RING_CLASSES.left);
    expect(ringOf(left.bubble).className).not.toContain(SILENCE_RING_CLASSES.right);
  });

  it('hides with the bubble: found, timed out, level end, pause and restart all clear the silence', () => {
    const { bubble, element, world } = setup();
    const ring = ringOf(bubble);
    bubble.update(true, world, 3000);
    expect(ring.hidden).toBe(false);
    bubble.update(false, world, 3100);
    expect(element.hidden).toBe(true);
    expect(ring.hidden).toBe(true);
    bubble.update(false, undefined, null);
    expect(ring.hidden).toBe(true);
    // A new silence starts empty again.
    bubble.update(true, world, 2100);
    expect(ring.hidden).toBe(false);
    expect(progressOf(ring)).toBe('0');
  });

  it('is not drawn without a drawn sim time, nor for a silence whose findMaxMs is unknown', () => {
    const { bubble, world } = setup();
    bubble.update(true, world, null);
    expect(ringOf(bubble).hidden).toBe(true);
    bubble.update(true, world);
    expect(ringOf(bubble).hidden).toBe(true);
    const unknown = setup();
    const other = {
      ...unknown.world,
      threats: [{ id: 7, defId: 'another_def', xM: 0, zM: 0 }],
    } as unknown as Parameters<typeof unknown.bubble.update>[1];
    unknown.bubble.update(true, other, 3000);
    expect(unknown.element.hidden).toBe(false);
    expect(ringOf(unknown.bubble).hidden).toBe(true);
  });

  it('is mounted right behind the bubble only while it shows, so a hidden one costs no HUD node', () => {
    const { bubble, element, host, world } = setup();
    const ring = ringOf(bubble);
    expect(host.children).toEqual([element]);
    bubble.update(false, undefined, 0);
    expect(host.children).toEqual([element]);
    bubble.update(true, world, 3000);
    expect(host.children).toEqual([element, ring]);
    expect(ring.parentNode).toBe(host);
    // A frame later, a resize: still one ring, still behind the bubble.
    bubble.update(true, world, 3100);
    bubble.relayout();
    expect(host.children).toEqual([element, ring]);
    bubble.update(false, world, 3200);
    expect(host.children).toEqual([element]);
    expect(ring.parentNode).toBeNull();
    bubble.update(true, world, 3300);
    expect(host.children).toEqual([element, ring]);
  });

  it('warns, and stays hidden, when the silence has no find deadline to count down', () => {
    const { bubble, world } = setup();
    const seen = log.buffer().length;
    const noDeadline = {
      ...world,
      threats: [{ id: 7, defId: 'another_def', xM: 0, zM: 0 }],
    } as unknown as Parameters<typeof bubble.update>[1];
    bubble.update(true, noDeadline, 3000);
    const warns = log
      .buffer()
      .slice(seen)
      .filter((record) => record.level === 'warn' && /no find deadline/.test(record.message));
    expect(warns).toHaveLength(1);
    expect(ringOf(bubble).hidden).toBe(true);
  });

  it('writes the progress only when the per-mille changes', () => {
    const { bubble, world } = setup();
    const ring = ringOf(bubble);
    bubble.update(true, world, 3000);
    const writes = ring.varWrites['--pp-silence-progress'];
    for (let i = 0; i < 50; i++) bubble.update(true, world, 3000);
    expect(ring.varWrites['--pp-silence-progress']).toBe(writes);
    bubble.update(true, world, 3000 + FIND_MAX_MS / 10);
    expect(ring.varWrites['--pp-silence-progress']).toBe((writes ?? 0) + 1);
  });

  it('keeps its fill through a resize', () => {
    const { bubble, world, setPoint } = setup({ x: 700, y: 200 });
    const ring = ringOf(bubble);
    bubble.update(true, world, 2100 + FIND_MAX_MS / 2);
    setPoint({ x: 100, y: 180 });
    bubble.relayout();
    expect(ring.hidden).toBe(false);
    expect(progressOf(ring)).toBe('500');
    expect(ring.className).toContain(SILENCE_RING_CLASSES.left);
  });
});
