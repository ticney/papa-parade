import {
  CHRONO_RING_FINAL_ARC_STROKE_PX,
  CHRONO_RING_GAP_PX,
  CHRONO_RING_NOTCH_PX,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  OFFSCREEN_BUBBLE_BORDER_PX,
  OFFSCREEN_BUBBLE_CHEVRON_PX,
  OFFSCREEN_BUBBLE_ICON_COMPACT_PX,
  OFFSCREEN_BUBBLE_ICON_REGULAR_PX,
  OFFSCREEN_BUBBLE_MAX_COUNT,
} from '@shared/constants';
import type { Translator } from '../strings.ts';
import { CHRONO_PERMILLE_STRINGS, type ChronoRing } from './chronoRing.ts';
import { CHRONO_HIDDEN } from './chronoRingElement.ts';
import type { OffscreenSlot } from './offscreenLayout.ts';
import { offscreenBubbleRadii } from './offscreenLayout.ts';
import {
  type ChronoDraw,
  createThreatIconElement,
  type ThreatMarkerEntry,
} from './threatMarkers.ts';

// The off-screen bubbles of a follow level (story 9.3, D1, D5, D6; DESIGN.md › offscreen-bubble): HUD
// elements, screen-anchored in `#pp-hud`, one per threat whose icon is outside the follow frame. A paper
// disc with an ink border, the threat's own icon (built once per level by the marker's builder), its
// chrono-ring as the marker draws it this frame, and an ink chevron toward the threat (the root's
// `::after`, turned by `--pp-offscreen-angle`). `offscreenLayout.ts` says where; this file writes the
// DOM, on change only, and mounts a bubble only while it shows. It takes no input: the canvas gets the
// tap, and `pick` answers which bubble it hit (D4). No animation: it pops in and out.

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

export const OFFSCREEN_BUBBLE_CLASSES = {
  root: 'pp-offscreen-bubble',
  /** The keyboard / gamepad target, or the pressed threat (D7): the target-highlight around the disc. */
  targeted: 'pp-offscreen-bubble--targeted',
  /** The window is open: the final arc is lit. */
  lit: 'pp-offscreen-bubble--lit',
  /** A held Firmness drains the ring: no lit arc, no notch. */
  hold: 'pp-offscreen-bubble--hold',
  /** The band: paper progress over the ring-track (the lit colour past the arc's start), and the notch. */
  band: 'pp-offscreen-band',
  /** Under the band: its ink outline, and the lit arc's outer part and its ink. */
  arc: 'pp-offscreen-arc',
} as const;

/**
 * The bubble's pixel sizes per surface, from the constants (`offscreenBubbleSpec.test.ts` pins them to
 * DESIGN.md): written once on the page root as `--pp-offscreen-<name>-<surface>`, which `ui.css` reads for
 * the surface it is on. Every radius is counted from the bubble's centre.
 */
export function offscreenBubbleMetrics(iconPx: number): Readonly<Record<string, number>> {
  const radii = offscreenBubbleRadii(iconPx);
  const ringInPx = iconPx / 2 + CHRONO_RING_GAP_PX;
  return {
    icon: iconPx,
    disc: radii.discPx,
    border: OFFSCREEN_BUBBLE_BORDER_PX,
    'ring-in': ringInPx,
    'band-out': ringInPx + HOLD_RING_STROKE_PX,
    'outline-out': ringInPx + HOLD_RING_STROKE_PX + HOLD_RING_OUTLINE_PX,
    'arc-out': ringInPx + CHRONO_RING_FINAL_ARC_STROKE_PX,
    reach: ringInPx + CHRONO_RING_FINAL_ARC_STROKE_PX + HOLD_RING_OUTLINE_PX,
    chevron: OFFSCREEN_BUBBLE_CHEVRON_PX,
    // The notch is 2 px across the arc: as a half-angle at the arc's middle radius, in degrees.
    'notch-deg':
      ((CHRONO_RING_NOTCH_PX / 2 / (ringInPx + CHRONO_RING_FINAL_ARC_STROKE_PX / 2)) * 180) /
      Math.PI,
  };
}

