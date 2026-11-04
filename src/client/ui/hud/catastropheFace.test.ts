import { GAUGE_CHANGE_HOLD_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  CATASTROPHE_FACE_STATES,
  type CatastropheFaceState,
  catastropheFaceStateOf,
  createCatastropheFace,
} from './catastropheFace.ts';

/** The few things of the DOM that the face touches, with a count of the writes: the contract is « only on a change ». */
class FakeNode {
  className = '';
  attributes = new Map<string, string>();
  attributeWrites = 0;
  children: FakeNode[] = [];
  classWrites = 0;
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, force: boolean): void => {
      this.classWrites += 1;
      if (force) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
    this.classes.add('pp-hud-catastrophe--idle');
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.attributeWrites += 1;
    if (name === 'class') {
      this.className = value;
      this.classes.clear();
      for (const each of value.split(' ')) this.classes.add(each);
    }
  }
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }
  all(): FakeNode[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

const STRINGS: Record<string, string> = {
  'hud.catastrophe_serene': 'Maman sereine',
  'hud.catastrophe_frowning': 'Maman fronce les sourcils',
  'hud.catastrophe_worried': "Maman s'inquiète",
  'hud.catastrophe_alarmed': 'Maman va rentrer !',
};

const THRESHOLDS = { faceStepsPct: [25, 50], alertPct: 70 };

function build(thresholds = THRESHOLDS) {
  const doc = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  } as unknown as Pick<Document, 'createElement' | 'createElementNS'>;
  const clock = { now: 1000 };
  const face = createCatastropheFace(doc, {
    t: (key) => STRINGS[key] ?? key,
    thresholds: () => thresholds,
    nowAtReal: () => clock.now,
  });
  const root = face.element as unknown as FakeNode;
  const path = root.all().find((node) => node.tag === 'path') as FakeNode;
  return { face, root, path, clock };
}

describe('catastropheFaceStateOf', () => {
  it.each<[number, CatastropheFaceState]>([
    [0, 'serene'],
    [24.99, 'serene'],
    [25, 'frowning'],
    [49.99, 'frowning'],
    [50, 'worried'],
    [69.99, 'worried'],
    // Strictly above the alert threshold, like the noise's « above 80 % ».
    [70, 'worried'],
    [70.01, 'alarmed'],
    [100, 'alarmed'],
  ])('shows %s %% as %s', (percent, expected) => {
    expect(catastropheFaceStateOf(percent, THRESHOLDS)).toBe(expected);
  });

  it('reads the steps it is given, not literals', () => {
    const tuned = { faceStepsPct: [10, 20], alertPct: 30 };
    expect(catastropheFaceStateOf(15, tuned)).toBe('frowning');
    expect(catastropheFaceStateOf(20, tuned)).toBe('worried');
    expect(catastropheFaceStateOf(30.5, tuned)).toBe('alarmed');
  });
});

describe('createCatastropheFace', () => {
  it('is a round image with a spoken name, never a number, in three nodes of the HUD budget', () => {
    const { root, face } = build();
    expect(root.attributes.get('role')).toBe('img');
    expect(root.attributes.get('aria-label')).toBe('Maman sereine');
    expect(face.state).toBe('serene');
    expect(root.all()).toHaveLength(3);
    expect(root.all().some((node) => /\d/.test(node.attributes.get('aria-label') ?? ''))).toBe(
      false,
    );
  });

  it('draws a different face for each of the four states, and names each in words', () => {
    const { face, root, path } = build();
    const drawings = new Set<string>();
    const names = new Set<string>();
    for (const [percent, state] of [
      [0, 'serene'],
      [30, 'frowning'],
      [55, 'worried'],
      [80, 'alarmed'],
    ] as const) {
      face.setPercent(percent);
      expect(face.state).toBe(state);
      drawings.add(path.attributes.get('d') ?? '');
      names.add(root.attributes.get('aria-label') ?? '');
    }
    expect(drawings.size).toBe(CATASTROPHE_FACE_STATES.length);
    expect(names.size).toBe(CATASTROPHE_FACE_STATES.length);
    expect([...names].every((name) => name !== '' && !name.startsWith('hud.'))).toBe(true);
  });

  it('wears the alert ring only while alarmed, and takes it off when the gauge falls back', () => {
    const { face, root } = build();
    face.setPercent(70);
    expect(root.classes.has('pp-hud-catastrophe--alarmed')).toBe(false);
    face.setPercent(70.4);
    expect(root.classes.has('pp-hud-catastrophe--alarmed')).toBe(true);
    face.setPercent(60);
    expect(root.classes.has('pp-hud-catastrophe--alarmed')).toBe(false);
  });

  it('writes the DOM only on a change of state: a frame with the same face writes nothing', () => {
    const { face, root, path } = build();
    face.setPercent(30);
    const classWrites = root.classWrites;
    const attributeWrites = root.attributeWrites + path.attributeWrites;
    for (let i = 0; i < 100; i++) face.setPercent(30 + (i % 3) * 0.1);
    expect(root.classWrites).toBe(classWrites);
    expect(root.attributeWrites + path.attributeWrites).toBe(attributeWrites);
  });

  it('is dimmed below 50 % while idle, full from 50 %', () => {
    const { face, root } = build();
    face.setPercent(20);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(true);
    face.setPercent(50);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(false);
    face.setPercent(80);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(false);
  });

  it('goes to full opacity while changing, back to dimmed GAUGE_CHANGE_HOLD_MS after, below 50 %', () => {
    const { face, root, clock } = build();
    face.setPercent(0);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(true);
    // A near miss: +35 points at once.
    clock.now = 2000;
    face.setPercent(35);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(false);
    face.frame(2000 + GAUGE_CHANGE_HOLD_MS - 1);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(false);
    face.frame(2000 + GAUGE_CHANGE_HOLD_MS);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(true);
  });

  it('counts the crossing of a 10-point boundary as a change, even by one point', () => {
    const { face, root, clock } = build();
    face.setPercent(19);
    clock.now = 3000;
    face.setPercent(20);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(false);
  });

  it('does not count the slow decay inside a segment as a change', () => {
    const { face, root, clock } = build();
    face.setPercent(33);
    clock.now = 4000;
    face.frame(4000 + GAUGE_CHANGE_HOLD_MS);
    face.setPercent(32);
    expect(root.classes.has('pp-hud-catastrophe--idle')).toBe(true);
  });

  it('switches to the compact chip and back, writing only on a change', () => {
    const { face, root } = build();
    face.setCompact(true);
    expect(root.classes.has('pp-hud-catastrophe--compact')).toBe(true);
    const writes = root.classWrites;
    face.setCompact(true);
    expect(root.classWrites).toBe(writes);
    face.setCompact(false);
    expect(root.classes.has('pp-hud-catastrophe--compact')).toBe(false);
  });

  it('follows thresholds that change while the game runs', () => {
    const live = { faceStepsPct: [25, 50], alertPct: 70 };
    const { face } = build(live);
    face.setPercent(40);
    expect(face.state).toBe('frowning');
    live.faceStepsPct = [45, 60];
    face.setPercent(40.5);
    expect(face.state).toBe('serene');
  });
});
