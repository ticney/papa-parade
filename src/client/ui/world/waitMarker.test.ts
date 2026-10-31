import { asSimMs } from '@shared/time';
import type { ThreatInstance, ThreatState } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createThreatMarkers,
  THREAT_CLASSES,
  THREAT_ICON_PATHS,
  threatMarkerEntries,
} from './threatMarkers.ts';

// The marker of a wait threat (story 4.6): before its signal it shows the open eye and « ATTENDS… »,
// from the signal on the closed eye and « FILE ! ». Nothing it draws before the signal depends on the
// instant the sim drew for it (D1: `windowOpenAt` sits in the world early, the client must not leak it).

class FakeElement {
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  hidden = false;
  textContent = '';
  vars = new Map<string, string>();
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => this.vars.set(name, value),
  };
  classes = new Set<string>();
  classList = {
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
  };
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  /** Every write of an attribute or of the text, in order: what "writes the same DOM" compares. */
  log: string[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.log.push(`${name}=${value}`);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
}

function build() {
  const created: FakeElement[] = [];
  const make = (): FakeElement => {
    const element = new FakeElement();
    created.push(element);
    return element;
  };
  const doc = { createElement: make, createElementNS: make } as unknown as Pick<
    Document,
    'createElement' | 'createElementNS'
  >;
  const markers = createThreatMarkers(new Scene(), doc);
  const byClass = (name: string): FakeElement[] =>
    created.filter((element) => element.className === name);
  return { markers, created, byClass };
}

const t = (key: string): string => `<${key}>`;

const threat = (id: number, state: ThreatState, windowOpenAt = 1000): Readonly<ThreatInstance> =>
  ({
    id,
    defId: 'bedtime_eyes',
    anchorId: 'papa',
    xM: 0,
    zM: 0,
    state,
    enteredAt: asSimMs(0),
    windowOpenAt: asSimMs(windowOpenAt),
    responseWindow: null,
  }) as Readonly<ThreatInstance>;

const defOf = {
  icon: 'eyes',
  target: 'papa',
  verbKey: 'verb.wait',
  signalVerbKey: 'verb.go',
  signalIcon: 'eyelids',
  iconShape: 'circle',
  color: 'parry',
  response: 'wait',
} as const;

const entries = () => threatMarkerEntries([threat(4, 'idle')], [], { bedtime_eyes: defOf }, 0.2, t);

describe('the entry of a wait threat (story 4.6)', () => {
  it('translates the signal verb once at build and keeps the signal icon', () => {
    const [entry] = entries();
    expect(entry).toMatchObject({
      icon: 'eyes',
      verb: '<verb.wait>',
      signalVerb: '<verb.go>',
      signalIcon: 'eyelids',
    });
  });

  it('gives a threat that is not a wait no signal at all', () => {
    const [entry] = threatMarkerEntries(
      [threat(4, 'idle')],
      [{ id: 'papa', positionM: [0, 0, 0] }],
      {
        bedtime_eyes: {
          ...defOf,
          response: 'parry',
          signalVerbKey: undefined,
          signalIcon: undefined,
        },
      },
      0.2,
      t,
    );
    expect(entry?.signalVerb).toBeUndefined();
    expect(entry?.signalIcon).toBeUndefined();
  });
});

describe('the marker of a wait threat (story 4.6)', () => {
  const glyphOf = (created: FakeElement[]) =>
    created.find(
      (element) => element.attributes.has('d') && element.attributes.get('d') !== undefined,
    );

  it('swaps the verb and the glyph at the signal, once, and back at the next telegraph', () => {
    const { markers, byClass, created } = build();
    markers.mount(entries());
    const [verb] = byClass(THREAT_CLASSES.verb);
    const [root] = byClass(THREAT_CLASSES.root);
    const path = created.find((element) => element.attributes.get('d') === THREAT_ICON_PATHS.eyes);
    expect(path).toBeDefined();

    markers.update([threat(4, 'telegraph')], null, null);
    expect(verb?.textContent).toBe('<verb.wait>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.eyes);
    expect(root?.classes.has(THREAT_CLASSES.signal)).toBe(false);

    markers.update([threat(4, 'windowOpen')], null, null);
    expect(verb?.textContent).toBe('<verb.go>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.eyelids);
    expect(root?.classes.has(THREAT_CLASSES.signal)).toBe(true);

    // Written only when it changes: the glyph's `d` is set once for the whole open window.
    const writesBefore = path?.log.length ?? 0;
    for (let i = 0; i < 5; i++) markers.update([threat(4, 'windowOpen')], null, null);
    expect(path?.log.length).toBe(writesBefore);

    markers.update([threat(4, 'telegraph')], null, null);
    expect(verb?.textContent).toBe('<verb.wait>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.eyes);
    expect(root?.classes.has(THREAT_CLASSES.signal)).toBe(false);
    expect(glyphOf(created)).toBeDefined();
  });

  it('keeps the signal for the frame a quick tap is drawn after the sim resolved it', () => {
    const { markers, byClass, created } = build();
    markers.mount(entries());
    const [verb] = byClass(THREAT_CLASSES.verb);
    const path = created.find((element) => element.attributes.get('d') === THREAT_ICON_PATHS.eyes);
    markers.update([threat(4, 'windowOpen')], null, null);
    markers.update([threat(4, 'resolved')], 4, null);
    expect(verb?.textContent).toBe('<verb.go>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.eyelids);
    // Then the marker goes, and the next round starts again from the open eye.
    markers.update([threat(4, 'resolved')], null, null);
    expect(verb?.textContent).toBe('<verb.wait>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.eyes);
  });

  it('draws the same DOM before the signal whatever instant the sim drew for it (no leak)', () => {
    const drawn = (windowOpenAt: number) => {
      const { markers, created } = build();
      markers.mount(entries());
      for (const state of ['telegraph', 'telegraph', 'telegraph'] as const) {
        markers.update([threat(4, state, windowOpenAt)], null, null);
      }
      return created.map((element) => ({
        log: element.log,
        text: element.textContent,
        classes: [...element.classes],
        vars: [...element.vars],
        display: element.style.display,
      }));
    };
    expect(drawn(2000)).toEqual(drawn(6000));
  });

  it('shows the signal with no colour change: the pair of shape and colour stays', () => {
    const { markers, created } = build();
    markers.mount(entries());
    markers.update([threat(4, 'telegraph')], null, null);
    const before = created.map((element) => [...element.vars]);
    markers.update([threat(4, 'windowOpen')], null, null);
    expect(created.map((element) => [...element.vars])).toEqual(before);
  });

  it('leaves a marker with no signal exactly as it was', () => {
    const { markers, byClass } = build();
    markers.mount([
      {
        threatId: 4,
        xM: 0,
        yM: 0,
        zM: 0,
        icon: 'bolt',
        followsPapa: false,
        verb: 'SOULÈVE !',
        iconShape: 'circle',
        color: 'parry',
        verbWidthPx: 0,
        verbHeightPx: 0,
        verbOffsetPx: 0,
      },
    ]);
    const [verb] = byClass(THREAT_CLASSES.verb);
    const [root] = byClass(THREAT_CLASSES.root);
    markers.update([threat(4, 'windowOpen')], null, null);
    expect(verb?.textContent).toBe('SOULÈVE !');
    expect(root?.classes.has(THREAT_CLASSES.signal)).toBe(false);
  });
});