/** Writes the bubble's sizes for both surfaces on the page root (once, at boot). */
export function applyOffscreenBubbleMetrics(root: { readonly style: CSSStyleDeclaration }): void {
  for (const [surface, iconPx] of [
    ['compact', OFFSCREEN_BUBBLE_ICON_COMPACT_PX],
    ['regular', OFFSCREEN_BUBBLE_ICON_REGULAR_PX],
  ] as const) {
    for (const [name, value] of Object.entries(offscreenBubbleMetrics(iconPx))) {
      const unit = name === 'notch-deg' ? 'deg' : 'px';
      const property = name === 'notch-deg' ? 'notch' : name;
      root.style.setProperty(`--pp-offscreen-${property}-${surface}`, `${value}${unit}`);
    }
  }
}

/** Whole px as strings, built once: the positions are written with no per-frame concatenation. */
const PX_STRINGS: readonly string[] = Array.from({ length: 4096 }, (_, px) => `${px}px`);
const pxString = (px: number): string => PX_STRINGS[px] ?? `${px}px`;
/** Whole degrees as strings, `[0, 360)`. */
const DEG_STRINGS: readonly string[] = Array.from({ length: 360 }, (_, deg) => `${deg}deg`);

export interface OffscreenBubblesOptions {
  readonly t: Translator;
  /** Where a shown bubble is mounted: `#pp-hud`. */
  readonly host: Pick<HTMLElement, 'append'>;
  /** The ring geometry the threat's marker holds (`worldUi.chronoRingOf`): where the lit arc starts, the notch. */
  chronoRingOf(threatId: number): Readonly<ChronoRing> | null;
  /** What the threat's marker drew of its ring this frame (`worldUi.chronoDrawOf`). */
  chronoDrawOf(threatId: number): Readonly<ChronoDraw> | null;
}

export interface OffscreenBubbles {
  /** The bubbles' root elements, shown or not (for the tests). */
  readonly elements: readonly HTMLElement[];
  /** A new level: one icon per marker entry, built now and kept detached. Hides every bubble. */
  setLevel(entries: readonly ThreatMarkerEntry[]): void;
  /** The paper disc's radius on this surface, border included, in CSS px: what `pick` tests. On every resize. */
  setDiscRadius(discPx: number): void;
  /**
   * Once per frame, after the markers' update (the ring is copied from what they drew this frame): shows the
   * layout's `slots`, a threat keeping its bubble element from frame to frame, and highlights the bubble of
   * `targetedId` (the keyboard or gamepad target) and of `pressedId` (a press, D7). Writes the DOM only on a
   * change; allocates nothing.
   */
  update(
    slots: readonly Readonly<OffscreenSlot>[],
    targetedId: number | null,
    pressedId?: number | null,
  ): void;
  /** The threat whose disc holds the point `(xPx, yPx)` (CSS px of the HUD root), the nearest one; null for none. */
  pick(xPx: number, yPx: number): number | null;
  /** Hides every bubble (a level that is not live, a level left). */
  hide(): void;
}

interface Shell {
  readonly root: HTMLElement;
  readonly band: HTMLElement;
  readonly arc: HTMLElement;
  /** The threat shown, -1 for none; the slot it takes this frame, -1 for none. */
  threatId: number;
  nextSlot: number;
  /** The entry index of the threat shown (its icon), -1 for none. */
  entryIndex: number;
  isMounted: boolean;
  hasRing: boolean;
  xPx: number;
  yPx: number;
  angleDeg: number;
  permille: number;
  isLit: boolean;
  isHold: boolean;
  isTargeted: boolean;
  arcFromPermille: number;
  notchPermille: number;
}

