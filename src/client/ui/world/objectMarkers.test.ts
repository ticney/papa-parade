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
const TOILET: ObjectMarkerSpec = { id: 'toilet', kind: 'toilet', xM: -2.2, yM: 1, zM: -2.85 };

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
  it('draws a mug for the coffee machine and a door for the toilet at their icon points, and nothing for the phone yet', () => {
    const { scene, markers, rootsOf } = build();
    markers.mount([COFFEE, PHONE, TOILET]);
    expect(rootsOf()).toHaveLength(2);
    expect(rootsOf().map((root) => root.attributes.get('data-pp-object'))).toEqual([
      'coffee_machine',
      'toilet',
    ]);
    expect(scene.children).toHaveLength(2);
    expect(scene.children[0]?.position.toArray()).toEqual([1, 1.2, -2]);
    expect(scene.children[1]?.position.toArray()).toEqual([-2.2, 1, -2.85]);
    expect(OBJECT_ICON_PATHS.coffee_machine).toBe(THREAT_ICON_PATHS.mug);
    expect(OBJECT_ICON_PATHS.phone).toBeNull();
    // The knob runs the other way round from the slab, so the nonzero fill leaves it a hole.
    expect(OBJECT_ICON_PATHS.toilet).toBe('M7 3h10v18H7z M13.6 11v2h1.8v-2z');
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
    markers.update(true, false, false);
    expect(root.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
    markers.update(false, false, false);
    expect(root.className).toBe(OBJECT_CLASSES.root);
  });

  it('keeps the door calm while Papa is tired, and the coffee calm while he is bursting (story 4.3)', () => {
    const { markers, rootsOf } = build();
    markers.mount([COFFEE, TOILET]);
    const [coffee, door] = rootsOf() as [FakeElement, FakeElement];
    markers.update(true, false, false);
    expect(coffee.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
    expect(door.className).toBe(OBJECT_CLASSES.root);
    markers.update(false, true, false);
    expect(coffee.className).toBe(OBJECT_CLASSES.root);
    expect(door.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
  });

  it('dims the door while Papa is on the toilet, with no pulse, whatever the need', () => {
    const { markers, rootsOf } = build();
    markers.mount([COFFEE, TOILET]);
    const [coffee, door] = rootsOf() as [FakeElement, FakeElement];
    markers.update(false, true, true);
    expect(door.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.occupied}`);
    expect(door.className).not.toContain(OBJECT_CLASSES.urgent);
    expect(coffee.className).toBe(OBJECT_CLASSES.root);
    markers.update(false, true, false);
    expect(door.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
  });

  it('writes the DOM only when a class changes', () => {
    const { markers, rootsOf } = build();
    markers.mount([COFFEE, TOILET]);
    const writes: string[] = [];
    for (const root of rootsOf()) {
      let value = root.className;
      Object.defineProperty(root, 'className', {
        get: () => value,
        set: (next: string) => {
          writes.push(next);
          value = next;
        },
      });
    }
    markers.update(false, false, false);
    markers.update(false, false, false);
    expect(writes).toEqual([]);
    markers.update(true, false, false);
    markers.update(true, false, false);
    expect(writes).toHaveLength(1);
    markers.update(true, true, false);
    markers.update(true, true, false);
    expect(writes).toHaveLength(2);
  });

  it('forgets the urgency with the level: a new mount starts calm', () => {
    const { markers, rootsOf } = build();
    markers.mount([COFFEE]);
    markers.update(true, false, false);
    markers.mount([COFFEE]);
    const fresh = rootsOf().at(-1) as FakeElement;
    expect(fresh.className).toBe(OBJECT_CLASSES.root);
    markers.update(true, false, false);
    expect(fresh.className).toBe(`${OBJECT_CLASSES.root} ${OBJECT_CLASSES.urgent}`);
  });
});
