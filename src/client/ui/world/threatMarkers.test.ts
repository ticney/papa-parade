import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { ThreatInstance, ThreatState } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import {
  createThreatMarkers,
  THREAT_CLASSES,
  THREAT_ICON_PATHS,
  threatMarkerEntries,
} from './threatMarkers.ts';

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

const ENTRY = {
  threatId: 4,
  xM: -3.95,
  yM: 0.3,
  zM: 0.5,
  icon: 'bolt' as const,
  followsPapa: false,
};

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
      markers.update([threat(4, state)], null, null);
      expect(scene.children[0]?.visible, state).toBe(isShown);
      expect(markers.isAnyVisible, state).toBe(isShown);
      if (!isShown) expect(root?.style.display, state).toBe('none');
    }
  });

  it('highlights the pressed threat, once, and returns true only on the frame it appears', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    expect(markers.update([threat(4, 'telegraph')], null, null)).toBe(false);
    expect(highlight?.hidden).toBe(true);
    expect(markers.update([threat(4, 'telegraph')], 4, null)).toBe(true);
    expect(highlight?.hidden).toBe(false);
    expect(markers.update([threat(4, 'telegraph')], 4, null)).toBe(false);
    expect(highlight?.hidden).toBe(false);
  });

  it('highlights the auto-targeted threat, follows the target, and keeps the pressed one lit', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5 }]);
    const [first, second] = byClass(THREAT_CLASSES.highlight);
    const threats = [threat(4, 'telegraph'), threat(5, 'windowOpen')];
    expect(markers.update(threats, null, null)).toBe(false);
    expect([first?.hidden, second?.hidden]).toEqual([true, true]);
    // A target ring is no press: it makes no latency mark.
    expect(markers.update(threats, null, 4)).toBe(false);
    expect([first?.hidden, second?.hidden]).toEqual([false, true]);
    expect(markers.update(threats, null, 4)).toBe(false);
    // The target moves: one ring goes, the other appears.
    expect(markers.update(threats, null, 5)).toBe(false);
    expect([first?.hidden, second?.hidden]).toEqual([true, false]);
    // Pressed 4 while 5 is the target: both are lit.
    expect(markers.update(threats, 4, 5)).toBe(true);
    expect([first?.hidden, second?.hidden]).toEqual([false, false]);
    // No target any more: only the pressed one stays.
    expect(markers.update(threats, 4, null)).toBe(false);
    expect([first?.hidden, second?.hidden]).toEqual([false, true]);
  });

  it('marks the press even when the pressed threat is already the target, and only once', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    expect(markers.update([threat(4, 'telegraph')], null, 4)).toBe(false);
    // The press lands on the target whose ring is already up: the press is the new thing.
    expect(markers.update([threat(4, 'telegraph')], 4, 4)).toBe(true);
    expect(markers.update([threat(4, 'telegraph')], 4, 4)).toBe(false);
    expect(highlight?.hidden).toBe(false);
    // The press ends and the target goes: the ring goes with it.
    expect(markers.update([threat(4, 'telegraph')], null, null)).toBe(false);
    expect(highlight?.hidden).toBe(true);
  });

  it('never highlights a target that is not one of its threats, or not active', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    expect(markers.update([threat(4, 'telegraph')], null, 9)).toBe(false);
    expect(highlight?.hidden).toBe(true);
  });

  it('does not highlight another threat', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    expect(markers.update([threat(4, 'windowOpen')], 9, null)).toBe(false);
    expect(highlight?.hidden).toBe(true);
  });

  it('still shows and highlights the pressed threat in the frame the sim resolved it, then hides it once forgotten', () => {
    const { markers, scene, byClass } = build();
    markers.mount([ENTRY]);
    const [highlight] = byClass(THREAT_CLASSES.highlight);
    // A quick tap: the press and its result land in the same step, before any frame drew the highlight.
    expect(markers.update([threat(4, 'resolved')], 4, null)).toBe(true);
    expect(scene.children[0]?.visible).toBe(true);
    expect(highlight?.hidden).toBe(false);
    expect(markers.isAnyVisible).toBe(true);
    // The caller forgets the press after that frame: the icon and the highlight go.
    expect(markers.update([threat(4, 'resolved')], null, null)).toBe(false);
    expect(scene.children[0]?.visible).toBe(false);
    expect(highlight?.hidden).toBe(true);
    expect(markers.isAnyVisible).toBe(false);
  });

  it('matches markers to threats by index, so two threats show independently', () => {
    const { markers, scene } = build();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5 }]);
    markers.update([threat(4, 'idle'), threat(5, 'telegraph')], null, null);
    expect(scene.children.map((child) => child.visible)).toEqual([false, true]);
  });

  it('tolerates fewer threats than markers', () => {
    const { markers } = build();
    markers.mount([ENTRY, { ...ENTRY, threatId: 5 }]);
    expect(() => markers.update([threat(4, 'telegraph')], null, null)).not.toThrow();
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
    markers.update([threat(7, 'telegraph'), threat(8, 'windowOpen')], 7, null);
    expect(scene.children.map((child) => child.visible)).toEqual([false, false]);
    expect(markers.isAnyVisible).toBe(false);
    markers.update([threat(7, 'telegraph'), threat(8, 'windowOpen')], null, null);
    expect(countWarnings()).toBe(before + 1);
    markers.mount([ENTRY]);
    markers.update([threat(9, 'telegraph')], null, null);
    expect(countWarnings()).toBe(before + 2);
  });

  it('replaces the previous level on mount and empties on unmount', () => {
    const { markers, scene } = build();
    markers.mount([ENTRY]);
    markers.update([threat(4, 'telegraph')], null, null);
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

describe('the glyph of a marker', () => {
  const glyphOf = (element: FakeElement): string | undefined =>
    element.children[0]?.children[0]?.attributes.get('d');

  it('is the path of its entry icon, one per ThreatIcon', () => {
    const { markers, byClass } = build();
    markers.mount([
      { ...ENTRY, threatId: 1, icon: 'bolt' },
      { ...ENTRY, threatId: 2, icon: 'stairs' },
      { ...ENTRY, threatId: 3, icon: 'mug' },
    ]);
    expect(byClass(THREAT_CLASSES.icon).map(glyphOf)).toEqual([
      THREAT_ICON_PATHS.bolt,
      THREAT_ICON_PATHS.stairs,
      THREAT_ICON_PATHS.mug,
    ]);
  });

  it('differs from one icon to the next', () => {
    expect(new Set(Object.values(THREAT_ICON_PATHS)).size).toBe(
      Object.keys(THREAT_ICON_PATHS).length,
    );
  });
});

describe('threatMarkerEntries', () => {
  const defs = {
    outlet: { icon: 'bolt', target: 'anchor' },
    stairs: { icon: 'stairs', target: 'anchor' },
    coffee_table_object: { icon: 'mug', target: 'anchor' },
    papa_microsleep: { icon: 'eyelids', target: 'papa' },
  } as const;
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
      defs,
    );
    expect(entries).toEqual([
      { threatId: 7, xM: -3.95, yM: 0.3, zM: 0.5, icon: 'bolt', followsPapa: false },
      { threatId: 8, xM: 1, yM: 0, zM: 2, icon: 'bolt', followsPapa: false },
    ]);
  });

  it('carries the icon of each threat def', () => {
    const entries = threatMarkerEntries(
      [
        { ...threat(7, 'idle'), defId: 'stairs', anchorId: 'door' },
        { ...threat(8, 'idle'), defId: 'coffee_table_object', anchorId: 'door' },
        { ...threat(9, 'idle'), defId: 'outlet', anchorId: 'door' },
      ],
      anchors,
      defs,
    );
    expect(entries.map((entry) => entry.icon)).toEqual(['stairs', 'mug', 'bolt']);
  });

  it('draws a bolt and warns for a threat whose def the level lacks', () => {
    const seen = log.buffer().length;
    const entries = threatMarkerEntries(
      [{ ...threat(7, 'idle'), defId: 'ghost', anchorId: 'door' }],
      anchors,
      defs,
    );
    expect(entries.map((entry) => entry.icon)).toEqual(['bolt']);
    expect(
      log
        .buffer()
        .slice(seen)
        .some((entry) => entry.level === 'warn' && /ghost/.test(entry.message)),
    ).toBe(true);
  });

  it('is empty for a level without threats', () => {
    expect(threatMarkerEntries([], anchors, defs)).toEqual([]);
  });

  it('falls back to the threat floor point when the room lacks the anchor', () => {
    const entries = threatMarkerEntries(
      [{ ...threat(7, 'idle'), anchorId: 'ghost', xM: 2, zM: 3 }],
      anchors,
      defs,
    );
    expect(entries).toEqual([
      { threatId: 7, xM: 2, yM: 0, zM: 3, icon: 'bolt', followsPapa: false },
    ]);
  });
});

