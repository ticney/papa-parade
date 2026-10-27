import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { ThreatInstance, ThreatState } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createThreatMarkers, THREAT_CLASSES, threatMarkerEntries } from './threatMarkers.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  hidden = false;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
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
  const scene = new Scene();
  const markers = createThreatMarkers(scene, doc);
  const byClass = (name: string): FakeElement[] =>
    created.filter((element) => element.className === name);
  return { scene, markers, created, byClass };
}

const threat = (id: number, state: ThreatState): Readonly<ThreatInstance> =>
  ({
    id,
    defId: 'outlet',
    anchorId: 'outlet_01',
    xM: 0,
    zM: 0,
    state,
    enteredAt: asSimMs(0),
  }) as Readonly<ThreatInstance>;

const ENTRY = { threatId: 4, xM: -3.95, yM: 0.3, zM: 0.5 };

describe('createThreatMarkers', () => {
  it('mounts one hidden marker per entry, at the anchor position, hidden from assistive tech', () => {
    const { markers, scene, byClass } = build();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5, xM: 1 }]);
    expect(scene.children).toHaveLength(2);
    expect(scene.children[0]?.position.toArray()).toEqual([-3.95, 0.3, 0.5]);
    expect(scene.children.every((child) => !child.visible)).toBe(true);
    const roots = byClass(THREAT_CLASSES.root);
    expect(roots).toHaveLength(2);
    expect(roots[0]?.attributes.get('aria-hidden')).toBe('true');
    expect(roots[0]?.style.display).toBe('none');
    expect(markers.isAnyVisible).toBe(false);
    expect(markers.entries).toHaveLength(2);
  });

  it('holds a halo, a highlight, a chevron and an icon in each marker, the highlight and chevron hidden', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [root] = byClass(THREAT_CLASSES.root);
    expect(root?.children.map((child) => child.className || 'svg')).toEqual([
      THREAT_CLASSES.halo,
      THREAT_CLASSES.highlight,
      'svg',
      THREAT_CLASSES.icon,
    ]);
    expect(byClass(THREAT_CLASSES.highlight)[0]?.hidden).toBe(true);
    expect(root?.children[2]?.attributes.has('hidden')).toBe(true);
  });

  it('shows the marker while the threat is in telegraph or windowOpen, and only then', () => {
    const { markers, scene, byClass } = build();
    markers.mount([ENTRY]);
    const [root] = byClass(THREAT_CLASSES.root);
    for (const [state, isShown] of [
      ['idle', false],
      ['telegraph', true],
      ['windowOpen', true],
      ['resolved', false],
      ['gag', false],
      ['idle', false],
    ] as const) {
      markers.update([threat(4, state)], null);
      expect(scene.children[0]?.visible, state).toBe(isShown);
      expect(markers.isAnyVisible, state).toBe(isShown);
      if (!isShown) expect(root?.style.display, state).toBe('none');
    }
  });

  it('highlights the pressed threat, once, and returns true only on the frame it appears', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    expect(markers.update([threat(4, 'telegraph')], null)).toBe(false);
    expect(highlight?.hidden).toBe(true);
    expect(markers.update([threat(4, 'telegraph')], 4)).toBe(true);
    expect(highlight?.hidden).toBe(false);
    expect(markers.update([threat(4, 'telegraph')], 4)).toBe(false);
    expect(highlight?.hidden).toBe(false);
  });

  it('does not highlight another threat', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    expect(markers.update([threat(4, 'windowOpen')], 9)).toBe(false);
    expect(highlight?.hidden).toBe(true);
  });

  it('still shows and highlights the pressed threat in the frame the sim resolved it, then hides it once forgotten', () => {
    const { markers, scene, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    // A quick tap: the press and its result land in the same step, before any frame drew the highlight.
    expect(markers.update([threat(4, 'resolved')], 4)).toBe(true);
    expect(scene.children[0]?.visible).toBe(true);
    expect(highlight?.hidden).toBe(false);
    expect(markers.isAnyVisible).toBe(true);
    // The caller forgets the press after that frame: the icon and the highlight go.
    expect(markers.update([threat(4, 'resolved')], null)).toBe(false);
    expect(scene.children[0]?.visible).toBe(false);
    expect(highlight?.hidden).toBe(true);
    expect(markers.isAnyVisible).toBe(false);
  });

  it('matches markers to threats by index, so two threats show independently', () => {
    const { markers, scene } = build();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5 }]);
    markers.update([threat(4, 'idle'), threat(5, 'telegraph')], null);
    expect(scene.children.map((child) => child.visible)).toEqual([false, true]);
  });

  it('tolerates fewer threats than markers', () => {
    const { markers } = build();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5 }]);
    expect(() => markers.update([threat(4, 'telegraph')], null)).not.toThrow();
    expect(markers.isAnyVisible).toBe(true);
  });

  it('skips a marker whose threat is not its own (ids differ) and warns once per mount', () => {
    const { markers, scene } = build();
    const countWarnings = (): number =>
      log.buffer().filter((entry) => entry.level === 'warn' && /not aligned/.test(entry.message))
        .length;
    const before = countWarnings();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5 }]);
    // The world of another level: ids 7 and 8 against the entries 4 and 5.
    markers.update([threat(7, 'telegraph'), threat(8, 'windowOpen')], 7);
    expect(scene.children.map((child) => child.visible)).toEqual([false, false]);
    expect(markers.isAnyVisible).toBe(false);
    markers.update([threat(7, 'telegraph'), threat(8, 'windowOpen')], null);
    expect(countWarnings()).toBe(before + 1);
    markers.mount([ENTRY]);
    markers.update([threat(9, 'telegraph')], null);
    expect(countWarnings()).toBe(before + 2);
  });

  it('replaces the previous level on mount and empties on unmount', () => {
    const { markers, scene } = build();
    markers.mount([ENTRY]);
    markers.update([threat(4, 'telegraph')], null);
    markers.mount([ENTRY]);
    expect(scene.children).toHaveLength(1);
    expect(markers.isAnyVisible).toBe(false);
    markers.unmount();
    expect(scene.children).toHaveLength(0);
    expect(markers.entries).toEqual([]);
  });

  it('exposes the entries it was mounted with, as the same objects', () => {
    const { markers } = build();
    const entries = [ENTRY];
    markers.mount(entries);
    expect(markers.entries).toBe(entries);
  });
});

describe('threatMarkerEntries', () => {
  const anchors = [
    { id: 'door', positionM: [1, 0, 2] as const },
    { id: 'outlet_01', positionM: [-3.95, 0.3, 0.5] as const },
  ];

  it('puts each threat at the position of its anchor, in the order of the threats', () => {
    const entries = threatMarkerEntries(
      [
        { ...threat(7, 'idle'), anchorId: 'outlet_01' },
        { ...threat(8, 'idle'), anchorId: 'door' },
      ],
      anchors,
    );
    expect(entries).toEqual([
      { threatId: 7, xM: -3.95, yM: 0.3, zM: 0.5 },
      { threatId: 8, xM: 1, yM: 0, zM: 2 },
    ]);
  });

  it('is empty for a level without threats', () => {
    expect(threatMarkerEntries([], anchors)).toEqual([]);
  });

  it('falls back to the threat floor point when the room lacks the anchor', () => {
    const entries = threatMarkerEntries(
      [{ ...threat(7, 'idle'), anchorId: 'ghost', xM: 2, zM: 3 }],
      anchors,
    );
    expect(entries).toEqual([{ threatId: 7, xM: 2, yM: 0, zM: 3 }]);
  });
});
