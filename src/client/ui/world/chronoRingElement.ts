import { svgElement } from '../svg.ts';
import {
  CHRONO_DASH_OFFSET_STRINGS,
  CHRONO_FULL_PERMILLE,
  type ChronoRing,
  type ChronoStroke,
  chronoRingRadii,
} from './chronoRing.ts';

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

/** The classes the CSS styles (`ui.css`): the colours are tokens there, the geometry is written here. */
export const CHRONO_RING_CLASSES = {
  root: 'pp-chrono-ring',
  /** The final arc has lit (the window is open): its arc and the arc's outline show. */
  lit: 'pp-chrono-ring--lit',
  /** A held Firmness drains the ring: the lit arc and the notch are not drawn. */
  hold: 'pp-chrono-ring--hold',
  outline: 'pp-chrono-outline',
  track: 'pp-chrono-track',
  arcOutline: 'pp-chrono-arc-outline',
  arc: 'pp-chrono-arc',
  progress: 'pp-chrono-progress',
  notch: 'pp-chrono-notch',
} as const;

/** The ring is not drawn. */
export const CHRONO_HIDDEN = -1;

/** The angle of one per-mille of the ring, in degrees. */
const DEGREES_PER_PERMILLE = 360 / CHRONO_FULL_PERMILLE;

export interface ChronoRingElement {
  /** The element for the marker: absolutely placed over the icon's box, hidden until `draw` shows it. */
  readonly root: HTMLElement;
  /**
   * The icon's size on this surface, in CSS px: the SVG's box and every radius hang from it. Called on mount
   * and when the surface changes (never per frame); a size already written is not written again.
   */
  setSize(sizePx: number): void;
  /**
   * One telegraph's geometry: where the final arc starts and the angle of the notch. The window is frozen at
   * the telegraph, so this is called once per telegraph (and when a fallback start corrects itself).
   */
  setGeometry(ring: Readonly<ChronoRing>): void;
  /**
   * Once per frame: `permille` of the ring that is painted (`CHRONO_HIDDEN` hides it), whether the final arc
   * is lit, whether a held Firmness drains it. Writes the DOM only when one of the three changes.
   */
  draw(permille: number, isLit: boolean, isHold: boolean): void;
}

/**
 * The chrono-ring of one threat marker (story 2.11, D10): one inline SVG, `aria-hidden`, centred on the icon.
 * Back to front: an ink circle (the band's outer outline), the ring-track, the lit arc's ink and the lit arc
 * (both in `{colors.alert}`, shown from `--lit`), the paper progress, and the perfect notch (a short ink tick
 * across the arc). The circles have `pathLength` 1000, so a per-mille is a dash length whatever the radius, and
 * the group is turned −90° so that 0 is 12 o'clock and the fill runs clockwise. The final arc is drawn from
 * the band's inner edge outward and the paper progress is band-thick, so the outer 3 px of the lit arc stay
 * `alert` however full the ring is. It has no animation (a class flip is « lighting up »), so it needs no
 * reduced-motion rule.
 */
export function createChronoRingElement(doc: Doc): ChronoRingElement {
  const root = doc.createElement('div');
  root.className = CHRONO_RING_CLASSES.root;
  root.setAttribute('aria-hidden', 'true');
  root.hidden = true;

  const circle = (className: string): SVGElement =>
    svgElement('circle', { class: className, pathLength: String(CHRONO_FULL_PERMILLE) }, [], doc);
  const outline = circle(CHRONO_RING_CLASSES.outline);
  const track = circle(CHRONO_RING_CLASSES.track);
  const arcOutline = circle(CHRONO_RING_CLASSES.arcOutline);
  const arc = circle(CHRONO_RING_CLASSES.arc);
  const progress = circle(CHRONO_RING_CLASSES.progress);
  progress.setAttribute('stroke-dasharray', `${CHRONO_FULL_PERMILLE} ${CHRONO_FULL_PERMILLE}`);
  const notch = svgElement('line', { class: CHRONO_RING_CLASSES.notch }, [], doc);
  const turned = svgElement('g', {}, [outline, track, arcOutline, arc, progress, notch], doc);
  const svg = svgElement('svg', { overflow: 'visible', focusable: 'false' }, [turned], doc);
  root.append(svg);

  let sizePx = 0;
  let notchDeg = 0;
  let shownPermille = CHRONO_HIDDEN;
  let isLitShown = false;
  let isHoldShown = false;

  const writeCircle = (node: SVGElement, centrePx: number, stroke: ChronoStroke): void => {
    node.setAttribute('cx', String(centrePx));
    node.setAttribute('cy', String(centrePx));
    node.setAttribute('r', String(stroke.radiusPx));
    node.setAttribute('stroke-width', String(stroke.strokePx));
  };
  const writeNotch = (): void => {
    const centrePx = sizePx / 2;
    notch.setAttribute('transform', `rotate(${notchDeg} ${centrePx} ${centrePx})`);
  };

  return {
    root,
    setSize(nextSizePx) {
      if (nextSizePx === sizePx || !(nextSizePx > 0)) return;
      sizePx = nextSizePx;
      const centrePx = sizePx / 2;
      const radii = chronoRingRadii(sizePx);
      svg.setAttribute('viewBox', `0 0 ${sizePx} ${sizePx}`);
      turned.setAttribute('transform', `rotate(-90 ${centrePx} ${centrePx})`);
      writeCircle(outline, centrePx, radii.outline);
      writeCircle(track, centrePx, radii.band);
      writeCircle(arcOutline, centrePx, radii.arcOutline);
      writeCircle(arc, centrePx, radii.arc);
      writeCircle(progress, centrePx, radii.band);
      notch.setAttribute('x1', String(centrePx + radii.notchInnerPx));
      notch.setAttribute('x2', String(centrePx + radii.notchOuterPx));
      notch.setAttribute('y1', String(centrePx));
      notch.setAttribute('y2', String(centrePx));
      notch.setAttribute('stroke-width', String(radii.notchStrokePx));
      writeNotch();
    },
    setGeometry(ring) {
      // The dash shows the arc from `arcFrom` to the end of the path, whatever the radius (pathLength 1000).
      const from = ring.arcFromPermille;
      const dashes = `${CHRONO_FULL_PERMILLE - from} ${from}`;
      const offset = String(-from);
      arc.setAttribute('stroke-dasharray', dashes);
      arc.setAttribute('stroke-dashoffset', offset);
      arcOutline.setAttribute('stroke-dasharray', dashes);
      arcOutline.setAttribute('stroke-dashoffset', offset);
      notchDeg = ring.notchPermille * DEGREES_PER_PERMILLE;
      if (sizePx > 0) writeNotch();
    },
    draw(permille, isLit, isHold) {
      if (permille !== shownPermille) {
        if (permille === CHRONO_HIDDEN) root.hidden = true;
        else {
          if (shownPermille === CHRONO_HIDDEN) root.hidden = false;
          progress.setAttribute(
            'stroke-dashoffset',
            CHRONO_DASH_OFFSET_STRINGS[permille] as string,
          );
        }
        shownPermille = permille;
      }
      if (isLit !== isLitShown) {
        isLitShown = isLit;
        root.classList.toggle(CHRONO_RING_CLASSES.lit, isLit);
      }
      if (isHold !== isHoldShown) {
        isHoldShown = isHold;
        root.classList.toggle(CHRONO_RING_CLASSES.hold, isHold);
      }
    },
  };
}
