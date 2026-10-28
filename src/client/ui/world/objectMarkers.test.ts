import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createObjectMarkers,
  OBJECT_CLASSES,
  OBJECT_ICON_PATHS,
  type ObjectMarkerSpec,
} from './objectMarkers.ts';
import { THREAT_ICON_PATHS } from './threatMarkers.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
}

const COFFEE: ObjectMarkerSpec = {
  id: 'coffee_machine',
  kind: 'coffee_machine',
  xM: 1,
  yM: 1.2,
  zM: -2,
};
const PHONE: ObjectMarkerSpec = { id: 'phone', kind: 'phone', xM: 3, yM: 0.8, zM: 0.5 };

function build() {
  const roots: FakeElement[] = [];
  const make = (): FakeElement => {
    const element = new FakeElement();
    roots.push(element);
    return element;
  };
  const doc = { createElement: make, createElementNS: make } as unknown as Pick<
    Document,
    'createElement' | 'createElementNS'
  >;
  const scene = new Scene();
  const markers = createObjectMarkers(scene, doc);
  const rootsOf = () =>
    roots.filter(
      (element) =>
        element.className === OBJECT_CLASSES.root ||
        element.className.startsWith(`${OBJECT_CLASSES.root} `),
    );
  return { scene, markers, rootsOf };
}

describe('createObjectMarkers', () => {
  it('draws a mug for the coffee machine at its icon point, and nothing for the phone yet', () => {
    const { scene, markers, rootsOf } = build();
    markers.mount([COFFEE, PHONE]);
    expect(rootsOf()).toHaveLength(1);
    expect(rootsOf()[0]?.attributes.get('data-pp-object')).toBe('coffee_machine');
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.position.toArray()).toEqual([1, 1.2, -2]);
    expect(OBJECT_ICON_PATHS.coffee_machine).toBe(THREAT_ICON_PATHS.mug);
    expect(OBJECT_ICON_PATHS.phone).toBeNull();
  });

  it('is visible while a marker is mounted, and not otherwise', () => {
    const { markers } = build();
    expect(markers.isAnyVisible).toBe(false);
    markers.mount([PHONE]);
    expect(markers.isAnyVisible).toBe(false);
    markers.mount([COFFEE]);
    expect(markers.isAnyVisible).toBe(true);
    markers.unmount();
    expect(markers.isAnyVisible).toBe(false);
  });

  it('replaces the previous level’s markers on a new mount', () => {
    const { scene, markers } = build();
    markers.mount([COFFEE]);
    markers.mount([COFFEE]);
    expect(scene.children).toHaveLength(1);
  });

  it('turns urgent while the fatigue is above its threshold, and back', () => {
    const { markers, rootsOf } = build();
    markers.mount([COFFEE]);
    const root = rootsOf()[0] as FakeElement;
    expect(root.className).toBe(OBJECT_CLASSES.root);
    markers.update(true);
    expect(root.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
    markers.update(false);
    expect(root.className).toBe(OBJECT_CLASSES.root);
  });

  it('forgets the urgency with the level: a new mount starts calm', () => {
    const { markers, rootsOf } = build();
    markers.mount([COFFEE]);
    markers.update(true);
    markers.mount([COFFEE]);
    const fresh = rootsOf().at(-1) as FakeElement;
    expect(fresh.className).toBe(OBJECT_CLASSES.root);
    markers.update(true);
    expect(fresh.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
  });
});
