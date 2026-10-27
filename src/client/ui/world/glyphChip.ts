import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { ThreatMarkerEntry } from './threatMarkers.ts';

export interface GlyphChip {
  /** True from `showAt` until `hide`. */
  readonly isVisible: boolean;
  /**
   * Shows the chip beside the icon of `entry`, with `text` (a key name or a button glyph). Moves
   * with the target when called again for another one; writes the DOM only when the text changes
   * and the scene only when the point does. Drawn by the next `worldUi.render`.
   */
  showAt(entry: ThreatMarkerEntry, text: string): void;
  hide(): void;
  dispose(): void;
}

type Doc = Pick<Document, 'createElement'>;

/**
 * The one `glyph-chip` (DESIGN.md › glyph-chip): a paper pill with an ink outline that names the
 * key or button that parries the targeted threat. One `CSS2DObject`, moved: « exactly one » is true
 * by construction (UX-DR11). The outer element is a zero-size anchor the `CSS2DRenderer` centres on
 * the icon's point; the CSS puts the chip to the right of the icon from the icon's size. `doc`
 * makes the elements (the browser's `document`; a double in tests).
 */
export function createGlyphChip(scene: Scene, doc: Doc = document): GlyphChip {
  const anchor = doc.createElement('div');
  anchor.className = 'pp-glyph-chip-anchor';
  anchor.setAttribute('aria-hidden', 'true');
  const chip = doc.createElement('span');
  chip.className = 'pp-glyph-chip pp-type-label';
  anchor.append(chip);
  // Hidden until shown: the CSS2D renderer only writes `display` when it runs.
  anchor.style.display = 'none';

  const object = new CSS2DObject(anchor);
  object.visible = false;
  scene.add(object);
  let text = '';

  return {
    get isVisible() {
      return object.visible;
    },
    showAt(entry, next) {
      if (next !== text) {
        text = next;
        chip.textContent = next;
      }
      const { position } = object;
      if (position.x !== entry.xM || position.y !== entry.yM || position.z !== entry.zM) {
        position.set(entry.xM, entry.yM, entry.zM);
      }
      if (!object.visible) {
        object.visible = true;
        anchor.style.display = '';
      }
    },
    hide() {
      if (!object.visible) return;
      object.visible = false;
      anchor.style.display = 'none';
    },
    dispose() {
      object.visible = false;
      scene.remove(object);
    },
  };
}
