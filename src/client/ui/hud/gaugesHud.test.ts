import { GAUGE_CHANGE_HOLD_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createGaugesHud } from './gaugesHud.ts';

/** The few things of the DOM that the gauges touch. */
class FakeNode {
  className = '';
  hidden = false;
  textContent = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeNode[] = [];
  classWrites = 0;
  styleWrites = 0;
  /** The class name seen by each read of `offsetWidth`, i.e. by each style flush. */
  flushedClasses: string[] = [];
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
    // Counts the writes: the contract is « only on a change ».
    let name = '';
    Object.defineProperty(this, 'className', {
      get: () => name,
      set: (value: string) => {
        name = value;
        this.classWrites++;
      },
    });
    let transform = '';
    this.style = new Proxy({} as Record<string, string>, {
      get: (_target, key) => (key === 'transform' ? transform : undefined),
      set: (_target, key, value: string) => {
        if (key === 'transform') {
          transform = value;
          this.styleWrites++;
        }
        return true;
      },
    });
  }
  get offsetWidth(): number {
    this.flushedClasses.push(this.className);
    return 0;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeNode[]): void {
    this.children = nodes;
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

const STRINGS: Record<string, string> = {
  'hud.gauges': 'Jauges',
  'gauge.noise': 'Bruit',
  'gauge.fatigue': 'Fatigue',
  'gauge.urge': 'Envie',
};

function build() {
  const doc = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  } as unknown as Pick<Document, 'createElement' | 'createElementNS'>;
  const clock = { now: 1000 };
  const hud = createGaugesHud(doc, {
    t: (key) => STRINGS[key] ?? key,
    nowAtReal: () => clock.now,
  });
  const root = hud.element as unknown as FakeNode;
  const gaugeOf = (index: number) => root.children[index] as FakeNode;
  const fillOf = (index: number) =>
    (gaugeOf(index).children[1] as FakeNode).children[0] as FakeNode;
  return { hud, root, clock, gaugeOf, fillOf };
}

