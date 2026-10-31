import type { SequenceDef } from '@content/schemas/sequence';
import { describe, expect, it } from 'vitest';
import {
  createTestLullabyWalk,
  createTestStayAwake,
} from '../../../../tests/support/testContent.ts';
import { createSequenceBar, type SequenceBarWorld } from './sequenceBar.ts';

/** The few things of the DOM that the bar touches, counting its writes. */
class FakeNode {
  className = '';
  textContent = '';
  writes = 0;
  readonly attributes = new Map<string, string>();
  readonly styleProperties = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string): void => {
      this.writes += 1;
      this.styleProperties.set(name, value);
    },
  };
  readonly classes = new Set<string>();
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  readonly classList = {
    toggle: (name: string, force: boolean): void => {
      this.writes += 1;
      if (force) this.classes.add(name);
      else this.classes.delete(name);
    },
    add: (...names: string[]): void => {
      this.writes += 1;
      for (const name of names) this.classes.add(name);
    },
    remove: (...names: string[]): void => {
      this.writes += 1;
      for (const name of names) this.classes.delete(name);
    },
  };
  constructor() {
    Object.defineProperty(this, 'className', {
      get: () => '',
      set: (value: string) => {
        for (const name of value.split(' ')) this.classes.add(name);
      },
    });
  }
  setAttribute(name: string, value: string): void {
    this.writes += 1;
    this.attributes.set(name, value);
  }
  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove(): void {
    const siblings = this.parent?.children;
    if (siblings === undefined) return;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
}

const SLIDE_MS = 250;

function build(def: SequenceDef = createTestStayAwake()) {
  const doc = { createElement: () => new FakeNode() } as unknown as Pick<Document, 'createElement'>;
  const bar = createSequenceBar(doc, {
    t: (key) => (key === 'hud.sequence_stay_awake' ? 'Sommeil' : key),
    slideMs: SLIDE_MS,
  });
  const parent = new FakeNode();
  bar.attachTo(parent as unknown as HTMLElement);
  const node = bar.element as unknown as FakeNode;
  return { bar, parent, node, def };
}

const worldAt = (
  nowMs: number,
  id: string | null = 'stay_awake',
  wakePct = 0,
): SequenceBarWorld => ({
  sequence: { id, startedAt: 1000, endsAt: 16_000, beat: { wakePct } },
  time: { sim: nowMs },
});

