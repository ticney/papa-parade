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
import type { VerbMetrics } from './verbMetrics.ts';

// The marker of a Firmness judged on its release (story 4.8): « TIENS… » and the sweat during the
// descent, « LÂCHE ! » and the open hand at the final pose, and never « POSE-LE D'ABORD ! » (this is the
// one Firmness meant to be held with the baby in the arms).

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
  // The release Firmness has a chrono-ring (story 2.11), whose size is read from the metrics.
  const metrics: VerbMetrics = {
    surfaceKey: () => 'regular',
    basePx: () => 40,
    lineHeight: () => 1,
    scale: () => 1,
    threatSizePx: () => 64,
    widthPx: (text, fontPx) => text.length * fontPx * 0.5,
  };
  const markers = createThreatMarkers(new Scene(), doc, metrics);
  const byClass = (name: string): FakeElement[] =>
    created.filter((element) => element.className === name);
  return { markers, created, byClass };
}

const t = (key: string): string => `<${key}>`;

const threat = (id: number, state: ThreatState): Readonly<ThreatInstance> =>
  ({
    id,
    defId: 'bomb_drop_lay',
    anchorId: 'papa',
    xM: 0,
    zM: 0,
    state,
    enteredAt: asSimMs(0),
    windowOpenAt: asSimMs(2600),
    responseWindow: null,
  }) as Readonly<ThreatInstance>;

const releaseDef = {
  icon: 'sweat',
  target: 'papa',
  verbKey: 'verb.hold_on',
  signalVerbKey: 'verb.let_go',
  signalIcon: 'open_hand',
  iconShape: 'circle',
  color: 'parry',
  response: 'firm',
  release: { pressWithinMs: 700 },
} as const;

const plainFirmDef = {
  icon: 'bolt',
  target: 'anchor',
  verbKey: 'verb.firm',
  iconShape: 'circle',
  color: 'parry',
  response: 'firm',
} as const;

const entries = () =>
  threatMarkerEntries([threat(4, 'idle')], [], { bomb_drop_lay: releaseDef }, 0.2, t);

describe('the entry of a Firmness judged on its release (story 4.8)', () => {
  it('has no carried verb: « POSE-LE D’ABORD ! » must not replace « TIENS… »', () => {
    const [entry] = entries();
    expect(entry?.carriedVerb).toBeUndefined();
    expect(entry).toMatchObject({
      icon: 'sweat',
      verb: '<verb.hold_on>',
      signalVerb: '<verb.let_go>',
      signalIcon: 'open_hand',
    });
  });

  it('still gives a plain Firmness its carried verb', () => {
    const [entry] = threatMarkerEntries(
      [threat(4, 'idle')],
      [{ id: 'papa', positionM: [0, 0, 0] }],
      { bomb_drop_lay: plainFirmDef },
      0.2,
      t,
    );
    expect(entry?.carriedVerb).toBe('<verb.put_down_first>');
    expect(entry?.signalVerb).toBeUndefined();
  });

  it('has a glyph for the sweat and the open hand, unlike each other and the older ones', () => {
    expect(THREAT_ICON_PATHS.sweat).not.toBe('');
    expect(THREAT_ICON_PATHS.open_hand).not.toBe('');
    const paths = Object.values(THREAT_ICON_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('the marker of a Firmness judged on its release (story 4.8)', () => {
  it('shows « TIENS… » and the sweat, then « LÂCHE ! » and the open hand at the final pose', () => {
    const { markers, byClass, created } = build();
    markers.mount(entries());
    const [verb] = byClass(THREAT_CLASSES.verb);
    const [root] = byClass(THREAT_CLASSES.root);
    const path = created.find((element) => element.attributes.get('d') === THREAT_ICON_PATHS.sweat);
    expect(path).toBeDefined();

    markers.update([threat(4, 'telegraph')], null, null);
    expect(verb?.textContent).toBe('<verb.hold_on>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.sweat);
    expect(root?.classes.has(THREAT_CLASSES.signal)).toBe(false);

    markers.update([threat(4, 'windowOpen')], null, null);
    expect(verb?.textContent).toBe('<verb.let_go>');
    expect(path?.attributes.get('d')).toBe(THREAT_ICON_PATHS.open_hand);
    expect(root?.classes.has(THREAT_CLASSES.signal)).toBe(true);
  });

  it('keeps « TIENS… » while the baby is carried, which is what this Firmness is for', () => {
    const { markers, byClass } = build();
    markers.mount(entries());
    const [verb] = byClass(THREAT_CLASSES.verb);
    markers.update([threat(4, 'telegraph')], null, null, null, null, undefined, true);
    expect(verb?.textContent).toBe('<verb.hold_on>');
    markers.update([threat(4, 'telegraph')], null, null, null, null, undefined, true);
    markers.update([threat(4, 'windowOpen')], null, null, null, null, undefined, true);
    expect(verb?.textContent).toBe('<verb.let_go>');
  });
});
