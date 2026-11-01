import type { World } from '@sim';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createTidyMarkers, TIDY_MARKER_HEIGHT_M } from './tidyMarkers.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  textContent = '';
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  /** How many times `style.display` was written: a frame must write it only when a marker appears or goes. */
  styleWrites = 0;
  displayValue = '';
  readonly style: { setProperty(): void; display: string };
  constructor() {
    const element = this;
    this.style = {
      setProperty: () => {},
      get display(): string {
        return element.displayValue;
      },
      set display(value: string) {
        element.styleWrites += 1;
        element.displayValue = value;
      },
    };
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
}

function build(propCount = 3) {
  const created: FakeElement[] = [];
  const make = () => {
    const element = new FakeElement();
    created.push(element);
    return element;
  };
  const doc = { createElement: make, createElementNS: make } as unknown as Pick<
    Document,
    'createElement' | 'createElementNS'
  >;
  const scene = new Scene();
  const markers = createTidyMarkers(scene, doc, (key) => `<${key}>`);
  markers.mount(propCount);
  return { markers, scene, created };
}

const prop = (xM: number, zM: number, isMess: boolean, yM = 0.05) => ({ xM, yM, zM, isMess });
const worldOf = (state: string, props: ReturnType<typeof prop>[]): World =>
  ({ flow: { state }, props }) as unknown as World;

describe('the tidy markers (story 3.5, AC 16)', () => {
  it('mounts one hidden marker per prop, aria-hidden, saying « RANGE ! » through the translator', () => {
    const { markers, scene, created } = build(2);
    expect(scene.children).toHaveLength(2);
    expect(markers.isAnyVisible).toBe(false);
    const roots = created.filter((element) => element.className === 'pp-tidy-marker');
    expect(roots).toHaveLength(2);
    expect(roots.every((root) => root.attributes.get('aria-hidden') === 'true')).toBe(true);
    const verbs = created.filter((element) => element.className.includes('pp-tidy-marker-verb'));
    expect(verbs.map((verb) => verb.textContent)).toEqual(['<verb.tidy>', '<verb.tidy>']);
    expect(scene.children.every((child) => !child.visible)).toBe(true);
  });

  it('shows a marker above each prop that is a mess while the flow is finalRush', () => {
    const { markers, scene } = build();
    markers.update(worldOf('finalRush', [prop(1, 2, true), prop(3, 4, false), prop(5, 6, true)]));
    expect(scene.children.map((child) => child.visible)).toEqual([true, false, true]);
    expect(markers.isAnyVisible).toBe(true);
    expect(scene.children[0]?.position.toArray()).toEqual([1, 0.05 + TIDY_MARKER_HEIGHT_M, 2]);
    expect(scene.children[2]?.position.toArray()).toEqual([5, 0.05 + TIDY_MARKER_HEIGHT_M, 6]);
  });

  it('hides the marker as soon as the prop is tidied, and follows a prop that still slides', () => {
    const { markers, scene } = build(1);
    markers.update(worldOf('finalRush', [prop(1, 2, true)]));
    markers.update(worldOf('finalRush', [prop(1.5, 2, true)]));
    expect(scene.children[0]?.position.x).toBe(1.5);
    markers.update(worldOf('finalRush', [prop(1.5, 2, false)]));
    expect(scene.children[0]?.visible).toBe(false);
    expect(markers.isAnyVisible).toBe(false);
  });

  it('shows nothing outside the rush: playing, sequence, photo and ended, whatever the mess', () => {
    const { markers, scene } = build(1);
    for (const state of ['playing', 'sequence', 'photo', 'ended']) {
      markers.update(worldOf(state, [prop(1, 2, true)]));
      expect(scene.children[0]?.visible, state).toBe(false);
      expect(markers.isAnyVisible, state).toBe(false);
    }
    markers.update(worldOf('finalRush', [prop(1, 2, true)]));
    markers.update(worldOf('photo', [prop(1, 2, true)]));
    expect(scene.children[0]?.visible).toBe(false);
  });

  it('writes the DOM only when a marker appears or goes', () => {
    const { markers, created } = build(1);
    const root = created.find((element) => element.className === 'pp-tidy-marker') as FakeElement;
    const writes = root.styleWrites;
    markers.update(worldOf('playing', [prop(1, 2, true)]));
    markers.update(worldOf('playing', [prop(1, 2, true)]));
    expect(root.styleWrites).toBe(writes);
    markers.update(worldOf('finalRush', [prop(1, 2, true)]));
    const shown = root.styleWrites;
    markers.update(worldOf('finalRush', [prop(1, 2, true)]));
    markers.update(worldOf('finalRush', [prop(1, 2.1, true)]));
    expect(root.styleWrites).toBe(shown);
    markers.update(worldOf('finalRush', [prop(1, 2.1, false)]));
    expect(root.styleWrites).toBe(shown + 1);
  });

  it('ignores a world with fewer props than markers, and unmounts cleanly', () => {
    const { markers, scene } = build(3);
    markers.update(worldOf('finalRush', [prop(1, 2, true)]));
    expect(scene.children.map((child) => child.visible)).toEqual([true, false, false]);
    markers.unmount();
    expect(scene.children).toHaveLength(0);
    expect(markers.isAnyVisible).toBe(false);
    markers.dispose();
  });
});
