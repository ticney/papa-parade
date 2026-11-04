import { OFFSCREEN_BUBBLE_MAX_NODES } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { type ChronoRing, createChronoRing } from './chronoRing.ts';
import {
  applyOffscreenBubbleMetrics,
  createOffscreenBubbles,
  OFFSCREEN_BUBBLE_CLASSES,
  offscreenBubbleMetrics,
} from './offscreenBubble.ts';
import { createOffscreenSlots, type OffscreenSlot } from './offscreenLayout.ts';
import { THREAT_CLASSES, type ThreatMarkerEntry } from './threatMarkers.ts';

/** The few things of the DOM the bubbles touch: a tree with parents, classes, styles and write counts. */
class FakeElement {
  parentNode: FakeElement | null = null;
  className = '';
  hidden = false;
  readonly vars = new Map<string, string>();
  writes: Record<string, number> = {};
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, force: boolean) => {
      this.writes[`class:${name}`] = (this.writes[`class:${name}`] ?? 0) + 1;
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
  };
  readonly style: Record<string, unknown> = new Proxy(
    {
      setProperty: (name: string, value: string) => {
        this.vars.set(name, value);
        this.writes[name] = (this.writes[name] ?? 0) + 1;
      },
    } as Record<string, unknown>,
    {
      set: (target, key, value) => {
        this.writes[String(key)] = (this.writes[String(key)] ?? 0) + 1;
        target[String(key)] = value;
        return true;
      },
    },
  );
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.remove();
      child.parentNode = this;
      this.children.push(child);
    }
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent === null) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentNode = null;
  }
  /** Every element under this one (`#pp-hud *`). */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  totalWrites(): number {
    return (
      Object.values(this.writes).reduce((sum, n) => sum + n, 0) +
      this.children.reduce((sum, child) => sum + child.totalWrites(), 0)
    );
  }
}

const entry = (threatId: number, over: Partial<ThreatMarkerEntry> = {}): ThreatMarkerEntry => ({
  threatId,
  xM: 0,
  yM: 0.3,
  zM: 0,
  icon: 'bolt',
  followsPapa: false,
  verb: '',
  iconShape: 'circle',
  color: 'parry',
  verbWidthPx: 0,
  verbHeightPx: 0,
  verbOffsetPx: 0,
  hasChronoRing: true,
  telegraphDelayMs: 1000,
  ...over,
});

function setup(entries = [entry(1), entry(2), entry(3)]) {
  const doc = {
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
  } as unknown as Pick<Document, 'createElement' | 'createElementNS'>;
  const host = new FakeElement();
  const draws = new Map<number, { permille: number; isLit: boolean; isHold: boolean }>();
  const rings = new Map<number, ChronoRing>();
  const bubbles = createOffscreenBubbles(doc, {
    t: (key) => (key === 'hud.offscreen_bubble_label' ? 'Bêtise hors de l’écran' : key),
    host: host as unknown as HTMLElement,
    chronoRingOf: (id) => rings.get(id) ?? null,
    chronoDrawOf: (id) => draws.get(id) ?? null,
  });
  bubbles.setLevel(entries);
  bubbles.setDiscRadius(37);
  const slots = createOffscreenSlots();
  const show = (...placed: [number, number, number, number][]) => {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i] as OffscreenSlot;
      const next = placed[i];
      slot.threatId = next?.[0] ?? -1;
      if (next !== undefined) {
        slot.edge = 'left';
        slot.xPx = next[1];
        slot.yPx = next[2];
        slot.angleDeg = next[3];
      }
    }
  };
  return { bubbles, host, draws, rings, slots, show };
}

const mounted = (host: FakeElement) => host.children;
const iconOf = (root: FakeElement | undefined) =>
  root?.children.find((child) => child.className.startsWith(THREAT_CLASSES.icon));

