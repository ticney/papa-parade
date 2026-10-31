import { TAP_MARKER_FADE_MS, TAP_MARKER_SCALE_FROM, TAP_MARKER_SCALE_TO } from '@shared/constants';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export interface TapMarker {
  /** True from `showAt` until the fade is over. */
  readonly isVisible: boolean;
  /**
   * Shows the marker at a point of the floor: it grows from `TAP_MARKER_SCALE_FROM` to
   * `TAP_MARKER_SCALE_TO` while it fades out over `TAP_MARKER_FADE_MS`. A tap while it is still
   * showing restarts it at the new point. It is drawn by the next `worldUi.render`.
   */
  showAt(xM: number, zM: number): void;
  dispose(): void;
}

/**
 * The two keyframes of the marker's ring, built from the constants (DESIGN.md › tap-marker). Under
 * reduced motion the ring only fades: the scale is the one movement it has (story 2.10).
 */
export function tapMarkerKeyframes(isMotionReduced = false): Keyframe[] {
  if (isMotionReduced) return [{ opacity: 1 }, { opacity: 0 }];
  return [
    { transform: `scale(${TAP_MARKER_SCALE_FROM})`, opacity: 1 },
    { transform: `scale(${TAP_MARKER_SCALE_TO})`, opacity: 0 },
  ];
}

const KEYFRAMES = tapMarkerKeyframes();
const REDUCED_KEYFRAMES = tapMarkerKeyframes(true);

/**
 * The one pooled tap marker, re-used for every tap. Two elements, so that two transforms never
 * fight: the outer one is placed on the floor point by the `CSS2DRenderer` (it writes its
 * `transform`), the inner ring is scaled and faded by the Web Animations API. `doc` makes the
 * elements (the browser's `document`; a double in tests). `isMotionReduced` is read at each `showAt`.
 */
export function createTapMarker(
  scene: Scene,
  doc: Pick<Document, 'createElement'>,
  isMotionReduced: () => boolean = () => false,
): TapMarker {
  const element = doc.createElement('div');
  element.className = 'pp-tap-marker';
  element.setAttribute('aria-hidden', 'true');
  const ring = doc.createElement('div');
  ring.className = 'pp-tap-marker-ring';
  element.append(ring);

  const object = new CSS2DObject(element);
  object.visible = false;
  scene.add(object);
  let current: Animation | null = null;

  return {
    get isVisible() {
      return object.visible;
    },
    showAt(xM, zM) {
      object.position.set(xM, 0, zM);
      current?.cancel();
      object.visible = true;
      element.style.display = '';
      const animation = ring.animate(isMotionReduced() ? REDUCED_KEYFRAMES : KEYFRAMES, {
        duration: TAP_MARKER_FADE_MS,
        easing: 'ease-out',
      });
      current = animation;
      animation.addEventListener('finish', () => {
        // A cancelled animation never gets here, but be sure a late one cannot hide a newer one.
        if (current !== animation) return;
        current = null;
        object.visible = false;
        element.style.display = 'none';
      });
    },
    dispose() {
      current?.cancel();
      current = null;
      object.visible = false;
      scene.remove(object);
    },
  };
}
