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
   * Shows the chip beside an off-screen bubble (story 9.3, D7): at the world point `(xM, yM, zM)` that
   * projects to the bubble's centre, on `side` of it, `halfPx` from the centre (the bubble's outer
   * radius) plus a gap. Still the one chip: it leaves the threat it showed. Writes on change only.
   */
  showAtPoint(
    xM: number,
    yM: number,
    zM: number,
    text: string,
    side: GlyphChipSide,
    halfPx: number,
  ): void;
  /**
   * Places the chip again for the entry it shows: the verb layout runs inside `worldUi.render`, after
   * `showAt`, so a verb pushed up this frame must move the chip in the same frame. Nothing when hidden.
   */
  refresh(): void;
  hide(): void;
  dispose(): void;
}

type Doc = Pick<Document, 'createElement'>;

/** Which side of an off-screen bubble the chip hangs on (story 9.3). */
export type GlyphChipSide = 'right' | 'left' | 'below';

/** The anchor's class per side of a bubble; the right is the default placement. */
const BUBBLE_SIDE_CLASSES: Readonly<Record<GlyphChipSide, string | null>> = {
  right: null,
  left: 'pp-glyph-chip-anchor--bubble-left',
  below: 'pp-glyph-chip-anchor--bubble-below',
};

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

  /** The anchor has `BESIDE_VERB_CLASS`. */
  let isBesideVerb = false;
  const setBesideVerb = (next: boolean): void => {
    if (next === isBesideVerb) return;
    isBesideVerb = next;
    anchor.classList.toggle(BESIDE_VERB_CLASS, next);
  };
  /** The bubble side the chip is on, or null beside a threat's icon or verb. */
  let bubbleSide: GlyphChipSide | null = null;
  const setBubbleSide = (next: GlyphChipSide | null): void => {
    if (next === bubbleSide) return;
    const before = bubbleSide === null ? null : BUBBLE_SIDE_CLASSES[bubbleSide];
    const after = next === null ? null : BUBBLE_SIDE_CLASSES[next];
    if (before !== null) anchor.classList.toggle(before, false);
    if (after !== null) anchor.classList.toggle(after, true);
    bubbleSide = next;
  };
  const moveTo = (xM: number, yM: number, zM: number): void => {
    const { position } = object;
    if (position.x !== xM || position.y !== yM || position.z !== zM) position.set(xM, yM, zM);
  };
  const setText = (next: string): void => {
    if (next === text) return;
    text = next;
    chip.textContent = next;
  };
  const reveal = (): void => {
    if (object.visible) return;
    object.visible = true;
    anchor.style.display = '';
  };

  /** Beside the verb when the entry has one (its box is laid out), else beside the icon. */
  const place = (entry: ThreatMarkerEntry): void => {
    setBubbleSide(null);
    moveTo(entry.xM, entry.yM, entry.zM);
    const hasVerb = entry.verbWidthPx > 0;
    const nextHalf = hasVerb ? entry.verbWidthPx / 2 : -1;
    const nextRise = hasVerb ? entry.verbOffsetPx + entry.verbHeightPx / 2 : -1;
    setBesideVerb(hasVerb);
    if (nextHalf !== halfWidthPx) {
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
      setText(next);
      shown = entry;
      place(entry);
      reveal();
    },
    showAtPoint(xM, yM, zM, next, side, nextHalfPx) {
      setText(next);
      shown = null;
      setBubbleSide(side);
      moveTo(xM, yM, zM);
      // The bubble's radius, as the verb's half width is beside a verb: no rise, no shift.
      setBesideVerb(false);
      if (halfWidthPx !== nextHalfPx) {
        halfWidthPx = nextHalfPx;
        anchor.style.setProperty('--pp-chip-half', `${nextHalfPx}px`);
      }
      if (shiftPx !== 0) {
        shiftPx = 0;
        anchor.style.removeProperty('--pp-chip-shift');
      }
      if (risePx !== -1) {
        risePx = -1;
        anchor.style.removeProperty('--pp-chip-rise');
      }
      reveal();
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
