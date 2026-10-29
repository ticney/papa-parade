import {
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  VERB_MAX_WIDTH_PCT,
  VERB_MIN_FONT_PX,
  VERB_STACK_GAP_PX,
  VERB_STROKE_PX,
} from '@shared/constants';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import type { ThreatInstance, ThreatState } from '@sim';
import { OrthographicCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import {
  createThreatMarkers,
  THREAT_CLASSES,
  THREAT_ICON_PATHS,
  threatMarkerEntries,
} from './threatMarkers.ts';
import type { VerbMetrics } from './verbMetrics.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  hidden = false;
  /** Custom properties written with `style.setProperty` (the hold-ring's progress and sizes). */
  vars = new Map<string, string>();
  /** How many times each style property was written (`setProperty` counts under the property's name). */
  writes: Record<string, number> = {};
  textContent = '';
  style: Record<string, unknown> = new Proxy(
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

/** A translator that shows which key it was given. */
const t = (key: string): string => `<${key}>`;

const threat = (id: number, state: ThreatState): Readonly<ThreatInstance> =>
  ({
    id,
    defId: 'outlet',
    anchorId: 'outlet_01',
    xM: 0,
    zM: 0,
    state,
    enteredAt: asSimMs(0),
    windowOpenAt: asSimMs(1000),
    responseWindow: null,
  }) as Readonly<ThreatInstance>;

const ENTRY = {
  threatId: 4,
  xM: -3.95,
  yM: 0.3,
  zM: 0.5,
  icon: 'bolt' as const,
  followsPapa: false,
  verb: '',
  iconShape: 'circle' as const,
  color: 'parry' as const,
  verbWidthPx: 0,
  verbHeightPx: 0,
  verbOffsetPx: 0,
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

  it('holds a halo, a hold-ring, a highlight, a verb stack (chevron) and an icon in each marker, the ring, highlight and chevron hidden', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    const [root] = byClass(THREAT_CLASSES.root);
    expect(root?.children.map((child) => child.className || 'svg')).toEqual([
      THREAT_CLASSES.halo,
      THREAT_CLASSES.hold,
      THREAT_CLASSES.highlight,
      THREAT_CLASSES.verbStack,
      THREAT_CLASSES.icon,
    ]);
    expect(byClass(THREAT_CLASSES.highlight)[0]?.hidden).toBe(true);
    expect(byClass(THREAT_CLASSES.hold)[0]?.hidden).toBe(true);
    // The chevron is the first child of the stack, over the verb.
    expect(root?.children[3]?.children[0]?.attributes.has('hidden')).toBe(true);
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
  const parry = { iconShape: 'circle', color: 'parry', response: 'parry' } as const;
  const defs = {
    outlet: { icon: 'bolt', target: 'anchor', verbKey: 'verb.lift', ...parry },
    stairs: { icon: 'stairs', target: 'anchor', verbKey: 'verb.catch', ...parry },
    coffee_table_object: { icon: 'mug', target: 'anchor', verbKey: 'verb.remove', ...parry },
    papa_microsleep: { icon: 'eyelids', target: 'papa', verbKey: 'verb.wake_up', ...parry },
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
      0.2,
      t,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        threatId: 7,
        xM: -3.95,
        yM: 0.3,
        zM: 0.5,
        icon: 'bolt',
        followsPapa: false,
      }),
      expect.objectContaining({
        threatId: 8,
        xM: 1,
        yM: 0,
        zM: 2,
        icon: 'bolt',
        followsPapa: false,
      }),
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
      0.2,
      t,
    );
    expect(entries.map((entry) => entry.icon)).toEqual(['stairs', 'mug', 'bolt']);
  });

  it('draws a bolt and warns for a threat whose def the level lacks', () => {
    const seen = log.buffer().length;
    const entries = threatMarkerEntries(
      [{ ...threat(7, 'idle'), defId: 'ghost', anchorId: 'door' }],
      anchors,
      defs,
      0.2,
      t,
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
    expect(threatMarkerEntries([], anchors, defs, 0.2, t)).toEqual([]);
  });

  it('falls back to the threat floor point when the room lacks the anchor', () => {
    const entries = threatMarkerEntries(
      [{ ...threat(7, 'idle'), anchorId: 'ghost', xM: 2, zM: 3 }],
      anchors,
      defs,
      0.2,
      t,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        threatId: 7,
        xM: 2,
        yM: 0,
        zM: 3,
        icon: 'bolt',
        followsPapa: false,
      }),
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
    verb: '',
    iconShape: 'circle' as const,
    color: 'parry' as const,
    verbWidthPx: 0,
    verbHeightPx: 0,
    verbOffsetPx: 0,
  };
  const microSleep = (state: ThreatState): Readonly<ThreatInstance> =>
    ({
      ...threat(9, state),
      defId: 'papa_microsleep',
      anchorId: 'papa',
    }) as Readonly<ThreatInstance>;

  it('builds its entry on Papa, at the height of his head, with no anchor lookup and no warn', () => {
    const seen = log.buffer().length;
    const entries = threatMarkerEntries(
      [{ ...microSleep('idle'), xM: 2, zM: 3 }],
      [],
      {
        papa_microsleep: {
          icon: 'eyelids',
          target: 'papa',
          verbKey: 'verb.wake_up',
          iconShape: 'circle',
          color: 'parry',
          response: 'parry',
        },
      },
      0.2,
      t,
    );
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
    const entries = threatMarkerEntries(
      [silence],
      [],
      {
        silence_mischief: {
          icon: 'dots',
          target: 'hiddenZone',
          verbKey: 'verb.lift',
          iconShape: 'circle',
          color: 'parry',
          response: 'parry',
        },
      },
      0.25,
      t,
    );
    expect(entries).toEqual([
      expect.objectContaining({
        threatId: 11,
        xM: 0.5,
        yM: expect.any(Number),
        zM: -2.6,
        icon: 'dots',
        followsPapa: false,
      }),
    ]);
    // Above the baby's body, whose size is the feel's: twice his radius plus the marker offset.
    expect(entries[0]?.yM).toBeCloseTo(0.25 * 2 + 0.3, 9);
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

describe('the hold-ring (story 1.23)', () => {
  const HOLD_MIN_MS = 400;
  const PRESS_T = 2000;

  /** A threat with a pending press made at `PRESS_T`. */
  const pressed = (
    overrides: Partial<NonNullable<ThreatInstance['press']>> = {},
    state: ThreatState = 'windowOpen',
  ): Readonly<ThreatInstance> =>
    ({
      ...threat(4, state),
      press: {
        t: asSimMs(PRESS_T),
        quality: 'perfect',
        offsetMs: 0,
        releasedAt: null,
        heldAt: null,
        ...overrides,
      },
    }) as Readonly<ThreatInstance>;

  const setup = () => {
    const built = build();
    built.markers.mount([ENTRY]);
    const ring = built.byClass(THREAT_CLASSES.hold)[0] as FakeElement;
    const update = (t: Readonly<ThreatInstance>, renderSimMs: number | null) =>
      built.markers.update([t], null, null, null, renderSimMs, HOLD_MIN_MS);
    return { ...built, ring, update };
  };

  it('is built from the constants of DESIGN.md: a band wider than the icon, an ink outline', () => {
    const { ring } = setup();
    expect(ring.style.inset).toBe(`-${HOLD_RING_STROKE_PX}px`);
    expect(ring.style.boxShadow).toBe(`0 0 0 ${HOLD_RING_OUTLINE_PX}px var(--pp-color-ink)`);
  });

  it('is hidden while there is no press, or no render time', () => {
    const { ring, update } = setup();
    update(threat(4, 'windowOpen'), PRESS_T + 100);
    expect(ring.hidden).toBe(true);
    update(pressed(), null);
    expect(ring.hidden).toBe(true);
  });

  it('fills with the sim time since the press, over holdMinMs', () => {
    const { ring, update } = setup();
    update(pressed(), PRESS_T);
    expect(ring.hidden).toBe(false);
    expect(ring.vars.get('--pp-hold-progress')).toBe('0');
    update(pressed(), PRESS_T + HOLD_MIN_MS / 2);
    expect(ring.vars.get('--pp-hold-progress')).toBe('50');
    update(pressed(), PRESS_T + HOLD_MIN_MS * 0.999);
    expect(ring.vars.get('--pp-hold-progress')).toBe('99');
    expect(ring.classes.has(THREAT_CLASSES.holdClosed)).toBe(false);
  });

  it('never reads past full before the sim has closed it, nor below empty', () => {
    const { ring, update } = setup();
    update(pressed(), PRESS_T + HOLD_MIN_MS * 3);
    expect(ring.vars.get('--pp-hold-progress')).toBe('99');
    update(pressed(), PRESS_T - 100);
    expect(ring.vars.get('--pp-hold-progress')).toBe('0');
  });

  it('closes solid when the sim says the press was held, whatever the render time', () => {
    const { ring, update } = setup();
    update(pressed({ heldAt: asSimMs(PRESS_T + HOLD_MIN_MS) }), PRESS_T + HOLD_MIN_MS - 20);
    expect(ring.vars.get('--pp-hold-progress')).toBe('100');
    expect(ring.classes.has(THREAT_CLASSES.holdClosed)).toBe(true);
  });

  it('goes when the finger is released before it closes (a Parry)', () => {
    const { ring, update } = setup();
    update(pressed(), PRESS_T + 100);
    expect(ring.hidden).toBe(false);
    update(pressed({ releasedAt: asSimMs(PRESS_T + 120) }), PRESS_T + 120);
    expect(ring.hidden).toBe(true);
  });

  it('goes with the press when the threat resolves, and starts again, open, on the next press', () => {
    const { ring, update } = setup();
    update(pressed({ heldAt: asSimMs(PRESS_T + HOLD_MIN_MS) }), PRESS_T + HOLD_MIN_MS);
    expect(ring.classes.has(THREAT_CLASSES.holdClosed)).toBe(true);
    update(threat(4, 'resolved'), PRESS_T + HOLD_MIN_MS + 10);
    expect(ring.hidden).toBe(true);
    expect(ring.classes.has(THREAT_CLASSES.holdClosed)).toBe(false);
    update(pressed(), PRESS_T + 10);
    expect(ring.hidden).toBe(false);
    expect(ring.classes.has(THREAT_CLASSES.holdClosed)).toBe(false);
  });

  it('writes the DOM only when the whole percent, the closed state or the visibility changes', () => {
    const { ring, update } = setup();
    let writes = 0;
    const base = ring.vars;
    ring.vars = new Map(base);
    ring.vars.set = (name: string, value: string) => {
      writes++;
      return Map.prototype.set.call(ring.vars, name, value);
    };
    update(pressed(), PRESS_T + 100);
    update(pressed(), PRESS_T + 100);
    update(pressed(), PRESS_T + 100.4);
    expect(writes).toBe(1);
    update(pressed(), PRESS_T + 120);
    expect(writes).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Story 2.2: the verb, the shape and the colour of a marker.
// ---------------------------------------------------------------------------------------------

describe('threatMarkerEntries: verb, shape and colour (story 2.2)', () => {
  const anchors = [{ id: 'outlet_01', positionM: [1, 0, 2] as const }];
  const circleDef = {
    icon: 'bolt',
    target: 'anchor',
    verbKey: 'verb.lift',
    iconShape: 'circle',
    color: 'parry',
    response: 'parry',
  } as const;
  const build1 = (def: Parameters<typeof threatMarkerEntries>[2][string] | undefined) =>
    threatMarkerEntries(
      [threat(7, 'idle')],
      anchors,
      def === undefined ? {} : { outlet: def },
      0.2,
      t,
    );

  it('translates the verb key of the def, once, at build', () => {
    const [entry] = build1(circleDef);
    expect(entry?.verb).toBe('<verb.lift>');
  });

  it('copies the shape and the colour of the def', () => {
    const [circle] = build1(circleDef);
    expect([circle?.iconShape, circle?.color]).toEqual(['circle', 'parry']);
    const [triangle] = build1({
      ...circleDef,
      iconShape: 'triangle',
      color: 'dodge',
      response: 'dodge',
    });
    expect([triangle?.iconShape, triangle?.color]).toEqual(['triangle', 'dodge']);
  });

  it('shows « ESQUIVE ! » (verb.dodge) for a dodge def whose verbKey is null', () => {
    const [entry] = build1({
      ...circleDef,
      verbKey: null,
      iconShape: 'triangle',
      color: 'dodge',
      response: 'dodge',
    });
    expect(entry?.verb).toBe('<verb.dodge>');
  });

  it('keeps its own verb for a dodge def that writes one (the default is only a default)', () => {
    const [entry] = build1({
      ...circleDef,
      verbKey: 'verb.swap',
      iconShape: 'triangle',
      color: 'dodge',
      response: 'dodge',
    });
    expect(entry?.verb).toBe('<verb.swap>');
  });

  it('shows no verb for a null key on a response with no default verb', () => {
    const [entry] = build1({ ...circleDef, verbKey: null });
    expect(entry?.verb).toBe('');
  });

  it('shows no verb, and warns, when the translator gives the key back (a string the level lacks)', () => {
    const seen = log.buffer().length;
    const [entry] = threatMarkerEntries(
      [threat(7, 'idle')],
      anchors,
      { outlet: circleDef },
      0.2,
      (key) => key,
    );
    expect(entry?.verb).toBe('');
    const warns = log
      .buffer()
      .slice(seen)
      .filter((record) => record.level === 'warn' && /verb\.lift/.test(record.message));
    expect(warns).toHaveLength(1);
  });

  it('starts every entry with no laid-out verb box', () => {
    const [entry] = build1(circleDef);
    expect([entry?.verbWidthPx, entry?.verbHeightPx, entry?.verbOffsetPx]).toEqual([0, 0, 0]);
  });

  it('falls back to a bolt, in a parry circle, with no verb, and warns once, for a def the level lacks', () => {
    const seen = log.buffer().length;
    const [entry] = build1(undefined);
    expect(entry).toMatchObject({ icon: 'bolt', iconShape: 'circle', color: 'parry', verb: '' });
    const warns = log
      .buffer()
      .slice(seen)
      .filter((record) => record.level === 'warn');
    expect(warns).toHaveLength(1);
  });

  it('gives the verb of each of the three threats and the two Papa-side ones', () => {
    const keys: Record<string, string> = {
      outlet: 'verb.lift',
      stairs: 'verb.catch',
      coffee_table_object: 'verb.remove',
      papa_microsleep: 'verb.wake_up',
      silence_mischief: 'verb.lift',
    };
    const defs = Object.fromEntries(
      Object.entries(keys).map(([id, verbKey]) => [id, { ...circleDef, verbKey }]),
    );
    const entries = threatMarkerEntries(
      Object.keys(keys).map((defId, index) => ({
        ...threat(index + 1, 'idle'),
        defId,
        anchorId: 'outlet_01',
      })),
      anchors,
      defs,
      0.2,
      t,
    );
    expect(entries.map((entry) => entry.verb)).toEqual(
      Object.values(keys).map((key) => `<${key}>`),
    );
  });
});

describe('the verb and shape of a marker (story 2.2)', () => {
  const withVerb = { ...ENTRY, verb: 'SOULÈVE !' };

  it('puts the verb above the icon, after the chevron, in the marker, with the outline from the constant', () => {
    const { markers, byClass } = build();
    markers.mount([withVerb]);
    const [root] = byClass(THREAT_CLASSES.root);
    const stack = root?.children[3];
    expect(stack?.className).toBe(THREAT_CLASSES.verbStack);
    expect(stack?.children.map((child) => child.className || 'svg')).toEqual([
      'svg',
      THREAT_CLASSES.verb,
    ]);
    // The icon comes after: the verb stack is above it in the layer, not the other way round.
    expect(root?.children[4]?.className).toBe(THREAT_CLASSES.icon);
    const [verb] = byClass(THREAT_CLASSES.verb);
    expect(verb?.textContent).toBe('SOULÈVE !');
    // `paint-order: stroke` hides the inner half of the stroke: twice DESIGN's width is set.
    expect(verb?.vars.get('-webkit-text-stroke')).toBe(
      `${VERB_STROKE_PX * 2}px var(--pp-color-ink)`,
    );
  });

  it('makes no verb element for an entry with no verb, and keeps the chevron', () => {
    const { markers, byClass } = build();
    markers.mount([ENTRY]);
    expect(byClass(THREAT_CLASSES.verb)).toEqual([]);
    const [stack] = byClass(THREAT_CLASSES.verbStack);
    expect(stack?.children).toHaveLength(1);
  });

  it('shows and hides the verb with its marker, never separately', () => {
    const { markers, byClass, scene } = build();
    markers.mount([withVerb]);
    const [root] = byClass(THREAT_CLASSES.root);
    expect(scene.children).toHaveLength(1);
    expect(byClass(THREAT_CLASSES.verb)).toHaveLength(1);
    markers.update([threat(4, 'telegraph')], null, null);
    expect(scene.children[0]?.visible).toBe(true);
    markers.update([threat(4, 'resolved')], null, null);
    expect(scene.children[0]?.visible).toBe(false);
    expect(root?.style.display).toBe('none');
  });

  it('shows the chevron over the verb only for the targeted marker', () => {
    const { markers, byClass } = build();
    markers.mount([withVerb]);
    const [stack] = byClass(THREAT_CLASSES.verbStack);
    markers.update([threat(4, 'telegraph')], null, null);
    expect(stack?.children[0]?.attributes.has('hidden')).toBe(true);
    markers.update([threat(4, 'telegraph')], null, 4);
    expect(stack?.children[0]?.attributes.has('hidden')).toBe(false);
  });

  it('draws a circle by default: the icon has no modifier, the colour is the parry token', () => {
    const { markers, byClass } = build();
    markers.mount([withVerb]);
    const [icon] = byClass(THREAT_CLASSES.icon);
    // The glyph is an SVG: its class is an attribute, not a `className`.
    expect(icon?.children.map((child) => child.attributes.get('class'))).toEqual([
      THREAT_CLASSES.glyph,
    ]);
    const [root] = byClass(THREAT_CLASSES.root);
    expect(root?.vars.get('--pp-threat-color')).toBe('var(--pp-color-parry)');
  });

  it('draws a dodge triangle from the def: modifier class, ink shadow and outlined polygons, the dodge colour', () => {
    const { markers, byClass, created } = build();
    markers.mount([{ ...withVerb, iconShape: 'triangle', color: 'dodge' }]);
    const icon = created.find((element) => element.className.startsWith(THREAT_CLASSES.icon));
    expect(icon?.className).toBe(`${THREAT_CLASSES.icon} ${THREAT_CLASSES.iconTriangle}`);
    const [triangle, glyph] = icon?.children ?? [];
    expect(triangle?.attributes.get('class')).toBe(THREAT_CLASSES.triangle);
    expect(glyph?.attributes.get('class')).toBe(THREAT_CLASSES.glyph);
    // The hard ink shadow, then the coloured, outlined polygon.
    const [shadow, body] = triangle?.children ?? [];
    expect(shadow?.attributes.get('fill')).toBe('var(--pp-color-ink)');
    expect(shadow?.attributes.get('transform')).toMatch(/^translate\(0,\d+\)$/);
    expect(body?.attributes.get('fill')).toBe('var(--pp-threat-color)');
    expect(body?.attributes.get('stroke')).toBe('var(--pp-color-ink)');
    expect(body?.attributes.get('points')).toBe(shadow?.attributes.get('points'));
    const [root] = byClass(THREAT_CLASSES.root);
    expect(root?.vars.get('--pp-threat-color')).toBe('var(--pp-color-dodge)');
  });

  it('keeps the halo, the highlight, the hold-ring and the glyph for a triangle', () => {
    const { markers, byClass } = build();
    markers.mount([{ ...withVerb, iconShape: 'triangle', color: 'dodge', icon: 'stairs' }]);
    const [root] = byClass(THREAT_CLASSES.root);
    expect(root?.children.map((child) => child.className)).toEqual([
      THREAT_CLASSES.halo,
      THREAT_CLASSES.hold,
      THREAT_CLASSES.highlight,
      THREAT_CLASSES.verbStack,
      `${THREAT_CLASSES.icon} ${THREAT_CLASSES.iconTriangle}`,
    ]);
    const icon = byClass(THREAT_CLASSES.root)[0]?.children[4];
    const glyph = icon?.children[1];
    expect(glyph?.attributes.get('class')).toBe(THREAT_CLASSES.glyph);
    expect(glyph?.children[0]?.attributes.get('d')).toBe(THREAT_ICON_PATHS.stairs);
  });
});

describe('the verb fit and layout of the markers (story 2.2)', () => {
  const LAYER = { widthPx: 800, heightPx: 400 };
  const MAX_PX = (LAYER.widthPx * VERB_MAX_WIDTH_PCT) / 100;

  /** A hand-made typography: every character is `charEm` of the font size wide. */
  function fakeMetrics(
    state: { surface: string; base: number; scale: number; charEm: number; lineHeight: number } = {
      surface: 'regular',
      base: 40,
      scale: 1,
      charEm: 0.5,
      lineHeight: 1,
    },
  ) {
    const measured: [string, number][] = [];
    const metrics: VerbMetrics = {
      surfaceKey: () => state.surface,
      basePx: () => state.base,
      lineHeight: () => state.lineHeight,
      scale: () => state.scale,
      widthPx: (text, fontPx) => {
        measured.push([text, fontPx]);
        return text.length * fontPx * state.charEm;
      },
    };
    return { metrics, state, measured };
  }

  /** One unit is 100 px, the camera looks straight at the z = 0 plane: x → 400 + 100x, y → 200 - 100y. */
  function camera(): OrthographicCamera {
    const cam = new OrthographicCamera(-4, 4, 2, -2, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld();
    return cam;
  }

  function setup(entries: ReturnType<typeof entryAt>[], typography = fakeMetrics()) {
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
    const markers = createThreatMarkers(new Scene(), doc, typography.metrics);
    markers.mount(entries);
    markers.setSize(LAYER.widthPx, LAYER.heightPx);
    const byClass = (name: string) => created.filter((element) => element.className === name);
    return { markers, byClass, ...typography };
  }

  /** An entry whose icon is at screen `(screenX, screenY)` in px. */
  function entryAt(threatId: number, verb: string, screenX: number, screenY: number) {
    return {
      ...ENTRY,
      threatId,
      verb,
      xM: (screenX - 400) / 100,
      yM: (200 - screenY) / 100,
      zM: 0,
    };
  }

  /** A telegraphed threat whose window closes at `closeAt` (sim ms). */
  const closing = (id: number, closeAt: number): Readonly<ThreatInstance> =>
    ({
      ...threat(id, 'telegraph'),
      windowOpenAt: asSimMs(closeAt - 600),
      responseWindow: { windowMs: 600, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
    }) as Readonly<ThreatInstance>;

  const verbOf = (byClass: (name: string) => FakeElement[], index: number) =>
    byClass(THREAT_CLASSES.verb)[index] as FakeElement;

  describe('refit', () => {
    it('leaves the CSS size alone until the layer has a size', () => {
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
      const { metrics, measured } = fakeMetrics();
      const markers = createThreatMarkers(new Scene(), doc, metrics);
      markers.mount([entryAt(1, 'SOULÈVE !', 400, 200)]);
      expect(measured).toEqual([]);
      expect(
        created.find((e) => e.className === THREAT_CLASSES.verb)?.style.fontSize,
      ).toBeUndefined();
    });

    it('keeps the base size for a verb that fits, and measures the uppercase text at the base size', () => {
      const { byClass, measured, markers } = setup([entryAt(1, 'Soulève !', 400, 200)]);
      expect(verbOf(byClass, 0).style.fontSize).toBe('40px');
      expect(measured).toEqual([['SOULÈVE !', 40]]);
      expect(markers.entries[0]?.verbWidthPx).toBeCloseTo(9 * 40 * 0.5 + 2 * VERB_STROKE_PX, 10);
      expect(markers.entries[0]?.verbHeightPx).toBe(40 + 2 * VERB_STROKE_PX);
    });

    it('shrinks a long verb so its box, outline included, is the share of the layer', () => {
      const long = 'X'.repeat(22);
      const { byClass, markers } = setup([entryAt(1, long, 400, 200)]);
      const advance = 22 * 40 * 0.5;
      const expected = Math.max(VERB_MIN_FONT_PX, (40 * (MAX_PX - 2 * VERB_STROKE_PX)) / advance);
      expect(advance + 2 * VERB_STROKE_PX).toBeGreaterThan(MAX_PX);
      expect(expected).toBeGreaterThan(VERB_MIN_FONT_PX);
      expect(verbOf(byClass, 0).style.fontSize).toBe(`${expected}px`);
      // The laid-out box never exceeds the maximum once it has been shrunk.
      expect(markers.entries[0]?.verbWidthPx).toBeCloseTo(MAX_PX, 8);
    });

    it('never goes under the floor: a verb still too wide at 28 px overflows, it is not cut', () => {
      const { byClass, markers } = setup([entryAt(1, 'X'.repeat(200), 400, 200)]);
      expect(verbOf(byClass, 0).style.fontSize).toBe(`${VERB_MIN_FONT_PX}px`);
      expect(markers.entries[0]?.verbWidthPx).toBeGreaterThan(MAX_PX);
      expect(verbOf(byClass, 0).textContent).toBe('X'.repeat(200));
    });

    it('refits on a new layer size', () => {
      const long = 'X'.repeat(22);
      const { byClass, markers } = setup([entryAt(1, long, 400, 200)]);
      const before = verbOf(byClass, 0).style.fontSize;
      markers.setSize(LAYER.widthPx * 2, LAYER.heightPx);
      expect(verbOf(byClass, 0).style.fontSize).not.toBe(before);
      markers.setSize(LAYER.widthPx * 10, LAYER.heightPx);
      expect(verbOf(byClass, 0).style.fontSize).toBe('40px');
    });

    it('refits on demand, after the fonts have loaded (a fallback font measures differently)', () => {
      const long = 'X'.repeat(22);
      const { byClass, markers, state } = setup([entryAt(1, long, 400, 200)]);
      const before = verbOf(byClass, 0).style.fontSize;
      state.charEm = 0.7;
      markers.refit();
      expect(verbOf(byClass, 0).style.fontSize).not.toBe(before);
    });

    it('uses the compact base size on the compact surface, and refits when the surface changes', () => {
      const { byClass, markers, state } = setup([entryAt(1, 'RETIRE !', 400, 200)]);
      expect(verbOf(byClass, 0).style.fontSize).toBe('40px');
      state.surface = 'compact';
      state.base = 32;
      markers.update([closing(1, 5000)], null, null);
      markers.layout(camera());
      expect(verbOf(byClass, 0).style.fontSize).toBe('32px');
    });

    it('multiplies the base size and the floor by --pp-verb-scale (« Grands verbes », story 2.10)', () => {
      const { byClass, markers, state } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'X'.repeat(200), 400, 100),
      ]);
      state.scale = 1.25;
      markers.refit();
      expect(verbOf(byClass, 0).style.fontSize).toBe('50px');
      expect(verbOf(byClass, 1).style.fontSize).toBe(`${VERB_MIN_FONT_PX * 1.25}px`);
    });

    it('writes the font size only when it changes', () => {
      const { byClass, markers } = setup([entryAt(1, 'RETIRE !', 400, 200)]);
      expect(verbOf(byClass, 0).writes.fontSize).toBe(1);
      markers.refit();
      markers.refit();
      expect(verbOf(byClass, 0).writes.fontSize).toBe(1);
    });

    it('skips an entry with no verb', () => {
      const { markers, measured } = setup([entryAt(1, '', 400, 200)]);
      expect(measured).toEqual([]);
      expect(markers.entries[0]?.verbWidthPx).toBe(0);
    });
  });

  describe('layout', () => {
    // 'RETIRE !' is 8 chars: 160 px + the outline wide, 40 + the outline high.
    const BOX_W = 8 * 40 * 0.5 + 2 * VERB_STROKE_PX;
    const BOX_H = 40 + 2 * VERB_STROKE_PX;

    it('does nothing while no marker is shown, or before the layer has a size', () => {
      const { markers, byClass } = setup([entryAt(1, 'RETIRE !', 400, 200)]);
      markers.layout(camera());
      expect(byClass(THREAT_CLASSES.verbStack)[0]?.writes['--pp-verb-offset']).toBeUndefined();
    });

    it('leaves verbs that do not overlap where they are, with no offset written', () => {
      const { markers, byClass } = setup([
        entryAt(1, 'RETIRE !', 150, 200),
        entryAt(2, 'RETIRE !', 650, 200),
      ]);
      markers.update([closing(1, 5000), closing(2, 6000)], null, null);
      markers.layout(camera());
      for (const stack of byClass(THREAT_CLASSES.verbStack)) {
        expect(stack.writes['--pp-verb-offset']).toBeUndefined();
      }
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([0, 0]);
    });

    it('pushes the less urgent of two overlapping verbs up and puts the most urgent marker in front', () => {
      const { markers, byClass } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 430, 200),
      ]);
      // Threat 2 closes first: it is the most urgent, whatever its index.
      markers.update([closing(1, 6000), closing(2, 5000)], null, null);
      markers.layout(camera());
      const [first, second] = byClass(THREAT_CLASSES.verbStack);
      expect(first?.vars.get('--pp-verb-offset')).toBe(`${BOX_H + VERB_STACK_GAP_PX}px`);
      expect(second?.writes['--pp-verb-offset']).toBeUndefined();
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([
        BOX_H + VERB_STACK_GAP_PX,
        0,
      ]);
      const [rootFirst, rootSecond] = byClass(THREAT_CLASSES.root);
      expect(Number(rootSecond?.style.zIndex)).toBeGreaterThan(Number(rootFirst?.style.zIndex));
    });

    it('breaks a tie of windows with the lower id', () => {
      const { markers, byClass } = setup([
        entryAt(9, 'RETIRE !', 400, 200),
        entryAt(4, 'RETIRE !', 400, 200),
      ]);
      markers.update([closing(9, 5000), closing(4, 5000)], null, null);
      markers.layout(camera());
      const [high, low] = byClass(THREAT_CLASSES.verbStack);
      expect(high?.vars.get('--pp-verb-offset')).toBe(`${BOX_H + VERB_STACK_GAP_PX}px`);
      expect(low?.writes['--pp-verb-offset']).toBeUndefined();
    });

    it('stacks three verbs, each clear of the ones in front of it', () => {
      const { markers, byClass } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 400, 200),
        entryAt(3, 'RETIRE !', 400, 200),
      ]);
      markers.update([closing(1, 5000), closing(2, 6000), closing(3, 7000)], null, null);
      markers.layout(camera());
      const step = Math.ceil(BOX_H) + VERB_STACK_GAP_PX;
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([0, step, 2 * step]);
      const zs = byClass(THREAT_CLASSES.root).map((root) => Number(root.style.zIndex));
      expect(zs[0]).toBeGreaterThan(zs[1] as number);
      expect(zs[1]).toBeGreaterThan(zs[2] as number);
    });

    it('ignores a marker whose threat is not active: it neither pushes nor is pushed', () => {
      const { markers } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 400, 200),
      ]);
      markers.update([closing(1, 5000), threat(2, 'idle')], null, null);
      markers.layout(camera());
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([0, 0]);
    });

    it('ranks the z-index over the shown markers only, so the glyph chip stays above them all', () => {
      const { markers, byClass } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 400, 200),
        entryAt(3, 'RETIRE !', 400, 200),
      ]);
      markers.update([closing(1, 5000), closing(2, 6000), threat(3, 'idle')], null, null);
      markers.layout(camera());
      const zs = byClass(THREAT_CLASSES.root).map((root) => Number(root.style.zIndex));
      expect(zs[0]).toBe(2);
      expect(zs[1]).toBe(1);
    });

    it('lets go of the offset once the overlap is gone', () => {
      const { markers, byClass } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 400, 200),
      ]);
      markers.update([closing(1, 5000), closing(2, 6000)], null, null);
      markers.layout(camera());
      expect(markers.entries[1]?.verbOffsetPx).toBeGreaterThan(0);
      markers.update([closing(1, 5000), threat(2, 'idle')], null, null);
      markers.update([closing(1, 5000), closing(2, 6000)], null, null);
      // The first threat resolves: the second is the only one left, back at 0.
      markers.update([threat(1, 'resolved'), closing(2, 6000)], null, null);
      markers.layout(camera());
      expect(markers.entries[1]?.verbOffsetPx).toBe(0);
      expect(byClass(THREAT_CLASSES.verbStack)[1]?.vars.get('--pp-verb-offset')).toBe('0px');
    });

    it('writes the DOM only when an offset or a rank changes', () => {
      const { markers, byClass } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 400, 200),
      ]);
      markers.update([closing(1, 5000), closing(2, 6000)], null, null);
      markers.layout(camera());
      const writes = () => [
        byClass(THREAT_CLASSES.verbStack).map((stack) => stack.writes['--pp-verb-offset']),
        byClass(THREAT_CLASSES.root).map((root) => root.writes.zIndex),
      ];
      const after = writes();
      for (let frame = 0; frame < 5; frame++) {
        markers.update([closing(1, 5000), closing(2, 6000)], null, null);
        markers.layout(camera());
      }
      expect(writes()).toEqual(after);
    });

    it('follows the icon on screen: verbs of icons far apart never overlap, near ones do', () => {
      const { markers } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        // Half a box away horizontally, at the same height: overlaps.
        entryAt(2, 'RETIRE !', 400 + BOX_W / 2, 200),
        // A full box and more away: clear.
        entryAt(3, 'RETIRE !', 400 + BOX_W * 2, 200),
      ]);
      markers.update([closing(1, 5000), closing(2, 6000), closing(3, 7000)], null, null);
      markers.layout(camera());
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([
        0,
        BOX_H + VERB_STACK_GAP_PX,
        0,
      ]);
    });

    it('never pushes a marker that has no verb, nor a verb because of one', () => {
      const { markers } = setup([entryAt(1, '', 400, 200), entryAt(2, 'RETIRE !', 400, 200)]);
      markers.update([closing(1, 5000), closing(2, 6000)], null, null);
      markers.layout(camera());
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([0, 0]);
    });

    it('lays the micro-sleep out from where Papa is drawn, as its icon', () => {
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
      const markers = createThreatMarkers(new Scene(), doc, fakeMetrics().metrics);
      const sleeping = { ...entryAt(9, 'RETIRE !', 400, 200), followsPapa: true };
      const fixed = entryAt(2, 'RETIRE !', 400, 200);
      markers.mount([sleeping, fixed]);
      markers.setSize(LAYER.widthPx, LAYER.heightPx);
      const micro = { ...closing(9, 6000), defId: 'papa_microsleep' } as Readonly<ThreatInstance>;
      // Papa is far from the other threat: no overlap.
      markers.update([micro, closing(2, 7000)], null, null, { xM: 3, zM: 0 });
      markers.layout(camera());
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([0, 0]);
      // He walks under it: the verbs overlap and the less urgent one (the fixed one) is pushed.
      markers.update([micro, closing(2, 7000)], null, null, { xM: 0, zM: 0 });
      markers.layout(camera());
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([
        0,
        BOX_H + VERB_STACK_GAP_PX,
      ]);
    });

    it('gives the same layout frame after frame (it reuses its arrays: nothing to grow)', () => {
      const { markers } = setup([
        entryAt(1, 'RETIRE !', 400, 200),
        entryAt(2, 'RETIRE !', 400, 200),
      ]);
      const threats = [closing(1, 5000), closing(2, 6000)];
      markers.update(threats, null, null);
      const cam = camera();
      for (let frame = 0; frame < 100; frame++) markers.layout(cam);
      expect(markers.entries.map((entry) => entry.verbOffsetPx)).toEqual([
        0,
        BOX_H + VERB_STACK_GAP_PX,
      ]);
    });
  });
});
