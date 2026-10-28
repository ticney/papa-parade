import type { ThreatInstance } from '@sim';
import type { Camera, Scene } from 'three';
import { Scene as ThreeScene } from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createGlyphChip, type GlyphChip } from './glyphChip.ts';
import { createTapMarker, type TapMarker } from './tapMarker.ts';
import { createThreatMarkers, type ThreatMarkerEntry } from './threatMarkers.ts';

export interface WorldUi {
  /** The small scene that holds the world-anchored elements (the tap marker, the threat icons and the glyph chip). */
  readonly scene: Scene;
  readonly tapMarker: TapMarker;
  /** The one key or button glyph beside the auto-targeted threat (story 1.17). */
  readonly glyphChip: GlyphChip;
  /** Mounts the threat icons of a level, replacing the previous level's (all hidden until a frame shows them). */
  mountThreats(entries: readonly ThreatMarkerEntry[]): void;
  /** Removes the threat icons (a restart hides the old ones before its countdown). */
  unmountThreats(): void;
  /**
   * Once per frame, before `render`: shows the icons of the active threats and highlights
   * `highlightedId` (pressed) and `targetedId` (auto-targeted, null on touch and mouse). True when
   * a press began to show in this call (a target ring alone is not one).
   */
  updateThreats(
    threats: readonly Readonly<ThreatInstance>[],
    highlightedId: number | null,
    targetedId: number | null,
  ): boolean;
  /** The icon points of the mounted level, for the hit test. */
  readonly threatEntries: readonly ThreatMarkerEntry[];
  /** Sizes the layer like the canvas, in CSS px; a marker would drift from its point otherwise. */
  setSize(widthPx: number, heightPx: number): void;
  /**
   * Places the elements for this frame's camera. Returns at once, without calling the DOM
   * renderer, while nothing in the layer is visible (no tap marker, no threat icon, no chip).
   */
  render(camera: Camera): void;
  dispose(): void;
}

/**
 * The world-anchored UI layer (`#pp-world`, between the canvas and the HUD): one `CSS2DRenderer`
 * with its own scene. `sortObjects` is off: the renderer's z-sort allocates arrays every frame,
 * and a few markers have nothing to sort. `doc` makes the elements (the browser's `document`; a double
 * in tests).
 */
export function createWorldUi(
  container: HTMLElement,
  doc: Pick<Document, 'createElement' | 'createElementNS'> = document,
): WorldUi {
  const renderer = new CSS2DRenderer({ element: container });
  renderer.sortObjects = false;
  const scene = new ThreeScene();
  const tapMarker = createTapMarker(scene, doc);
  const threats = createThreatMarkers(scene, doc);
  const glyphChip = createGlyphChip(scene, doc);
  return {
    scene,
    tapMarker,
    glyphChip,
    mountThreats: threats.mount,
    unmountThreats: threats.unmount,
    updateThreats: threats.update,
    get threatEntries() {
      return threats.entries;
    },
    setSize(widthPx, heightPx) {
      renderer.setSize(widthPx, heightPx);
    },
    render(camera) {
      if (!(tapMarker.isVisible || threats.isAnyVisible || glyphChip.isVisible)) return;
      renderer.render(scene, camera);
    },
    dispose() {
      tapMarker.dispose();
      glyphChip.dispose();
      threats.dispose();
    },
  };
}
