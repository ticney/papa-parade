import type { Camera, Scene } from 'three';
import { Scene as ThreeScene } from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createTapMarker, type TapMarker } from './tapMarker.ts';

export interface WorldUi {
  /** The small scene that holds the world-anchored elements (today the tap marker). */
  readonly scene: Scene;
  readonly tapMarker: TapMarker;
  /** Sizes the layer like the canvas, in CSS px; a marker would drift from its point otherwise. */
  setSize(widthPx: number, heightPx: number): void;
  /**
   * Places the elements for this frame's camera. Returns at once, without calling the DOM
   * renderer, while nothing in the layer is visible.
   */
  render(camera: Camera): void;
  dispose(): void;
}

/**
 * The world-anchored UI layer (`#pp-world`, between the canvas and the HUD): one `CSS2DRenderer`
 * with its own scene. `sortObjects` is off: the renderer's z-sort allocates arrays every frame,
 * and one marker has nothing to sort. `doc` makes the elements (the browser's `document`; a double
 * in tests).
 */
export function createWorldUi(
  container: HTMLElement,
  doc: Pick<Document, 'createElement'> = document,
): WorldUi {
  const renderer = new CSS2DRenderer({ element: container });
  renderer.sortObjects = false;
  const scene = new ThreeScene();
  const tapMarker = createTapMarker(scene, doc);
  return {
    scene,
    tapMarker,
    setSize(widthPx, heightPx) {
      renderer.setSize(widthPx, heightPx);
    },
    render(camera) {
      if (!tapMarker.isVisible) return;
      renderer.render(scene, camera);
    },
    dispose() {
      tapMarker.dispose();
    },
  };
}
