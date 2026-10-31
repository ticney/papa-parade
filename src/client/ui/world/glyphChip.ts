import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { ThreatMarkerEntry } from './threatMarkers.ts';

export interface GlyphChip {
  /** True from `showAt` until `hide`. */
  readonly isVisible: boolean;
  /**
   * Shows the chip beside the verb of `entry` (story 2.2: « beside the auto-targeted threat's verb »),
   * or beside its icon when it has no verb, with `text` (a key name or a button glyph). Moves with the
   * target when called again for another one; writes the DOM only when the text or the verb's box
   * changes and the scene only when the point does. Drawn by the next `worldUi.render`.
   */
  showAt(entry: ThreatMarkerEntry, text: string): void;
  /**
   * Places the chip again for the entry it shows: the verb layout runs inside `worldUi.render`, after
   * `showAt`, so a verb pushed up this frame must move the chip in the same frame. Nothing when hidden.
   */
  refresh(): void;
  hide(): void;
  dispose(): void;
}

type Doc = Pick<Document, 'createElement'>;

/** The anchor's class while the chip hangs from a verb (the CSS reads `--pp-chip-half`, `--pp-chip-shift` and `--pp-chip-rise`). */
const BESIDE_VERB_CLASS = 'pp-glyph-chip-anchor--beside-verb';

/**
 * The one `glyph-chip` (DESIGN.md › glyph-chip): a paper pill with an ink outline that names the
 * key or button that parries the targeted threat. One `CSS2DObject`, moved: « exactly one » is true
 * by construction (UX-DR11). The outer element is a zero-size anchor the `CSS2DRenderer` centres on
 * the icon's point; the CSS puts the chip to the right of the icon from the icon's size, or, with a verb,
 * to the right of the verb (and as high as it is pushed) from the two variables written here. `doc`
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
  let shown: ThreatMarkerEntry | null = null;
  // The verb box as drawn: the half width and the rise of its centre above the icon, in px; -1 = beside the icon.
  let halfWidthPx = -1;
  let risePx = -1;
  /** How far the verb was shifted sideways to stay on screen, in px; the chip follows it. */
  let shiftPx = 0;

  /** Beside the verb when the entry has one (its box is laid out), else beside the icon. */
  const place = (entry: ThreatMarkerEntry): void => {
    const { position } = object;
    if (position.x !== entry.xM || position.y !== entry.yM || position.z !== entry.zM) {
      position.set(entry.xM, entry.yM, entry.zM);
    }
    const hasVerb = entry.verbWidthPx > 0;
    const nextHalf = hasVerb ? entry.verbWidthPx / 2 : -1;
    const nextRise = hasVerb ? entry.verbOffsetPx + entry.verbHeightPx / 2 : -1;
    if (nextHalf !== halfWidthPx) {
      if (hasVerb !== halfWidthPx > 0) anchor.classList.toggle(BESIDE_VERB_CLASS, hasVerb);
      halfWidthPx = nextHalf;
      if (hasVerb) anchor.style.setProperty('--pp-chip-half', `${nextHalf}px`);
      else anchor.style.removeProperty('--pp-chip-half');
    }
    const nextShift = hasVerb ? (entry.verbShiftXPx ?? 0) : 0;
    if (nextShift !== shiftPx) {
      shiftPx = nextShift;
      if (nextShift !== 0) anchor.style.setProperty('--pp-chip-shift', `${nextShift}px`);
      else anchor.style.removeProperty('--pp-chip-shift');
    }
    if (nextRise !== risePx) {
      risePx = nextRise;
      if (hasVerb) anchor.style.setProperty('--pp-chip-rise', `${nextRise}px`);
      else anchor.style.removeProperty('--pp-chip-rise');
    }
  };

  return {
    get isVisible() {
      return object.visible;
    },
    showAt(entry, next) {
      if (next !== text) {
        text = next;
        chip.textContent = next;
      }
      shown = entry;
      place(entry);
      if (!object.visible) {
        object.visible = true;
        anchor.style.display = '';
      }
    },
    refresh() {
      if (shown !== null && object.visible) place(shown);
    },
    hide() {
      shown = null;
      if (!object.visible) return;
      object.visible = false;
      anchor.style.display = 'none';
    },
    dispose() {
      shown = null;
      object.visible = false;
      scene.remove(object);
    },
  };
}
