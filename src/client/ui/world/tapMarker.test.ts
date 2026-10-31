import { TAP_MARKER_FADE_MS, TAP_MARKER_SCALE_FROM, TAP_MARKER_SCALE_TO } from '@shared/constants';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createTapMarker, tapMarkerKeyframes } from './tapMarker.ts';

/** The few things of a DOM element and a Web Animation the marker uses. */
class FakeAnimation {
  isCancelled = false;
  listeners: (() => void)[] = [];
  readonly keyframes: unknown;
  readonly options: unknown;
  constructor(keyframes: unknown, options: unknown) {
    this.keyframes = keyframes;
    this.options = options;
  }
  cancel(): void {
    this.isCancelled = true;
  }
  addEventListener(_type: 'finish', listener: () => void): void {
    this.listeners.push(listener);
  }
  finish(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  animations: FakeAnimation[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(child: FakeElement): void {
    this.children.push(child);
  }
  animate(keyframes: unknown, options: unknown): FakeAnimation {
    const animation = new FakeAnimation(keyframes, options);
    this.animations.push(animation);
    return animation;
  }
}

function build(isMotionReduced: () => boolean = () => false) {
  const created: FakeElement[] = [];
  const doc = {
    createElement: () => {
      const element = new FakeElement();
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement'>;
  const scene = new Scene();
  const marker = createTapMarker(scene, doc, isMotionReduced);
  const [outer, ring] = created as [FakeElement, FakeElement];
  return { scene, marker, outer, ring };
}

describe('tapMarkerKeyframes', () => {
  it('goes from the start scale at full opacity to the end scale at none, from the constants', () => {
    expect(tapMarkerKeyframes()).toEqual([
      { transform: `scale(${TAP_MARKER_SCALE_FROM})`, opacity: 1 },
      { transform: `scale(${TAP_MARKER_SCALE_TO})`, opacity: 0 },
    ]);
    expect(TAP_MARKER_SCALE_FROM).toBeLessThan(TAP_MARKER_SCALE_TO);
  });

  it('under reduced motion only fades: no scale, same opacity ramp (story 2.10)', () => {
    expect(tapMarkerKeyframes(true)).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(tapMarkerKeyframes(false)).toEqual(tapMarkerKeyframes());
  });
});

describe('createTapMarker', () => {
  it('is an outer box with a ring inside, hidden from assistive tech, and not shown at first', () => {
    const { marker, outer, ring, scene } = build();
    expect(outer.className).toBe('pp-tap-marker');
    expect(outer.attributes.get('aria-hidden')).toBe('true');
    expect(outer.children).toEqual([ring]);
    expect(ring.className).toBe('pp-tap-marker-ring');
    expect(marker.isVisible).toBe(false);
    expect(scene.children).toHaveLength(1);
  });

  it('shows at the floor point and fades the ring over the constant duration', () => {
    const { marker, ring, scene } = build();
    marker.showAt(1.5, -2);
    expect(marker.isVisible).toBe(true);
    expect(scene.children[0]?.position.toArray()).toEqual([1.5, 0, -2]);
    expect(ring.animations).toHaveLength(1);
    expect(ring.animations[0]?.options).toEqual({
      duration: TAP_MARKER_FADE_MS,
      easing: 'ease-out',
    });
    expect(ring.animations[0]?.keyframes).toEqual(tapMarkerKeyframes());
  });

  describe('under reduced motion (story 2.10)', () => {
    it('fades the ring with no scale, over the same duration', () => {
      const { marker, ring } = build(() => true);
      marker.showAt(1, 2);
      expect(ring.animations[0]?.keyframes).toEqual(tapMarkerKeyframes(true));
      expect(ring.animations[0]?.options).toEqual({
        duration: TAP_MARKER_FADE_MS,
        easing: 'ease-out',
      });
    });

    it('reads the setting at each showAt, so a switch applies to the very next tap', () => {
      let isReduced = false;
      const { marker, ring } = build(() => isReduced);
      marker.showAt(0, 0);
      isReduced = true;
      marker.showAt(0, 0);
      isReduced = false;
      marker.showAt(0, 0);
      expect(ring.animations.map((animation) => animation.keyframes)).toEqual([
        tapMarkerKeyframes(false),
        tapMarkerKeyframes(true),
        tapMarkerKeyframes(false),
      ]);
    });

    it('still places, shows and hides the marker as usual', () => {
      const { marker, ring, scene } = build(() => true);
      marker.showAt(1.5, -2);
      expect(marker.isVisible).toBe(true);
      expect(scene.children[0]?.position.toArray()).toEqual([1.5, 0, -2]);
      ring.animations[0]?.finish();
      expect(marker.isVisible).toBe(false);
    });
  });

  it('hides when the fade is over', () => {
    const { marker, outer, ring } = build();
    marker.showAt(0, 0);
    ring.animations[0]?.finish();
    expect(marker.isVisible).toBe(false);
    expect(outer.style.display).toBe('none');
  });

  it('a second tap restarts the marker: the first animation is cancelled and moves on to the new point', () => {
    const { marker, ring, scene } = build();
    marker.showAt(1, 1);
    marker.showAt(2, 3);
    expect(ring.animations[0]?.isCancelled).toBe(true);
    expect(ring.animations[1]?.isCancelled).toBe(false);
    expect(scene.children[0]?.position.toArray()).toEqual([2, 0, 3]);
  });

  it('a late finish of a replaced animation does not hide the newer one', () => {
    const { marker, ring } = build();
    marker.showAt(1, 1);
    marker.showAt(2, 3);
    ring.animations[0]?.finish();
    expect(marker.isVisible).toBe(true);
    ring.animations[1]?.finish();
    expect(marker.isVisible).toBe(false);
  });

  it('can be shown again after it faded', () => {
    const { marker, outer, ring } = build();
    marker.showAt(0, 0);
    ring.animations[0]?.finish();
    marker.showAt(4, 4);
    expect(marker.isVisible).toBe(true);
    expect(outer.style.display).toBe('');
  });

  it('dispose cancels the animation and takes the marker out of the scene', () => {
    const { marker, ring, scene } = build();
    marker.showAt(0, 0);
    marker.dispose();
    expect(ring.animations[0]?.isCancelled).toBe(true);
    expect(marker.isVisible).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
});
