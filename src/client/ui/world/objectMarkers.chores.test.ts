import { asSimMs } from '@shared/time';
import type { ChoreInstance } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { CHRONO_HIDDEN } from './chronoRingElement.ts';
import {
  createObjectMarkers,
  OBJECT_CLASSES,
  OBJECT_ICON_PATHS,
  type ObjectMarkerSpec,
} from './objectMarkers.ts';
import type { VerbMetrics } from './verbMetrics.ts';

// The station marker of a house chore (story 9.4): the beat's chrono-ring, from the world and the sim
// time as drawn only, and a done look. A DOM double with what the ring element writes.

class FakeElement {
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  hidden = false;
  textContent = '';
  style: {
    fontSize?: string;
    setProperty: (name: string, value: string) => void;
    [name: string]: string | ((name: string, value: string) => void) | undefined;
  } = {
    setProperty: (name: string, value: string): void => {
      this.style[name] = value;
    },
  };
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  classes = new Set<string>();
  classList = {
    toggle: (name: string, force: boolean): void => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
}

const STOVE: ObjectMarkerSpec = { id: 'stove', kind: 'stove', xM: 3, yM: 1, zM: -1.4 };
const COFFEE: ObjectMarkerSpec = {
  id: 'coffee_machine',
  kind: 'coffee_machine',
  xM: 1,
  yM: 1.2,
  zM: -2,
};

const METRICS = {
  surfaceKey: () => 'regular',
  threatSizePx: () => 64,
  basePx: () => 40,
  scale: () => 1,
  // Ten px a letter, so that « COUPE LE FEU ! » is wider than the share of a narrow layer.
  widthPx: (text: string, fontPx: number) => text.length * fontPx * 0.25,
} as unknown as VerbMetrics;

/** The beats of the cooking: the verbs of its four temps forts, as `t()` gives them. */
const COOKING_VERBS = ['REMUE !', 'ÉCRASE !', 'REMUE !', 'COUPE LE FEU !'] as const;

function build(hasMetrics = true) {
  const made: FakeElement[] = [];
  const make = (): FakeElement => {
    const element = new FakeElement();
    made.push(element);
    return element;
  };
  const doc = { createElement: make, createElementNS: make } as unknown as Pick<
    Document,
    'createElement' | 'createElementNS'
  >;
  const markers = createObjectMarkers(new Scene(), doc, hasMetrics ? () => METRICS : undefined);
  const root = (): FakeElement | undefined =>
    made.find((element) => element.attributes.get('data-pp-object') === 'stove');
  const ring = (): FakeElement | undefined =>
    made.find((element) => element.className === 'pp-chrono-ring');
  const verb = (): FakeElement | undefined =>
    made.find((element) => element.className.includes('pp-object-verb'));
  const verbStack = (): FakeElement | undefined =>
    made.find((element) => element.className === 'pp-threat-verb-stack');
  return { markers, root, ring, verb, verbStack };
}

function chore(changes: Partial<ChoreInstance> = {}): ChoreInstance {
  return {
    state: 'untouched',
    enteredAt: 0,
    beatsDone: 0,
    beatState: 'none',
    beatTelegraphAt: 0,
    beatWindowOpenAt: 0,
    responseWindow: { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
    ...changes,
  } as ChoreInstance;
}

/** A beat announced at 1000, its window (300 ms, a perfect zone of 100) opening at 3000. */
const announced = (): ChoreInstance =>
  chore({
    state: 'working',
    beatState: 'telegraph',
    beatTelegraphAt: asSimMs(1000),
    beatWindowOpenAt: asSimMs(3000),
    responseWindow: { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 },
  });

describe('the station marker of a chore', () => {
  it('draws a saucepan with a ring for a station, and no ring for an object that is not one', () => {
    const { markers, ring } = build();
    markers.mount([STOVE, COFFEE], ['stove']);
    expect(OBJECT_ICON_PATHS.stove).not.toBeNull();
    expect(ring()).toBeDefined();
    expect(ring()?.hidden).toBe(true);
    expect(markers.isAnyVisible).toBe(true);
  });

  it('shows no ring when the level names no station, whatever the object kind', () => {
    const { markers, ring } = build();
    markers.mount([STOVE]);
    expect(ring()).toBeUndefined();
    expect(markers.updateChores([chore()], 0)).toBe(false);
  });

  it('shows the ring of the announced beat from its announcement to the end of its window', () => {
    const { markers, ring } = build();
    markers.mount([STOVE], ['stove']);
    // The announcement itself: empty ring, shown.
    expect(markers.updateChores([announced()], 1000)).toBe(false);
    expect(ring()?.hidden).toBe(false);
    expect(markers.choreRingDrawOf(0)).toEqual({ permille: 0, isLit: false });
    // Halfway through the telegraph: the ring is about half full, the arc is not lit.
    markers.updateChores([announced()], 2000);
    const half = markers.choreRingDrawOf(0);
    expect(half?.isLit).toBe(false);
    expect(half?.permille).toBeGreaterThan(400);
    expect(half?.permille).toBeLessThan(600);
    // The end of the window: full.
    markers.updateChores([announced()], 3300);
    expect(markers.choreRingDrawOf(0)).toMatchObject({ permille: 1000, isLit: true });
  });

  it('lights the arc once, at the opening of the window, and reports it once', () => {
    const { markers } = build();
    markers.mount([STOVE], ['stove']);
    expect(markers.updateChores([announced()], 2990)).toBe(false);
    expect(markers.updateChores([announced()], 3000)).toBe(true);
    expect(markers.updateChores([announced()], 3100)).toBe(false);
    expect(markers.choreRingDrawOf(0)?.isLit).toBe(true);
  });

  it('is a function of the sim time it is given: the same time draws the same ring (frozen in a pause)', () => {
    const { markers } = build();
    markers.mount([STOVE], ['stove']);
    markers.updateChores([announced()], 2500);
    const first = markers.choreRingDrawOf(0);
    markers.updateChores([announced()], 2500);
    expect(markers.choreRingDrawOf(0)).toEqual(first);
  });

  it('hides the ring when the beat is withdrawn, the chore paused or done, and again for the next beat', () => {
    const { markers, ring } = build();
    markers.mount([STOVE], ['stove']);
    markers.updateChores([announced()], 2000);
    expect(ring()?.hidden).toBe(false);
    markers.updateChores([chore({ state: 'working', beatState: 'held' })], 2100);
    expect(ring()?.hidden).toBe(true);
    expect(markers.choreRingDrawOf(0)?.permille).toBe(CHRONO_HIDDEN);
    markers.updateChores([announced()], 2200);
    expect(ring()?.hidden).toBe(false);
    markers.updateChores([chore({ state: 'paused', beatsDone: 1 })], 2300);
    expect(ring()?.hidden).toBe(true);
    // A new announcement is a new ring: it starts empty again.
    const next: ChoreInstance = {
      ...announced(),
      beatTelegraphAt: asSimMs(5000),
      beatWindowOpenAt: asSimMs(7000),
    };
    markers.updateChores([next], 5000);
    expect(markers.choreRingDrawOf(0)).toEqual({ permille: 0, isLit: false });
  });

  it('wears a done look once the chore is done, and only then', () => {
    const { markers, root } = build();
    markers.mount([STOVE], ['stove']);
    markers.updateChores([chore({ state: 'working', beatState: 'telegraph' })], 100);
    expect(root()?.className).toBe(OBJECT_CLASSES.root);
    markers.updateChores([chore({ state: 'done', beatsDone: 4 })], 200);
    expect(root()?.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.done}`);
  });

  it('leaves its class to updateChores: the urgency of the other objects does not touch it', () => {
    const { markers, root } = build();
    markers.mount([STOVE], ['stove']);
    markers.updateChores([chore({ state: 'done', beatsDone: 4 })], 200);
    markers.update(true, true, true);
    expect(root()?.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.done}`);
  });

  it('sizes the ring from the icon: 0.7 of the threat icon of the surface', () => {
    const { markers, ring } = build();
    markers.mount([STOVE], ['stove']);
    // The ring element writes its box once the size is known: 64 × 0.7.
    const svg = ring()?.children[0];
    expect(svg?.attributes.get('viewBox')).toBe('0 0 44.8 44.8');
  });

  it('forgets everything with the level: a new mount has no ring', () => {
    const { markers } = build();
    markers.mount([STOVE], ['stove']);
    markers.unmount();
    expect(markers.choreRingDrawOf(0)).toBeNull();
    expect(markers.updateChores([announced()], 2000)).toBe(false);
  });
});

describe('the verb of the announced beat (story 9.5, AC 1)', () => {
  const beat = (beatsDone: number): ChoreInstance => ({ ...announced(), beatsDone });

  it('wears the threats’ verb look, hidden until a beat is announced', () => {
    const { markers, verb, verbStack } = build();
    markers.mount([STOVE], ['stove'], [COOKING_VERBS]);
    expect(verb()?.className).toBe(`pp-threat-verb ${OBJECT_CLASSES.verb}`);
    expect(verbStack()?.hidden).toBe(true);
    expect(markers.stationVerbOf(0)).toBe('');
  });

  it.each(COOKING_VERBS.map((text, index) => [index, text] as const))(
    'shows the verb of beat %i (%s) while that beat is announced',
    (index, text) => {
      const { markers, verb, verbStack } = build();
      markers.mount([STOVE], ['stove'], [COOKING_VERBS]);
      markers.updateChores([beat(index)], 1000);
      expect(verbStack()?.hidden).toBe(false);
      expect(verb()?.textContent).toBe(text);
      expect(markers.stationVerbOf(0)).toBe(text);
    },
  );

  it('shows no verb when no beat is announced: held, paused, done, untouched', () => {
    const { markers, verbStack } = build();
    markers.mount([STOVE], ['stove'], [COOKING_VERBS]);
    markers.updateChores([beat(1)], 1000);
    expect(verbStack()?.hidden).toBe(false);
    for (const hidden of [
      chore({ state: 'working', beatsDone: 1, beatState: 'held' }),
      chore({ state: 'paused', beatsDone: 1 }),
      chore({ state: 'done', beatsDone: 4 }),
      chore({ state: 'untouched' }),
    ]) {
      markers.updateChores([beat(1)], 1000);
      markers.updateChores([hidden], 1100);
      expect(verbStack()?.hidden, hidden.state).toBe(true);
      expect(markers.stationVerbOf(0)).toBe('');
    }
  });

  it('writes the text only when the beat changes, not every frame', () => {
    const { markers, verb } = build();
    markers.mount([STOVE], ['stove'], [COOKING_VERBS]);
    markers.updateChores([beat(0)], 1000);
    const element = verb();
    if (element === undefined) throw new Error('no verb element');
    let writes = 0;
    let text = element.textContent;
    Object.defineProperty(element, 'textContent', {
      get: () => text,
      set: (value: string) => {
        writes++;
        text = value;
      },
    });
    for (let frame = 0; frame < 20; frame++) markers.updateChores([beat(0)], 1000 + frame * 10);
    expect(writes).toBe(0);
    markers.updateChores([beat(1)], 1300);
    expect(writes).toBe(1);
    expect(text).toBe('ÉCRASE !');
  });

  it('fits the verb to the layer like a threat’s: narrower layer, smaller font, never under the floor', () => {
    const wide = build();
    wide.markers.mount([STOVE], ['stove'], [COOKING_VERBS]);
    wide.markers.refit(2000);
    wide.markers.updateChores([beat(3)], 1000);
    const wideFont = wide.verb()?.style.fontSize;
    const narrow = build();
    narrow.markers.mount([STOVE], ['stove'], [COOKING_VERBS]);
    narrow.markers.refit(120);
    narrow.markers.updateChores([beat(3)], 1000);
    const narrowFont = narrow.verb()?.style.fontSize;
    expect(wideFont).toBe('40px');
    expect(Number.parseFloat(narrowFont ?? '0')).toBeLessThan(40);
    expect(Number.parseFloat(narrowFont ?? '0')).toBeGreaterThan(0);
  });

  it('has no verb element for a level whose stations carry no verbs, nor for a station of no chore', () => {
    const { markers, verb } = build();
    markers.mount([STOVE], ['stove']);
    expect(verb()).toBeUndefined();
    expect(markers.stationVerbOf(0)).toBeNull();
    const other = build();
    other.markers.mount([STOVE, COFFEE], ['stove'], [COOKING_VERBS]);
    expect(other.markers.stationVerbOf(1)).toBeNull();
  });
});