describe('createSequenceBar › calmLeft (story 4.5)', () => {
  const lullaby: SequenceDef = createTestLullabyWalk();

  it('shows 100 minus the baby’s wake, in whole percent, whatever the time left', () => {
    const { bar, node } = build(lullaby);
    expect(bar.update(worldAt(1000, 'lullaby_walk', 0), lullaby)).toBe(100);
    expect(bar.update(worldAt(8000, 'lullaby_walk', 25), lullaby)).toBe(75);
    expect(bar.update(worldAt(15_000, 'lullaby_walk', 62.4), lullaby)).toBe(38);
    expect(bar.update(worldAt(15_000, 'lullaby_walk', 100), lullaby)).toBe(0);
    expect(bar.update(worldAt(15_000, 'lullaby_walk', 130), lullaby)).toBe(0);
    // A player resource: the calm fill.
    expect(node.classes.has('pp-hud-sequence-bar--calm')).toBe(true);
  });

  it('slides out empty after the baby woke: the last stir and the end fall in one step', () => {
    const { bar, parent, node } = build(lullaby);
    bar.attachTo(parent as unknown as HTMLElement);
    bar.setPercent(bar.update(worldAt(5000, 'lullaby_walk', 88), lullaby));
    bar.frame(0);
    bar.frame(16);
    expect(bar.isMounted).toBe(true);
    expect(node.attributes.get('aria-valuenow')).toBe('12');
    // `SequenceEnded{failed}` clears the slice (id null, wake 0) in the step that woke him; the bar
    // is told, and neither refills nor keeps the 12 % of the frame before: he is awake.
    bar.markFailed();
    const percent = bar.update(worldAt(5010, null, 0), lullaby);
    expect(percent).toBe(0);
    bar.setPercent(percent);
    bar.frame(100);
    expect(node.attributes.get('aria-valuenow')).toBe('0');
    bar.frame(100 + SLIDE_MS);
    expect(bar.isMounted).toBe(false);
  });

  it('keeps its last value when the walk ended well: a won bar keeps what it showed', () => {
    const { bar } = build(lullaby);
    bar.setPercent(bar.update(worldAt(15_000, 'lullaby_walk', 38), lullaby));
    bar.frame(0);
    bar.frame(16);
    expect(bar.update(worldAt(15_010, null, 0), lullaby)).toBe(62);
  });

  it('forgets a failure when the next walk starts', () => {
    const { bar } = build(lullaby);
    bar.setPercent(bar.update(worldAt(5000, 'lullaby_walk', 88), lullaby));
    bar.frame(0);
    bar.frame(16);
    bar.markFailed();
    expect(bar.update(worldAt(5010, null, 0), lullaby)).toBe(0);
    expect(bar.update(worldAt(9000, 'lullaby_walk', 25), lullaby)).toBe(75);
    // And it ends well this time.
    bar.setPercent(75);
    expect(bar.update(worldAt(9010, null, 0), lullaby)).toBe(75);
  });

  it('keeps the time left of a time bar after a failure: only the baby’s calm is emptied', () => {
    const { bar, def } = build();
    bar.setPercent(bar.update(worldAt(8500), def));
    bar.frame(0);
    bar.frame(16);
    bar.markFailed();
    expect(bar.update(worldAt(8510, null), def)).toBe(50);
  });
});