describe('createGaugesHud', () => {
  it('is a group named « Jauges », hidden while the level has no gauge', () => {
    const { hud, root } = build();
    expect(root.className).toBe('pp-hud-gauges');
    expect(root.attributes.get('role')).toBe('group');
    expect(root.attributes.get('aria-label')).toBe('Jauges');
    expect(root.hidden).toBe(true);
    hud.setGauges([]);
    expect(root.hidden).toBe(true);
    expect(root.children).toEqual([]);
  });

  it('shows one gauge per id the level has, in the order Bruit · Fatigue · Envie whatever the order given', () => {
    const { hud, root, gaugeOf } = build();
    hud.setGauges(['need', 'fatigue', 'noise']);
    expect(root.hidden).toBe(false);
    expect(root.children.map((gauge) => gauge.attributes.get('aria-label'))).toEqual([
      'Bruit 0 %',
      'Fatigue 0 %',
      'Envie 0 %',
    ]);
    hud.setGauges(['fatigue']);
    expect(root.children).toHaveLength(1);
    expect(gaugeOf(0).attributes.get('aria-label')).toBe('Fatigue 0 %');
  });

  it('builds icon + bar + one fill per gauge, a handful of nodes', () => {
    const { hud, root } = build();
    hud.setGauges(['fatigue']);
    const gauge = root.children[0] as FakeNode;
    expect(gauge.children.map((child) => child.tag)).toEqual(['svg', 'div']);
    expect((gauge.children[1] as FakeNode).className).toBe('pp-hud-gauge-bar');
    expect(((gauge.children[1] as FakeNode).children[0] as FakeNode).className).toBe(
      'pp-hud-gauge-fill',
    );
    expect(root.all().length).toBeLessThanOrEqual(10);
  });

  it('scales the fill with the value and says it in the aria-label', () => {
    const { hud, gaugeOf, fillOf } = build();
    hud.setGauges(['fatigue']);
    hud.setValue('fatigue', 80);
    expect(fillOf(0).style.transform).toBe('scaleX(0.8)');
    expect(gaugeOf(0).attributes.get('aria-label')).toBe('Fatigue 80 %');
    hud.setValue('fatigue', 250);
    expect(fillOf(0).style.transform).toBe('scaleX(1)');
    hud.setValue('fatigue', -3);
    expect(fillOf(0).style.transform).toBe('scaleX(0)');
  });

  it('ignores a gauge the level lacks', () => {
    const { hud, gaugeOf } = build();
    hud.setGauges(['fatigue']);
    hud.setValue('noise', 90);
    expect(gaugeOf(0).attributes.get('aria-label')).toBe('Fatigue 0 %');
  });

  describe('the idle, warn and changing classes (D11)', () => {
    const IDLE = 'pp-hud-gauge pp-hud-gauge-idle';
    const FULL = 'pp-hud-gauge';
    const WARN = 'pp-hud-gauge pp-hud-gauge-warn';

    it.each([
      [0, IDLE],
      [49, IDLE],
      [50, FULL],
      [69, FULL],
      [70, WARN],
      [100, WARN],
    ])('at %i %% (first value, no change) its class is « %s »', (percent, expected) => {
      const { hud, gaugeOf } = build();
      hud.setGauges(['fatigue']);
      hud.setValue('fatigue', percent);
      expect(gaugeOf(0).className).toBe(expected);
    });

    it('is full for GAUGE_CHANGE_HOLD_MS after a segment boundary is crossed, then idle again', () => {
      const { hud, gaugeOf, clock } = build();
      hud.setGauges(['fatigue']);
      hud.setValue('fatigue', 0);
      hud.setValue('fatigue', 4);
      expect(gaugeOf(0).className).toBe(IDLE); // same segment, 4 points
      clock.now = 2000;
      hud.setValue('fatigue', 10); // crosses 10
      expect(gaugeOf(0).className).toBe(FULL);
      hud.frame(2000 + GAUGE_CHANGE_HOLD_MS - 1);
      expect(gaugeOf(0).className).toBe(FULL);
      hud.frame(2000 + GAUGE_CHANGE_HOLD_MS);
      expect(gaugeOf(0).className).toBe(IDLE);
    });

    it('counts a jump of 5 points or more as a change, inside one segment', () => {
      const { hud, gaugeOf } = build();
      hud.setGauges(['fatigue']);
      hud.setValue('fatigue', 10);
      hud.setValue('fatigue', 14); // 4 points, same segment
      expect(gaugeOf(0).className).toBe(IDLE);
      hud.setValue('fatigue', 19); // 5 points, same segment
      expect(gaugeOf(0).className).toBe(FULL);
    });

    it('keeps the warn class from 70 % while the changing hold comes and goes', () => {
      const { hud, gaugeOf, clock } = build();
      hud.setGauges(['fatigue']);
      hud.setValue('fatigue', 69);
      hud.setValue('fatigue', 70);
      expect(gaugeOf(0).className).toBe(WARN);
      clock.now += GAUGE_CHANGE_HOLD_MS;
      hud.frame(clock.now);
      expect(gaugeOf(0).className).toBe(WARN);
      // A coffee: a drop of 40 points is a change (full), then it settles at idle under 50 %.
      hud.setValue('fatigue', 30);
      expect(gaugeOf(0).className).toBe(FULL);
      clock.now += GAUGE_CHANGE_HOLD_MS;
      hud.frame(clock.now);
      expect(gaugeOf(0).className).toBe(IDLE);
    });

    it('does not count the first value after setGauges as a change', () => {
      const { hud, gaugeOf } = build();
      hud.setGauges(['fatigue']);
      hud.setValue('fatigue', 30);
      expect(gaugeOf(0).className).toBe(IDLE);
    });
  });

  it('writes the class and the style only when something changed, and nothing on a quiet frame', () => {
    const { hud, gaugeOf, fillOf, clock } = build();
    hud.setGauges(['fatigue']);
    hud.setValue('fatigue', 0);
    const classWrites = gaugeOf(0).classWrites;
    const styleWrites = fillOf(0).styleWrites;
    hud.setValue('fatigue', 0); // the same value: nothing
    hud.setValue('fatigue', 1); // same idle state: a style write, no class write
    expect(gaugeOf(0).classWrites).toBe(classWrites);
    expect(fillOf(0).styleWrites).toBe(styleWrites + 1);
    for (let i = 0; i < 100; i++) hud.frame(clock.now + i);
    expect(gaugeOf(0).classWrites).toBe(classWrites);
    expect(fillOf(0).styleWrites).toBe(styleWrites + 1);
  });

  it('goes back to 0 % and idle when a new level sets the gauges again', () => {
    const { hud, gaugeOf } = build();
    hud.setGauges(['fatigue']);
    hud.setValue('fatigue', 85);
    hud.setGauges(['fatigue']);
    expect(gaugeOf(0).attributes.get('aria-label')).toBe('Fatigue 0 %');
    expect(gaugeOf(0).className).toBe('pp-hud-gauge pp-hud-gauge-idle');
  });
  describe('the 80 % alert (story 3.1)', () => {
    const ALERT = 'pp-hud-gauge-alert';

    it('puts the alert class on the gauge, keeping its warn state, and takes it off after 600 ms', () => {
      const { hud, gaugeOf, clock } = build();
      hud.setGauges(['noise', 'fatigue']);
      hud.setValue('noise', 85);
      hud.alert('noise');
      expect(gaugeOf(0).className).toBe(`pp-hud-gauge pp-hud-gauge-warn ${ALERT}`);
      expect(gaugeOf(1).className).not.toContain(ALERT);
      hud.frame(clock.now + 599);
      expect(gaugeOf(0).className).toContain(ALERT);
      hud.frame(clock.now + 600);
      expect(gaugeOf(0).className).toBe('pp-hud-gauge pp-hud-gauge-warn');
    });

    it('restarts a running alert: off now, on again at the next frame, for another 600 ms', () => {
      const { hud, gaugeOf, clock } = build();
      hud.setGauges(['noise']);
      hud.setValue('noise', 85);
      hud.alert('noise');
      clock.now += 300;
      hud.alert('noise');
      expect(gaugeOf(0).className).not.toContain(ALERT);
      expect(gaugeOf(0).flushedClasses).toEqual([]);
      hud.frame(clock.now);
      // A style flush with the class off sits between « off » and « on », so the shake replays.
      expect(gaugeOf(0).flushedClasses).toHaveLength(1);
      expect(gaugeOf(0).flushedClasses[0]).not.toContain(ALERT);
      expect(gaugeOf(0).className).toContain(ALERT);
      hud.frame(clock.now + 599);
      expect(gaugeOf(0).className).toContain(ALERT);
      hud.frame(clock.now + 600);
      expect(gaugeOf(0).className).not.toContain(ALERT);
    });

    it('survives a change of the idle or warn state while it plays', () => {
      const { hud, gaugeOf } = build();
      hud.setGauges(['noise']);
      hud.setValue('noise', 85);
      hud.alert('noise');
      hud.setValue('noise', 60);
      expect(gaugeOf(0).className).toBe(`pp-hud-gauge ${ALERT}`);
    });

    it('ignores a gauge the level lacks, and a new level starts without one', () => {
      const { hud, gaugeOf } = build();
      hud.setGauges(['fatigue']);
      hud.alert('noise');
      expect(gaugeOf(0).className).not.toContain(ALERT);
      hud.setGauges(['noise']);
      hud.alert('noise');
      hud.setGauges(['noise']);
      expect(gaugeOf(0).className).toBe('pp-hud-gauge pp-hud-gauge-idle');
    });

    it('writes no class on a quiet frame', () => {
      const { hud, gaugeOf, clock } = build();
      hud.setGauges(['noise']);
      hud.setValue('noise', 85);
      hud.alert('noise');
      hud.frame(clock.now + 700);
      const writes = gaugeOf(0).classWrites;
      for (let i = 0; i < 100; i++) hud.frame(clock.now + 800 + i);
      expect(gaugeOf(0).classWrites).toBe(writes);
    });
  });
});
