import { beatTimelineOf } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { createBeatRing } from './beatRing.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  classes = new Set<string>();
  styleWrites: [string, string][] = [];
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => this.styleWrites.push([name, value]),
  };
  classList = {
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
}

const APPROACH_MS = 500;
const STEP_START = 4000;
const TIMELINE = beatTimelineOf({
  durationMs: 10_000,
  bpmStart: 90,
  bpmEnd: 60,
  leadInMs: 1000,
  countInBeats: 2,
  windowMs: 180,
  decoyBeats: [1],
});
const PAPA = { xM: 2, zM: -1 };
const at = (index: number) => STEP_START + (TIMELINE[index]?.offsetMs ?? 0);

function build(isMotionReduced = false) {
  const created: FakeElement[] = [];
  const doc = {
    createElement: () => {
      const element = new FakeElement();
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement'>;
  const scene = new Scene();
  const ring = createBeatRing(scene, doc, { isMotionReduced: () => isMotionReduced });
  const element = created[0] as FakeElement;
  const update = (clockMs: number, papa: typeof PAPA | null = PAPA, timeline = TIMELINE) =>
    ring.update(timeline, STEP_START, clockMs, APPROACH_MS, papa);
  return { ring, element, scene, update };
}

describe('createBeatRing', () => {
  it('is one hidden, aria-hidden element anchored at Papa’s middle, with a disc inside', () => {
    const { ring, element, scene } = build();
    expect(element.className).toBe('pp-beat-ring');
    expect(element.attributes.get('aria-hidden')).toBe('true');
    expect((element.style as { display: string }).display).toBe('none');
    expect(element.children).toHaveLength(1);
    expect(element.children[0]?.className).toBe('pp-beat-ring-disc');
    expect(ring.isVisible).toBe(false);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.position.y).toBeCloseTo(PAPA_HEIGHT_M / 2, 9);
  });

  it('closes over approachMs before a beat: hidden before, 0 when it appears, 1 on the beat', () => {
    const { ring, update, scene } = build();
    update(at(0) - APPROACH_MS - 1);
    expect(ring.isVisible).toBe(false);
    update(at(0) - APPROACH_MS);
    expect(ring.isVisible).toBe(true);
    expect(ring.entryIndex).toBe(0);
    expect(ring.progress).toBe(0);
    update(at(0) - APPROACH_MS / 2);
    expect(ring.progress).toBeCloseTo(0.5, 9);
    update(at(0));
    expect(ring.progress).toBe(1);
    // It follows Papa’s drawn pose.
    expect(scene.children[0]?.position.x).toBe(PAPA.xM);
    expect(scene.children[0]?.position.z).toBe(PAPA.zM);
  });

  it('moves on to the next note once the beat has passed', () => {
    const { ring, update } = build();
    update(at(0));
    expect(ring.entryIndex).toBe(0);
    update(at(0) + 1);
    // The next one is 667 ms later: its ring is not up yet.
    expect(ring.isVisible).toBe(false);
    update(at(1) - 100);
    expect(ring.entryIndex).toBe(1);
    expect(ring.progress).toBeCloseTo(0.8, 9);
  });

  it('draws a decoy dashed, with a class of its own, and a count-in beat as such', () => {
    const { element, update } = build();
    update(at(0) - 100);
    expect(element.classes.has('pp-beat-ring--count-in')).toBe(true);
    expect(element.classes.has('pp-beat-ring--decoy')).toBe(false);
    const decoyIndex = TIMELINE.findIndex((entry) => entry.kind === 'decoy');
    update(at(decoyIndex) - 100);
    expect(element.classes.has('pp-beat-ring--decoy')).toBe(true);
    expect(element.classes.has('pp-beat-ring--count-in')).toBe(false);
    const beatIndex = TIMELINE.findIndex((entry) => entry.kind === 'beat');
    update(at(beatIndex) - 100);
    expect(element.classes.has('pp-beat-ring--decoy')).toBe(false);
    expect(element.classes.has('pp-beat-ring--count-in')).toBe(false);
  });

  it('starts a decoy’s ring no earlier than the note before it: no jump from the beat that just closed', () => {
    const { ring, update } = build();
    const decoyIndex = TIMELINE.findIndex((entry) => entry.kind === 'decoy');
    const gapMs = at(decoyIndex) - at(decoyIndex - 1);
    // The decoy sits half a beat after its beat, closer than approachMs: the whole point.
    expect(gapMs).toBeLessThan(APPROACH_MS);
    update(at(decoyIndex - 1) + 1);
    expect(ring.entryIndex).toBe(decoyIndex);
    expect(ring.progress).toBeLessThan(0.01);
    update(at(decoyIndex - 1) + gapMs / 2);
    expect(ring.progress).toBeCloseTo(0.5, 1);
    update(at(decoyIndex));
    expect(ring.progress).toBe(1);
  });

  it('keeps the full approach for a beat that is farther from the note before it than approachMs', () => {
    const { ring, update } = build();
    const beatIndex = TIMELINE.findIndex((entry) => entry.kind === 'beat');
    expect(at(beatIndex) - at(beatIndex - 1)).toBeGreaterThan(APPROACH_MS);
    update(at(beatIndex) - APPROACH_MS);
    expect(ring.progress).toBe(0);
    update(at(beatIndex) - APPROACH_MS / 2);
    expect(ring.progress).toBeCloseTo(0.5, 9);
  });

  it('clears the progress property when it hides, so that a ring coming back at 0 does not keep the last one', () => {
    const { ring, update, element } = build();
    update(at(2) - 10);
    expect(element.styleWrites.at(-1)?.[0]).toBe('--pp-beat-progress');
    expect(element.styleWrites.at(-1)?.[1]).not.toBe('0');
    ring.hide();
    expect(element.styleWrites.at(-1)).toEqual(['--pp-beat-progress', '0']);
  });

  it('is driven by the clock alone: a clock that stands (a pause) holds the ring still', () => {
    const { ring, update, element } = build();
    update(at(2) - 200);
    const writes = element.styleWrites.length;
    for (let i = 0; i < 20; i++) update(at(2) - 200);
    expect(ring.progress).toBeCloseTo(0.6, 9);
    // Nothing is rewritten while nothing moves.
    expect(element.styleWrites).toHaveLength(writes);
  });

  it('writes the progress as a custom property, the class only when it changes', () => {
    const { update, element } = build();
    update(at(2) - 250);
    expect(element.styleWrites.at(-1)).toEqual(['--pp-beat-progress', '0.5']);
    update(at(2) - 125);
    expect(element.styleWrites.at(-1)).toEqual(['--pp-beat-progress', '0.75']);
  });

  it('marks the reduced-motion ring, which pops in opacity and drops its scale (CSS)', () => {
    const calm = build(false);
    calm.update(at(2) - 100);
    expect(calm.element.classes.has('pp-beat-ring--reduced')).toBe(false);
    const reduced = build(true);
    reduced.update(at(2) - 100);
    expect(reduced.element.classes.has('pp-beat-ring--reduced')).toBe(true);
  });

  it('hides with no timeline (the step is over), with no pose (a restart), and past the last note', () => {
    const { ring, update } = build();
    update(at(2) - 100);
    expect(ring.isVisible).toBe(true);
    update(at(2) - 100, null);
    expect(ring.isVisible).toBe(false);
    update(at(2) - 100);
    expect(ring.isVisible).toBe(true);
    ring.update(null, STEP_START, at(2) - 100, APPROACH_MS, PAPA);
    expect(ring.isVisible).toBe(false);
    update(STEP_START + 60_000);
    expect(ring.isVisible).toBe(false);
  });

  it('starts afresh on a new step, and walks back if the clock did', () => {
    const { ring, update } = build();
    update(at(3) - 100);
    expect(ring.entryIndex).toBe(3);
    update(at(1) - 100);
    expect(ring.entryIndex).toBe(1);
    ring.update(TIMELINE, STEP_START + 20_000, STEP_START + 20_000 + 900, APPROACH_MS, PAPA);
    expect(ring.entryIndex).toBe(0);
  });

  it('dispose removes it from the scene and hides it', () => {
    const { ring, update, scene } = build();
    update(at(2) - 100);
    ring.dispose();
    expect(scene.children).toHaveLength(0);
    expect(ring.isVisible).toBe(false);
  });
});
