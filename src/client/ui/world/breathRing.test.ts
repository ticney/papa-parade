import { HOLD_RING_OUTLINE_PX, HOLD_RING_STROKE_PX } from '@shared/constants';
import type { StealthSlice } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { createBreathRing } from './breathRing.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  /** Every custom property written, in order, with its value. */
  writes: [string, string][] = [];
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => this.writes.push([name, value]),
  };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
  writesOf(name: string): string[] {
    return this.writes.filter(([key]) => key === name).map(([, value]) => value);
  }
}

const CAPACITY_MS = 6000;
const PAPA = { xM: 2, zM: -1 };
const slice = (patch: Partial<StealthSlice> = {}): StealthSlice => ({
  isRunning: true,
  exitXM: 0,
  exitZM: 0,
  nextAlertAt: null,
  breathLeftMs: CAPACITY_MS,
  breathHeldAt: null,
  isPassagePaid: false,
  creakZoneIndex: -1,
  ...patch,
});

function build() {
  const created: FakeElement[] = [];
  const doc = {
    createElement: () => {
      const element = new FakeElement();
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement'>;
  const scene = new Scene();
  const ring = createBreathRing(scene, doc);
  const element = created[0] as FakeElement;
  return { ring, scene, element, created };
}

describe('the breath-ring (story 4.9)', () => {
  it('is a hidden, aria-hidden CSS2D object on Papa, built with the hold-ring’s constants', () => {
    const { ring, scene, element, created } = build();
    expect(ring.isVisible).toBe(false);
    expect(ring.progressPct).toBe(-1);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.position.y).toBeCloseTo(PAPA_HEIGHT_M / 2);
    expect(element.attributes.get('aria-hidden')).toBe('true');
    expect(element.writesOf('--pp-breath-stroke')).toEqual([`${HOLD_RING_STROKE_PX}px`]);
    expect(element.writesOf('--pp-breath-outline')).toEqual([`${HOLD_RING_OUTLINE_PX}px`]);
    expect(created.map((e) => e.className)).toEqual([
      'pp-breath-ring',
      'pp-breath-ring-outline',
      'pp-breath-ring-band',
    ]);
  });

  it('is hidden when the breath is full and not held, and outside a stealth step', () => {
    const { ring } = build();
    ring.update(slice(), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(false);
    ring.update(slice({ isRunning: false, breathLeftMs: 100 }), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(false);
    ring.update(null, CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(false);
  });

  it('shows while the breath is held, even at the first step, and empties as it is used', () => {
    const { ring, element } = build();
    ring.update(slice({ breathHeldAt: 100 as never }), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(true);
    expect(ring.progressPct).toBe(100);
    ring.update(slice({ breathHeldAt: 100 as never, breathLeftMs: 4500 }), CAPACITY_MS, PAPA);
    expect(ring.progressPct).toBe(75);
    ring.update(slice({ breathHeldAt: 100 as never, breathLeftMs: 600 }), CAPACITY_MS, PAPA);
    expect(ring.progressPct).toBe(10);
    expect(element.writesOf('--pp-hold-progress')).toEqual(['100', '75', '10']);
  });

  it('keeps showing while it refills, then hides once it is full again', () => {
    const { ring } = build();
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(true);
    expect(ring.progressPct).toBe(50);
    ring.update(slice({ breathLeftMs: 5990 }), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(true);
    expect(ring.progressPct).toBe(99);
    ring.update(slice({ breathLeftMs: CAPACITY_MS }), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(false);
    expect(ring.progressPct).toBe(-1);
  });

  it('is empty at 0, which is not hidden', () => {
    const { ring } = build();
    ring.update(slice({ breathLeftMs: 0 }), CAPACITY_MS, PAPA);
    expect(ring.isVisible).toBe(true);
    expect(ring.progressPct).toBe(0);
  });

  it('writes the DOM once per whole percent, not once per frame', () => {
    const { ring, element } = build();
    for (let i = 0; i < 20; i++) ring.update(slice({ breathLeftMs: 3000 + i }), CAPACITY_MS, PAPA);
    // 3000 / 6000 = 50 %, and 3019 / 6000 = 50.3 %: the same whole percent.
    expect(element.writesOf('--pp-hold-progress')).toEqual(['50']);
    ring.update(slice({ breathLeftMs: 3070 }), CAPACITY_MS, PAPA);
    expect(element.writesOf('--pp-hold-progress')).toEqual(['50', '51']);
  });

  it('follows Papa’s drawn pose, and hides with no pose', () => {
    const { ring, scene } = build();
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, PAPA);
    expect([scene.children[0]?.position.x, scene.children[0]?.position.z]).toEqual([2, -1]);
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, { xM: 3.5, zM: 0.25 });
    expect([scene.children[0]?.position.x, scene.children[0]?.position.z]).toEqual([3.5, 0.25]);
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, null);
    expect(ring.isVisible).toBe(false);
  });

  it('writes the percent again when it comes back after being hidden', () => {
    const { ring, element } = build();
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, PAPA);
    ring.update(slice(), CAPACITY_MS, PAPA);
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, PAPA);
    expect(element.writesOf('--pp-hold-progress')).toEqual(['50', '50']);
  });

  it('does nothing with an empty capacity, and hides on dispose', () => {
    const { ring, scene } = build();
    ring.update(slice({ breathLeftMs: 1 }), 0, PAPA);
    expect(ring.isVisible).toBe(false);
    ring.update(slice({ breathLeftMs: 3000 }), CAPACITY_MS, PAPA);
    ring.dispose();
    expect(ring.isVisible).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
});
