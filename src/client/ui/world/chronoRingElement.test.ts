import { readFileSync } from 'node:fs';
import { CHRONO_RING_NOTCH_PX } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  CHRONO_DASH_OFFSET_STRINGS,
  CHRONO_FULL_PERMILLE,
  chronoRingRadii,
  createChronoRing,
} from './chronoRing.ts';
import {
  CHRONO_HIDDEN,
  CHRONO_RING_CLASSES,
  createChronoRingElement,
} from './chronoRingElement.ts';

/** The few things of the DOM that the ring element touches. */
class FakeNode {
  className = '';
  hidden = false;
  readonly attributes = new Map<string, string>();
  readonly children: FakeNode[] = [];
  readonly classes = new Set<string>();
  readonly attributeWrites: Record<string, number> = {};
  readonly classList = {
    toggle: (name: string, force: boolean): boolean => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
  };
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.attributeWrites[name] = (this.attributeWrites[name] ?? 0) + 1;
  }
  append(...children: FakeNode[]): void {
    this.children.push(...children);
  }
  attr(name: string): string | undefined {
    return this.attributes.get(name);
  }
}

function build() {
  const created: FakeNode[] = [];
  const make = (...args: string[]): FakeNode => {
    const node = new FakeNode(args[args.length - 1] as string);
    created.push(node);
    return node;
  };
  const doc = { createElement: make, createElementNS: make } as unknown as Pick<
    Document,
    'createElement' | 'createElementNS'
  >;
  const element = createChronoRingElement(doc);
  const byClass = (name: string): FakeNode => {
    const found = created.find((node) => node.attr('class') === name);
    if (found === undefined) throw new Error(`no node of class ${name}`);
    return found;
  };
  const svg = created.find((node) => node.tag === 'svg') as FakeNode;
  const turned = created.find((node) => node.tag === 'g') as FakeNode;
  return { element, root: element.root as unknown as FakeNode, byClass, svg, turned };
}

const SURFACES = [56, 64];