/** The bubbles of one game (`OFFSCREEN_BUBBLE_MAX_COUNT` reusable elements). `doc` makes the elements. */
export function createOffscreenBubbles(
  doc: Doc,
  options: OffscreenBubblesOptions,
): OffscreenBubbles {
  const label = options.t('hud.offscreen_bubble_label');
  const shells: Shell[] = [];
  for (let i = 0; i < OFFSCREEN_BUBBLE_MAX_COUNT; i++) {
    const root = doc.createElement('div');
    root.className = OFFSCREEN_BUBBLE_CLASSES.root;
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', label);
    const band = doc.createElement('div');
    band.className = OFFSCREEN_BUBBLE_CLASSES.band;
    band.setAttribute('aria-hidden', 'true');
    const arc = doc.createElement('div');
    arc.className = OFFSCREEN_BUBBLE_CLASSES.arc;
    arc.setAttribute('aria-hidden', 'true');
    // Hidden until the marker's ring is drawn (the first frame of a bubble shows it).
    band.hidden = true;
    arc.hidden = true;
    shells.push({
      root,
      band,
      arc,
      threatId: -1,
      nextSlot: -1,
      entryIndex: -1,
      isMounted: false,
      hasRing: false,
      xPx: Number.NaN,
      yPx: Number.NaN,
      angleDeg: Number.NaN,
      permille: CHRONO_HIDDEN,
      isLit: false,
      isHold: false,
      isTargeted: false,
      arcFromPermille: -1,
      notchPermille: -1,
    });
  }
  let entries: readonly ThreatMarkerEntry[] = [];
  let icons: HTMLElement[] = [];
  let discPx = 0;
  const isSlotTaken = Array.from({ length: OFFSCREEN_BUBBLE_MAX_COUNT }, () => false);

  const entryIndexOf = (threatId: number): number => {
    for (let i = 0; i < entries.length; i++) {
      if ((entries[i] as ThreatMarkerEntry).threatId === threatId) return i;
    }
    return -1;
  };

  const toggle = (shell: Shell, name: string, isOn: boolean): void => {
    shell.root.classList.toggle(name, isOn);
  };

  /** Empties a shell: its icon and its ring leave it, it leaves the HUD. */
  const release = (shell: Shell): void => {
    if (shell.isMounted) {
      shell.root.remove();
      shell.isMounted = false;
    }
    if (shell.entryIndex !== -1) icons[shell.entryIndex]?.remove();
    if (shell.hasRing) {
      shell.band.remove();
      shell.arc.remove();
      shell.hasRing = false;
    }
    if (shell.permille !== CHRONO_HIDDEN) {
      shell.band.hidden = true;
      shell.arc.hidden = true;
    }
    if (shell.isLit) toggle(shell, OFFSCREEN_BUBBLE_CLASSES.lit, false);
    if (shell.isHold) toggle(shell, OFFSCREEN_BUBBLE_CLASSES.hold, false);
    if (shell.isTargeted) toggle(shell, OFFSCREEN_BUBBLE_CLASSES.targeted, false);
    shell.isLit = false;
    shell.isHold = false;
    shell.isTargeted = false;
    shell.threatId = -1;
    shell.entryIndex = -1;
    shell.permille = CHRONO_HIDDEN;
    shell.arcFromPermille = -1;
    shell.notchPermille = -1;
  };

  /** Gives a shell its threat: its icon, and the ring only for a response that has one (never on a `wait`). */
  const take = (shell: Shell, threatId: number): void => {
    release(shell);
    shell.threatId = threatId;
    shell.entryIndex = entryIndexOf(threatId);
    const entry = entries[shell.entryIndex];
    if (entry?.hasChronoRing === true) {
      shell.root.append(shell.arc, shell.band);
      shell.hasRing = true;
    }
    const icon = icons[shell.entryIndex];
    if (icon !== undefined) shell.root.append(icon);
  };

  const drawRing = (shell: Shell): void => {
    if (!shell.hasRing) return;
    const geometry = options.chronoRingOf(shell.threatId);
    if (geometry !== null) {
      if (geometry.arcFromPermille !== shell.arcFromPermille) {
        shell.arcFromPermille = geometry.arcFromPermille;
        shell.root.style.setProperty(
          '--pp-offscreen-arc-from',
          CHRONO_PERMILLE_STRINGS[geometry.arcFromPermille] as string,
        );
      }
      if (geometry.notchPermille !== shell.notchPermille) {
        shell.notchPermille = geometry.notchPermille;
        shell.root.style.setProperty(
          '--pp-offscreen-notch-at',
          CHRONO_PERMILLE_STRINGS[geometry.notchPermille] as string,
        );
      }
    }
    const drawn = options.chronoDrawOf(shell.threatId);
    const permille = drawn?.permille ?? CHRONO_HIDDEN;
    const isLit = drawn?.isLit ?? false;
    const isHold = drawn?.isHold ?? false;
    if (permille !== shell.permille) {
      if ((permille === CHRONO_HIDDEN) !== (shell.permille === CHRONO_HIDDEN)) {
        const isHidden = permille === CHRONO_HIDDEN;
        shell.band.hidden = isHidden;
        shell.arc.hidden = isHidden;
      }
      shell.permille = permille;
      if (permille !== CHRONO_HIDDEN) {
        shell.root.style.setProperty(
          '--pp-offscreen-progress',
          CHRONO_PERMILLE_STRINGS[permille] as string,
        );
      }
    }
    if (isLit !== shell.isLit) {
      shell.isLit = isLit;
      toggle(shell, OFFSCREEN_BUBBLE_CLASSES.lit, isLit);
    }
    if (isHold !== shell.isHold) {
      shell.isHold = isHold;
      toggle(shell, OFFSCREEN_BUBBLE_CLASSES.hold, isHold);
    }
  };

  return {
    elements: shells.map((shell) => shell.root),
    setLevel(levelEntries) {
      for (const shell of shells) release(shell);
      entries = levelEntries;
      icons = levelEntries.map((entry) => {
        const { element } = createThreatIconElement(entry, doc);
        // The marker sets the colour on its root; here the icon carries it.
        element.style.setProperty('--pp-threat-color', `var(--pp-color-${entry.color})`);
        return element;
      });
    },
    setDiscRadius(radiusPx) {
      discPx = radiusPx;
    },
    update(slots, targetedId, pressedId = null) {
      // A threat keeps the element it had; the new ones take the free elements, in slot order.
      for (let s = 0; s < OFFSCREEN_BUBBLE_MAX_COUNT; s++) isSlotTaken[s] = false;
      for (const shell of shells) {
        shell.nextSlot = -1;
        if (shell.threatId === -1) continue;
        for (let s = 0; s < slots.length; s++) {
          if ((slots[s] as Readonly<OffscreenSlot>).threatId === shell.threatId) {
            shell.nextSlot = s;
            isSlotTaken[s] = true;
            break;
          }
        }
      }
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s] as Readonly<OffscreenSlot>;
        if (slot.threatId === -1 || isSlotTaken[s]) continue;
        for (const shell of shells) {
          if (shell.nextSlot !== -1) continue;
          shell.nextSlot = s;
          take(shell, slot.threatId);
          break;
        }
      }
      for (const shell of shells) {
        if (shell.nextSlot === -1) {
          if (shell.threatId !== -1) release(shell);
          continue;
        }
        const slot = slots[shell.nextSlot] as Readonly<OffscreenSlot>;
        if (slot.xPx !== shell.xPx) {
          shell.xPx = slot.xPx;
          shell.root.style.left = pxString(slot.xPx);
        }
        if (slot.yPx !== shell.yPx) {
          shell.yPx = slot.yPx;
          shell.root.style.top = pxString(slot.yPx);
        }
        if (slot.angleDeg !== shell.angleDeg) {
          shell.angleDeg = slot.angleDeg;
          shell.root.style.setProperty(
            '--pp-offscreen-angle',
            DEG_STRINGS[slot.angleDeg] as string,
          );
        }
        const isTargeted = slot.threatId === targetedId || slot.threatId === pressedId;
        if (isTargeted !== shell.isTargeted) {
          shell.isTargeted = isTargeted;
          toggle(shell, OFFSCREEN_BUBBLE_CLASSES.targeted, isTargeted);
        }
        drawRing(shell);
        if (!shell.isMounted) {
          options.host.append(shell.root);
          shell.isMounted = true;
        }
      }
    },
    pick(xPx, yPx) {
      let best: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const shell of shells) {
        if (!shell.isMounted) continue;
        const distance = Math.hypot(xPx - shell.xPx, yPx - shell.yPx);
        if (distance <= discPx && distance < bestDistance) {
          best = shell.threatId;
          bestDistance = distance;
        }
      }
      return best;
    },
    hide() {
      for (const shell of shells) release(shell);
    },
  };
}