describe('a marker that follows Papa (story 1.19)', () => {
  const FOLLOWING = {
    threatId: 9,
    xM: 1,
    yM: 1.2,
    zM: 1,
    icon: 'eyelids' as const,
    followsPapa: true,
  };
  const microSleep = (state: ThreatState): Readonly<ThreatInstance> =>
    ({
      ...threat(9, state),
      defId: 'papa_microsleep',
      anchorId: 'papa',
    }) as Readonly<ThreatInstance>;

  it('builds its entry on Papa, at the height of his head, with no anchor lookup and no warn', () => {
    const seen = log.buffer().length;
    const entries = threatMarkerEntries([{ ...microSleep('idle'), xM: 2, zM: 3 }], [], {
      papa_microsleep: { icon: 'eyelids', target: 'papa' },
    });
    expect(entries).toEqual([
      expect.objectContaining({ threatId: 9, xM: 2, zM: 3, icon: 'eyelids', followsPapa: true }),
    ]);
    expect(entries[0]?.yM).toBeGreaterThan(PAPA_HEIGHT_M);
    expect(
      log
        .buffer()
        .slice(seen)
        .filter((entry) => entry.level === 'warn'),
    ).toEqual([]);
  });

  it('moves with the pose it is given, its entry (the hit test reads it) and its object together', () => {
    const { markers, scene } = build();
    const entry = { ...FOLLOWING };
    markers.mount([entry]);
    markers.update([microSleep('telegraph')], null, null, { xM: 4, zM: -2 });
    expect([entry.xM, entry.zM]).toEqual([4, -2]);
    expect(scene.children[0]?.position.toArray()).toEqual([4, 1.2, -2]);
    markers.update([microSleep('windowOpen')], null, null, { xM: 5, zM: -2.5 });
    expect([entry.xM, entry.zM]).toEqual([5, -2.5]);
    expect(markers.entries[0]).toBe(entry);
  });

  it('stays where it was with no pose, and an anchored marker never moves', () => {
    const { markers, scene } = build();
    const following = { ...FOLLOWING };
    const anchored = { ...ENTRY };
    markers.mount([following, anchored]);
    markers.update([microSleep('telegraph'), threat(4, 'telegraph')], null, null, null);
    expect([following.xM, following.zM]).toEqual([1, 1]);
    markers.update([microSleep('telegraph'), threat(4, 'telegraph')], null, null, { xM: 9, zM: 9 });
    expect([anchored.xM, anchored.zM]).toEqual([ENTRY.xM, ENTRY.zM]);
    expect(scene.children[1]?.position.x).toBe(ENTRY.xM);
  });

  it('draws the closed eye glyph', () => {
    expect(THREAT_ICON_PATHS.eyelids).toMatch(/^M/);
  });
});

describe('a silence in a hidden zone (story 1.21)', () => {
  it('builds its entry on the point the sim chose for it, at the baby height, with no anchor lookup and no warn', () => {
    const seen = log.buffer().length;
    const silence = {
      ...threat(11, 'hidden'),
      defId: 'silence_mischief',
      anchorId: 'behind_sofa',
      xM: 0.5,
      zM: -2.6,
    } as Readonly<ThreatInstance>;
    const entries = threatMarkerEntries([silence], [], {
      silence_mischief: { icon: 'dots', target: 'hiddenZone' },
    });
    expect(entries).toEqual([
      { threatId: 11, xM: 0.5, yM: expect.any(Number), zM: -2.6, icon: 'dots', followsPapa: false },
    ]);
    expect(entries[0]?.yM).toBeGreaterThan(0);
    expect(
      log
        .buffer()
        .slice(seen)
        .filter((entry) => entry.level === 'warn'),
    ).toEqual([]);
  });

  it('draws three dots', () => {
    expect(THREAT_ICON_PATHS.dots).toMatch(/^M/);
    expect(THREAT_ICON_PATHS.dots.match(/a2\.2/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