describe('createChronoRingElement', () => {
  it('is a hidden, aria-hidden box around one svg, with no class of a state', () => {
    const { root, svg } = build();
    expect(root.hidden).toBe(true);
    expect(root.attr('aria-hidden')).toBe('true');
    expect(root.children).toEqual([svg]);
    expect(root.classes.size).toBe(0);
  });

  it.each(SURFACES)(
    'sizes every circle and the notch from the constants on a %i px icon',
    (sizePx) => {
      const { element, byClass, svg, turned } = build();
      element.setSize(sizePx);
      const centre = sizePx / 2;
      const radii = chronoRingRadii(sizePx);
      expect(svg.attr('viewBox')).toBe(`0 0 ${sizePx} ${sizePx}`);
      // Turned −90° so that 0 is 12 o'clock and the fill runs clockwise.
      expect(turned.attr('transform')).toBe(`rotate(-90 ${centre} ${centre})`);
      const expected: [string, { radiusPx: number; strokePx: number }][] = [
        [CHRONO_RING_CLASSES.outline, radii.outline],
        [CHRONO_RING_CLASSES.track, radii.band],
        [CHRONO_RING_CLASSES.arcOutline, radii.arcOutline],
        [CHRONO_RING_CLASSES.arc, radii.arc],
        [CHRONO_RING_CLASSES.progress, radii.band],
      ];
      for (const [name, stroke] of expected) {
        const node = byClass(name);
        expect(node.attr('cx'), name).toBe(String(centre));
        expect(node.attr('cy'), name).toBe(String(centre));
        expect(node.attr('r'), name).toBe(String(stroke.radiusPx));
        expect(node.attr('stroke-width'), name).toBe(String(stroke.strokePx));
        expect(node.attr('pathLength'), name).toBe(String(CHRONO_FULL_PERMILLE));
      }
      const notch = byClass(CHRONO_RING_CLASSES.notch);
      expect(notch.attr('x1')).toBe(String(centre + radii.notchInnerPx));
      expect(notch.attr('x2')).toBe(String(centre + radii.notchOuterPx));
      expect(notch.attr('y1')).toBe(String(centre));
      expect(notch.attr('y2')).toBe(String(centre));
      expect(notch.attr('stroke-width')).toBe(String(CHRONO_RING_NOTCH_PX));
      // The lit arc is thicker than the band, and grows outward from the band's inner edge.
      expect(radii.arc.strokePx).toBeGreaterThan(radii.band.strokePx);
      expect(radii.arc.radiusPx - radii.arc.strokePx / 2).toBeCloseTo(
        radii.band.radiusPx - radii.band.strokePx / 2,
      );
    },
  );

  it('writes a size once, and ignores a size that is not positive', () => {
    const { element, svg } = build();
    element.setSize(64);
    const writes = svg.attributeWrites.viewBox;
    element.setSize(64);
    element.setSize(0);
    element.setSize(Number.NaN);
    expect(svg.attributeWrites.viewBox).toBe(writes);
    expect(svg.attr('viewBox')).toBe('0 0 64 64');
  });

  it('turns the notch to its permille of the circle, and the lit arc starts at its own', () => {
    const { element, byClass } = build();
    element.setSize(64);
    const ring = createChronoRing();
    ring.arcFromPermille = 600;
    ring.notchPermille = 700;
    element.setGeometry(ring);
    // 700 per-mille is 252°: a missing −90° or a swapped sign would show here.
    expect(byClass(CHRONO_RING_CLASSES.notch).attr('transform')).toBe('rotate(252 32 32)');
    for (const name of [CHRONO_RING_CLASSES.arc, CHRONO_RING_CLASSES.arcOutline]) {
      // The dash shows the span from `arcFrom` to the end of the path, and nothing before it.
      expect(byClass(name).attr('stroke-dasharray'), name).toBe('400 600');
      expect(byClass(name).attr('stroke-dashoffset'), name).toBe('-600');
    }
  });

  it('turns the notch whichever of the size and the geometry comes first', () => {
    const geometry = createChronoRing();
    geometry.arcFromPermille = 500;
    geometry.notchPermille = 750;
    const first = build();
    first.element.setGeometry(geometry);
    first.element.setSize(56);
    expect(first.byClass(CHRONO_RING_CLASSES.notch).attr('transform')).toBe('rotate(270 28 28)');
    const second = build();
    second.element.setSize(56);
    second.element.setGeometry(geometry);
    expect(second.byClass(CHRONO_RING_CLASSES.notch).attr('transform')).toBe('rotate(270 28 28)');
  });

  it('shows from the first draw, paints the permille as a dash offset and hides on CHRONO_HIDDEN', () => {
    const { element, root, byClass } = build();
    const progress = byClass(CHRONO_RING_CLASSES.progress);
    element.draw(CHRONO_HIDDEN, false, false);
    expect(root.hidden).toBe(true);
    element.draw(0, false, false);
    expect(root.hidden).toBe(false);
    expect(progress.attr('stroke-dashoffset')).toBe(CHRONO_DASH_OFFSET_STRINGS[0]);
    element.draw(500, false, false);
    expect(progress.attr('stroke-dashoffset')).toBe('500');
    element.draw(CHRONO_FULL_PERMILLE, false, false);
    expect(progress.attr('stroke-dashoffset')).toBe('0');
    element.draw(CHRONO_HIDDEN, false, false);
    expect(root.hidden).toBe(true);
  });

  it('flips the lit and hold classes with the state, and writes the DOM only when something changes', () => {
    const { element, root, byClass } = build();
    const progress = byClass(CHRONO_RING_CLASSES.progress);
    element.draw(100, false, false);
    expect(root.classes.size).toBe(0);
    element.draw(100, true, false);
    expect([...root.classes]).toEqual([CHRONO_RING_CLASSES.lit]);
    element.draw(100, false, true);
    expect([...root.classes]).toEqual([CHRONO_RING_CLASSES.hold]);
    const writes = progress.attributeWrites['stroke-dashoffset'];
    element.draw(100, false, true);
    expect(progress.attributeWrites['stroke-dashoffset']).toBe(writes);
    element.draw(101, false, true);
    expect(progress.attributeWrites['stroke-dashoffset']).toBe((writes ?? 0) + 1);
  });
});

describe('the chrono-ring CSS (AC 4, AC 5, D4)', () => {
  const css = readFileSync(new URL('../styles/ui.css', import.meta.url), 'utf8');
  const rulesOf = (selector: string): string[] =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selectors]) =>
        (selectors as string).split(',').some((s) => s.trim() === selector),
      )
      .map(([, , body]) => body as string);

  it('shows the notch from the telegraph on: only a held Firmness hides it', () => {
    const hiding = (selector: string): boolean =>
      rulesOf(selector).some((body) => /display:\s*none/.test(body));
    expect(hiding('.pp-chrono-notch')).toBe(false);
    expect(hiding('.pp-chrono-ring--lit .pp-chrono-notch')).toBe(false);
    expect(hiding('.pp-chrono-ring--hold .pp-chrono-notch')).toBe(true);
  });

  it('draws the lit arc and its outline only once the ring is lit, and not while it drains', () => {
    for (const part of ['.pp-chrono-arc', '.pp-chrono-arc-outline']) {
      expect(
        rulesOf(part).some((body) => /display:\s*none/.test(body)),
        part,
      ).toBe(true);
      expect(
        rulesOf(`.pp-chrono-ring--lit ${part}`).some((body) => /display:\s*inline/.test(body)),
        part,
      ).toBe(true);
      expect(
        rulesOf(`.pp-chrono-ring--hold ${part}`).some((body) => /display:\s*none/.test(body)),
        part,
      ).toBe(true);
    }
  });
});