describe('createOffscreenBubbles (story 9.3, D5, AC 3, 8, 9)', () => {
  it('mounts nothing while no bubble shows: a hidden bubble costs no HUD node', () => {
    const { host, slots, bubbles, show } = setup();
    show();
    bubbles.update(slots, null);
    expect(host.descendants()).toHaveLength(0);
  });

  it('costs 6 nodes for a circle icon with its ring, within OFFSCREEN_BUBBLE_MAX_NODES', () => {
    const { host, slots, bubbles, show, draws } = setup();
    draws.set(1, { permille: 100, isLit: false, isHold: false });
    show([1, 80, 150, 180]);
    bubbles.update(slots, null);
    const nodes = host.descendants();
    expect(nodes).toHaveLength(6);
    expect(nodes.length).toBeLessThanOrEqual(OFFSCREEN_BUBBLE_MAX_NODES);
    // root, the arc and the band, the icon (div, svg, path).
    expect(nodes[0]?.className).toBe(OFFSCREEN_BUBBLE_CLASSES.root);
    expect(nodes[0]?.attributes.get('role')).toBe('img');
    expect(nodes[0]?.attributes.get('aria-label')).toBe('Bêtise hors de l’écran');
  });

  it('costs 9 nodes for a triangle (dodge) icon: 5.1 owns that budget', () => {
    const { host, slots, bubbles, show } = setup([
      entry(1, { iconShape: 'triangle', color: 'dodge' }),
    ]);
    show([1, 80, 150, 180]);
    bubbles.update(slots, null);
    expect(host.descendants()).toHaveLength(9);
  });

  it('has no ring at all on a threat with none (a wait): 4 nodes', () => {
    const { host, slots, bubbles, show } = setup([entry(1, { hasChronoRing: false })]);
    show([1, 80, 150, 180]);
    bubbles.update(slots, null);
    expect(host.descendants()).toHaveLength(4);
    expect(
      host.descendants().some((node) => node.className === OFFSCREEN_BUBBLE_CLASSES.band),
    ).toBe(false);
  });

  it('holds the icon of its threat, with its shape and its colour', () => {
    const { host, slots, bubbles, show } = setup([
      entry(1),
      entry(2, { iconShape: 'triangle', color: 'dodge' }),
    ]);
    show([1, 80, 150, 180], [2, 80, 260, 180]);
    bubbles.update(slots, null);
    const [first, second] = mounted(host);
    expect(iconOf(first)?.className).toBe(THREAT_CLASSES.icon);
    expect(iconOf(first)?.vars.get('--pp-threat-color')).toBe('var(--pp-color-parry)');
    expect(iconOf(second)?.className).toContain(THREAT_CLASSES.iconTriangle);
    expect(iconOf(second)?.vars.get('--pp-threat-color')).toBe('var(--pp-color-dodge)');
  });

  it('places its centre and turns its chevron from the slot, in whole px and degrees', () => {
    const { host, slots, bubbles, show } = setup();
    show([1, 80, 150, 187]);
    bubbles.update(slots, null);
    const [root] = mounted(host);
    expect(root?.style.left).toBe('80px');
    expect(root?.style.top).toBe('150px');
    expect(root?.vars.get('--pp-offscreen-angle')).toBe('187deg');
  });

  it('copies the ring the marker drew: per-mille, lit arc, hold, and its geometry', () => {
    const { host, slots, bubbles, show, draws, rings } = setup();
    const ring = createChronoRing();
    ring.arcFromPermille = 714;
    ring.notchPermille = 857;
    rings.set(1, ring);
    draws.set(1, { permille: 420, isLit: false, isHold: false });
    show([1, 80, 150, 180]);
    bubbles.update(slots, null);
    const [root] = mounted(host);
    const band = root?.children.find((c) => c.className === OFFSCREEN_BUBBLE_CLASSES.band);
    expect(band?.hidden).toBe(false);
    expect(root?.vars.get('--pp-offscreen-progress')).toBe('420');
    expect(root?.vars.get('--pp-offscreen-arc-from')).toBe('714');
    expect(root?.vars.get('--pp-offscreen-notch-at')).toBe('857');
    expect(root?.classes.has(OFFSCREEN_BUBBLE_CLASSES.lit)).toBe(false);
    draws.set(1, { permille: 800, isLit: true, isHold: false });
    bubbles.update(slots, null);
    expect(root?.vars.get('--pp-offscreen-progress')).toBe('800');
    expect(root?.classes.has(OFFSCREEN_BUBBLE_CLASSES.lit)).toBe(true);
    draws.set(1, { permille: 1000, isLit: false, isHold: true });
    bubbles.update(slots, null);
    expect(root?.classes.has(OFFSCREEN_BUBBLE_CLASSES.lit)).toBe(false);
    expect(root?.classes.has(OFFSCREEN_BUBBLE_CLASSES.hold)).toBe(true);
    // The marker draws no ring any more: neither does the bubble.
    draws.delete(1);
    bubbles.update(slots, null);
    expect(band?.hidden).toBe(true);
  });

  it('writes nothing on a second identical update', () => {
    const { host, slots, bubbles, show, draws } = setup();
    draws.set(1, { permille: 300, isLit: false, isHold: false });
    draws.set(2, { permille: 500, isLit: true, isHold: false });
    show([1, 80, 150, 180], [2, 80, 260, 200]);
    bubbles.update(slots, 2);
    const before = host.totalWrites();
    const childrenBefore = host.descendants().length;
    bubbles.update(slots, 2);
    expect(host.totalWrites()).toBe(before);
    expect(host.descendants()).toHaveLength(childrenBefore);
  });

  it('keeps a threat on its element when another one comes or goes (no swap, no rebuild)', () => {
    const { host, slots, bubbles, show } = setup();
    show([2, 80, 150, 180]);
    bubbles.update(slots, null);
    const elementOf2 = mounted(host)[0];
    const iconOf2 = iconOf(elementOf2);
    const writesOf2 = elementOf2?.totalWrites() ?? 0;
    // A new one comes before it in slot order: 2 keeps its element.
    show([1, 80, 100, 180], [2, 80, 210, 180]);
    bubbles.update(slots, null);
    expect(mounted(host)).toHaveLength(2);
    expect(iconOf(elementOf2)).toBe(iconOf2);
    expect(elementOf2?.style.top).toBe('210px');
    // Only its top moved.
    expect((elementOf2?.totalWrites() ?? 0) - writesOf2).toBe(1);
    // 2 goes: its element leaves the HUD, 1 stays.
    show([1, 80, 100, 180]);
    bubbles.update(slots, null);
    expect(mounted(host)).toHaveLength(1);
    expect(elementOf2?.parentNode).toBeNull();
  });

  it('shows the target-highlight on the targeted threat’s bubble only', () => {
    const { host, slots, bubbles, show } = setup();
    show([1, 80, 100, 180], [2, 80, 210, 180]);
    bubbles.update(slots, 2);
    const [first, second] = mounted(host);
    expect(first?.classes.has(OFFSCREEN_BUBBLE_CLASSES.targeted)).toBe(false);
    expect(second?.classes.has(OFFSCREEN_BUBBLE_CLASSES.targeted)).toBe(true);
    bubbles.update(slots, null);
    expect(second?.classes.has(OFFSCREEN_BUBBLE_CLASSES.targeted)).toBe(false);
  });

  it('picks the disc under a point, the nearest of two, and nothing outside or when hidden', () => {
    const { slots, bubbles, show } = setup();
    show([1, 80, 100, 180], [2, 80, 180, 180]);
    bubbles.update(slots, null);
    expect(bubbles.pick(80, 100)).toBe(1);
    expect(bubbles.pick(80 + 36, 100)).toBe(1);
    expect(bubbles.pick(80 + 38, 100)).toBeNull();
    expect(bubbles.pick(80, 145)).toBe(2);
    expect(bubbles.pick(80, 135)).toBe(1);
    expect(bubbles.pick(500, 300)).toBeNull();
    bubbles.hide();
    expect(bubbles.pick(80, 100)).toBeNull();
  });

  it('hides everything and starts over at a level end or a new level', () => {
    const { host, slots, bubbles, show } = setup();
    show([1, 80, 100, 180]);
    bubbles.update(slots, 1);
    bubbles.hide();
    expect(host.descendants()).toHaveLength(0);
    bubbles.setLevel([entry(5)]);
    show([5, 80, 100, 180]);
    bubbles.update(slots, null);
    expect(host.descendants()).toHaveLength(6);
    expect(mounted(host)[0]?.classes.has(OFFSCREEN_BUBBLE_CLASSES.targeted)).toBe(false);
  });
});

describe('the bubble’s sizes (story 9.3, D6, D9)', () => {
  it('writes every size for both surfaces on the root, from the constants', () => {
    const root = new FakeElement();
    applyOffscreenBubbleMetrics(root as unknown as HTMLElement);
    expect(root.vars.get('--pp-offscreen-icon-compact')).toBe('40px');
    expect(root.vars.get('--pp-offscreen-icon-regular')).toBe('48px');
    expect(root.vars.get('--pp-offscreen-border-compact')).toBe('3px');
    expect(root.vars.get('--pp-offscreen-notch-regular')).toMatch(/deg$/);
  });

  it('nests the ring inside the disc: the ring’s outer ink stays inside the border', () => {
    for (const iconPx of [40, 48]) {
      const metrics = offscreenBubbleMetrics(iconPx);
      const reach = metrics.reach as number;
      const disc = metrics.disc as number;
      const border = metrics.border as number;
      expect(metrics['ring-in']).toBeGreaterThan(iconPx / 2);
      expect(metrics['band-out']).toBeLessThan(metrics['arc-out'] as number);
      expect(reach).toBeLessThanOrEqual(disc - border);
    }
  });
});