describe('createSequenceBar', () => {
  it('is two nodes only (the HUD budget): the container and the track', () => {
    const { node } = build();
    const count = (root: FakeNode): number => 1 + root.children.reduce((n, c) => n + count(c), 0);
    expect(count(node)).toBe(2);
  });

  it('is not in the DOM until a sequence with a bar runs, then slides in on the next frame', () => {
    const { bar, parent, node, def } = build();
    expect(parent.children).toEqual([]);
    expect(bar.update(worldAt(1000), def)).toBe(100);
    bar.frame(0);
    expect(parent.children).toEqual([node]);
    expect(bar.isMounted).toBe(true);
    // Starts slid out; the next frame takes it off, so that it slides in.
    expect(node.classes.has('pp-hud-sequence-bar--out')).toBe(true);
    bar.update(worldAt(1010), def);
    bar.frame(16);
    expect(node.classes.has('pp-hud-sequence-bar--out')).toBe(false);
  });

  it('shows the time left in whole percent, clamped to 0-100, and the label and the role', () => {
    const { bar, node, def } = build();
    expect(bar.update(worldAt(1000), def)).toBe(100);
    expect(bar.update(worldAt(8500), def)).toBe(50);
    expect(bar.update(worldAt(16_000), def)).toBe(0);
    expect(bar.update(worldAt(17_000), def)).toBe(0);
    expect(bar.update(worldAt(500), def)).toBe(100);
    bar.setPercent(50);
    expect(node.attributes.get('aria-valuenow')).toBe('50');
    expect(node.attributes.get('role')).toBe('progressbar');
    expect(node.attributes.get('aria-label')).toBe('Sommeil');
    expect(node.attributes.get('data-label')).toBe('Sommeil');
    // The fill is the track's background, driven by one custom property of the container.
    expect(node.styleProperties.get('--pp-sequence-value')).toBe('0.5');
    // An opponent's health fills in gauge-warn.
    expect(node.classes.has('pp-hud-sequence-bar--warn')).toBe(true);
  });

  it('a player resource fills in gauge-calm', () => {
    const base = createTestStayAwake();
    const def: SequenceDef = {
      ...base,
      framing: {
        ...base.framing,
        bar: { labelKey: 'hud.sequence_stay_awake', fill: 'player', value: 'timeLeft' },
      },
    };
    const { bar, node } = build(def);
    bar.update(worldAt(2000), def);
    expect(node.classes.has('pp-hud-sequence-bar--calm')).toBe(true);
    expect(node.classes.has('pp-hud-sequence-bar--warn')).toBe(false);
  });

  it('stays mounted for slideMs of real time after the end, then is removed', () => {
    const { bar, parent, def } = build();
    bar.update(worldAt(1000), def);
    bar.frame(0);
    bar.frame(16);
    bar.update(worldAt(1000, null), def);
    bar.frame(1000);
    expect(parent.children).toHaveLength(1);
    bar.frame(1000 + SLIDE_MS - 1);
    expect(parent.children).toHaveLength(1);
    bar.frame(1000 + SLIDE_MS);
    expect(parent.children).toEqual([]);
    expect(bar.isMounted).toBe(false);
  });

  it('keeps its last fill while it slides out after a failure, and 0 once it is gone', () => {
    const { bar, def } = build();
    bar.setPercent(bar.update(worldAt(8500), def));
    bar.frame(0);
    bar.frame(16);
    // The sequence failed at 50 %: the world has no running sequence any more.
    expect(bar.update(worldAt(8500, null), def)).toBe(50);
    bar.frame(1000);
    expect(bar.update(worldAt(8510, null), def)).toBe(50);
    bar.frame(1000 + SLIDE_MS);
    expect(bar.isMounted).toBe(false);
    expect(bar.update(worldAt(8520, null), def)).toBe(0);
  });

  it('a sequence that starts during the slide-out re-shows the bar and does not remove it later', () => {
    const { bar, parent, node, def } = build();
    bar.update(worldAt(1000), def);
    bar.frame(0);
    bar.frame(16);
    bar.update(worldAt(1000, null), def);
    bar.frame(1000);
    expect(node.classes.has('pp-hud-sequence-bar--out')).toBe(true);
    bar.update(worldAt(1000), def);
    bar.frame(1100);
    expect(node.classes.has('pp-hud-sequence-bar--out')).toBe(false);
    bar.frame(1000 + 10 * SLIDE_MS);
    expect(parent.children).toEqual([node]);
  });

  it('a sequence with no bar touches nothing', () => {
    const base = createTestStayAwake();
    const def: SequenceDef = { ...base, framing: { ...base.framing, bar: null } };
    const { bar, parent, node } = build(def);
    const writes = node.writes;
    expect(bar.update(worldAt(2000), def)).toBe(0);
    bar.frame(0);
    expect(parent.children).toEqual([]);
    expect(node.writes).toBe(writes);
    expect(bar.isMounted).toBe(false);
  });

  it('writes nothing when nothing changed: the value, the classes and the label', () => {
    const { bar, node, def } = build();
    bar.update(worldAt(1000), def);
    bar.setPercent(100);
    bar.frame(0);
    bar.frame(16);
    const writes = node.writes;
    for (let i = 0; i < 30; i++) {
      bar.update(worldAt(1000), def);
      bar.setPercent(100);
      bar.frame(32 + i);
    }
    expect(node.writes).toBe(writes);
  });

  it('reset removes it at once', () => {
    const { bar, parent, def } = build();
    bar.update(worldAt(1000), def);
    bar.frame(0);
    expect(parent.children).toHaveLength(1);
    bar.reset();
    expect(parent.children).toEqual([]);
    expect(bar.isMounted).toBe(false);
    // And a level end (the sequence no longer runs) with nothing mounted does nothing.
    bar.update(worldAt(1000, null), def);
    bar.frame(500);
    expect(parent.children).toEqual([]);
  });

  it('is up exactly while a sequence runs, whatever events were missed (state, not events)', () => {
    const { bar, parent, def } = build();
    // A restart mid-sequence: the world is a fresh one with no sequence.
    bar.update(worldAt(1000), def);
    bar.frame(0);
    bar.reset();
    bar.update(worldAt(0, null), null);
    bar.frame(10_000);
    expect(parent.children).toEqual([]);
  });
});
