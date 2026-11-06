import {
  ACTIVITY_BUBBLE_BORDER_PX,
  ACTIVITY_BUBBLE_COMPACT_PX,
  ACTIVITY_BUBBLE_GAP_PX,
  ACTIVITY_BUBBLE_POP_MS,
  ACTIVITY_BUBBLE_POP_SCALE_TO,
  ACTIVITY_BUBBLE_REDUCED_BORDER_PX,
  ACTIVITY_BUBBLE_REFUSED_SHAKE_MS,
  ACTIVITY_BUBBLE_REGULAR_PX,
  ACTIVITY_BUBBLE_SQUASH_MS,
  ACTIVITY_BUBBLE_SQUASH_SCALE_FROM,
  COMBO_BADGE_HALF_WIDTH_PX,
  COMBO_BADGE_OFFSET_M,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  THREAT_ICON_COMPACT_PX,
  THREAT_ICON_REGULAR_PX,
} from '@shared/constants';
import { log } from '@shared/log';
import { isPapaBusy, type PapaState } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { svgElement } from '../svg.ts';
import { CHRONO_RING_REACH_PX, chronoDrainPermille } from './chronoRing.ts';
import { OBJECT_ICON_PATHS } from './objectMarkers.ts';
import { THREAT_ICON_PATHS } from './threatMarkers.ts';

/** What the bubble's pictogram draws: a cup, a handset, a door, dizzy stars, a hand, a saucepan (a chore). */
export type ActivityPictogram = 'cup' | 'handset' | 'door' | 'stars' | 'hand' | 'pan';

/** A path that may be missing: an empty pictogram is never silent (project rule: every fallback logs a `warn`). */
export function pictogramPathOrWarn(path: string | null, name: string): string {
  if (path !== null) return path;
  log.warn('render', 'an activity pictogram has no icon path: its bubble draws nothing', { name });
  return '';
}

/**
 * The pictogram of each Papa state, `null` for a state that is neither busy nor a chore. Typed on `PapaState`,
 * so a new state (3.15's after-effects, 9.4's chores) cannot compile without choosing one;
 * `activityBubble.test.ts` checks it against `isPapaBusy`. `chore` (story 9.4) is the one state that is not busy
 * and shows a bubble: Papa works at a station, and the ring fills with the chore's progress instead of draining.
 * Its pictogram is the stove's saucepan; the dishwasher (9.6) will resolve it by station.
 */
export const ACTIVITY_PICTOGRAMS: Readonly<Record<PapaState, ActivityPictogram | null>> = {
  idle: null,
  walkPath: null,
  walkDir: null,
  glide: null,
  drink: 'cup',
  onPhone: 'handset',
  onToilet: 'door',
  asleep: 'stars',
  electrified: 'stars',
  carryingUp: 'stars',
  pickingUp: 'hand',
  chore: 'pan',
};

/**
 * The single ink path of each pictogram, in a 24 × 24 box, in the style of the icons beside them: the cup
 * and the door are the coffee machine's and the toilet's, the handset and the stars are new. Provisional
 * placeholders (E7 draws the final ones).
 */
export const ACTIVITY_PICTOGRAM_PATHS: Readonly<Record<ActivityPictogram, string>> = {
  cup: THREAT_ICON_PATHS.mug,
  // A handset: the earpiece and the mouthpiece joined by a curved grip.
  handset:
    'M3.5 7.5c0-1.6 1.3-3 3-3h2.2v4.6H7c.9 2.6 3.7 5.4 6.4 6.4v-1.7H18v2.2c0 1.7-1.4 3-3 3C8.6 19 3.5 13.9 3.5 7.5z',
  door: pictogramPathOrWarn(OBJECT_ICON_PATHS.toilet, 'door'),
  // The hand that picks a debris up (story 3.15): the open hand of the threats' glyphs.
  hand: THREAT_ICON_PATHS.open_hand,
  // The stove's saucepan (story 9.4): the station's own glyph.
  pan: pictogramPathOrWarn(OBJECT_ICON_PATHS.stove, 'pan'),
  // Three five-pointed stars: one up, two lower, the dizziness of a nap that was not chosen.
  stars:
    'M12.0 1.9 L13.2 4.9 L16.4 5.1 L13.9 7.1 L14.7 10.2 L12.0 8.5 L9.3 10.2 L10.1 7.1 L7.6 5.1 L10.8 4.9z M5.5 12.3 L6.6 15.0 L9.5 15.2 L7.2 17.1 L8.0 19.9 L5.5 18.3 L3.0 19.9 L3.8 17.1 L1.5 15.2 L4.4 15.0z M18.5 12.3 L19.6 15.0 L22.5 15.2 L20.2 17.1 L21.0 19.9 L18.5 18.3 L16.0 19.9 L16.8 17.1 L14.5 15.2 L17.4 15.0z',
};

/** The two surfaces the bubble is sized for. */
export type ActivitySurface = 'compact' | 'regular';

/** The distances of the bubble and its neighbours on one surface, in CSS px from Papa's anchor (the centre column). */
export interface ActivityMetrics {
  /** The bubble's diameter, border included. */
  readonly sizePx: number;
  /** From its centre to the ring's outermost ink: the disc's radius, the band and the ink outline. */
  readonly reachPx: number;
  /** The combo badge's centre when it sits to the bubble's right: the ring, a gap and half the badge. */
  readonly besideBadgePx: number;
  /** The bubble's centre, to the left, while a threat that follows Papa is up: clear of the threat's chrono-ring. */
  readonly asideBubblePx: number;
  /** The combo badge's centre, to the right of that threat (it keeps the same side whether the bubble shows or not). */
  readonly asideBadgePx: number;
}

/** The distances for a bubble of `sizePx` next to a threat icon of `threatSizePx`. */
export function activityMetricsFor(sizePx: number, threatSizePx: number): ActivityMetrics {
  const reachPx = sizePx / 2 + HOLD_RING_STROKE_PX + HOLD_RING_OUTLINE_PX;
  const threatReachPx = threatSizePx / 2 + CHRONO_RING_REACH_PX;
  return {
    sizePx,
    reachPx,
    besideBadgePx: reachPx + ACTIVITY_BUBBLE_GAP_PX + COMBO_BADGE_HALF_WIDTH_PX,
    asideBubblePx: threatReachPx + ACTIVITY_BUBBLE_GAP_PX + reachPx,
    asideBadgePx: threatReachPx + ACTIVITY_BUBBLE_GAP_PX + COMBO_BADGE_HALF_WIDTH_PX,
  };
}

/** The metrics of each surface, from the constants. */
export const ACTIVITY_METRICS: Readonly<Record<ActivitySurface, ActivityMetrics>> = {
  compact: activityMetricsFor(ACTIVITY_BUBBLE_COMPACT_PX, THREAT_ICON_COMPACT_PX),
  regular: activityMetricsFor(ACTIVITY_BUBBLE_REGULAR_PX, THREAT_ICON_REGULAR_PX),
};

/**
 * Writes the custom properties `ui.css` sizes and places the bubble, and moves the combo badge, from: no pixel
 * size of the bubble lives in a CSS literal (`activityBubbleSpec.test.ts` pins the constants to DESIGN.md).
 * Written once on the page root, per surface, because `ui.css` picks the surface's value by `data-pp-surface`.
 */
export function applyActivityBubbleMetrics(root: { readonly style: CSSStyleDeclaration }): void {
  for (const surface of ['compact', 'regular'] as const) {
    const metrics = ACTIVITY_METRICS[surface];
    root.style.setProperty(`--pp-activity-size-${surface}`, `${metrics.sizePx}px`);
    root.style.setProperty(`--pp-activity-reach-${surface}`, `${metrics.reachPx}px`);
    root.style.setProperty(`--pp-activity-beside-offset-${surface}`, `${metrics.besideBadgePx}px`);
    root.style.setProperty(`--pp-activity-aside-offset-${surface}`, `${metrics.asideBubblePx}px`);
    root.style.setProperty(
      `--pp-activity-badge-aside-offset-${surface}`,
      `${metrics.asideBadgePx}px`,
    );
  }
}

/** The part of the world's Papa the bubble reads: the state, where it started and ends, and where he stands. */
export interface ActivityPapa {
  readonly state: PapaState;
  readonly enteredAt: number;
  readonly busyUntil: number;
  readonly xM: number;
  readonly zM: number;
}

export interface ActivityBubbleOptions {
  /** Reduced motion (story 2.10): no squash, no pop, a thicker border instead of the shake. Read when each starts. */
  readonly isMotionReduced: () => boolean;
  /** The table to draw from (the real one by default: a test passes another to prove the unknown-state warning). */
  readonly pictograms?: Readonly<Record<PapaState, ActivityPictogram | null>>;
}

export interface ActivityBubble {
  /** True while the bubble is in the layer, popping out included (`worldUi.render` draws on this). */
  readonly isVisible: boolean;
  /** True while Papa is busy and the bubble shows it: false when hidden or popping out. */
  readonly isActive: boolean;
  /** True from a refused tap until its 150 ms are over (the shake class, or the thicker border under reduced motion). */
  readonly isShaking: boolean;
  /** The pictogram drawn, or null when hidden. */
  readonly pictogram: ActivityPictogram | null;
  /** The whole percent of the ring that is paper (`--pp-activity-progress`), or -1 when hidden. */
  readonly progressPct: number;
  /**
   * Once per frame, before `worldUi.render`, from the world's Papa (never from the pose: he is hidden on the
   * toilet), the sim time as drawn, and whether a threat that follows Papa is up. Shows the bubble with a
   * squash on the frame Papa is busy, swaps the pictogram on a busy → busy change, pops it out on a busy →
   * free one, and drains the ring from `enteredAt` to `busyUntil` in **sim time**: a slow-mo slows it, a
   * hitstop and the pause freeze it. `nowAtReal` ends a shake. The DOM is written only on change. In a chore
   * (story 9.4, `choreProgressPct` from 0 to 100, beats done over beats) the ring **fills** with that progress
   * instead: there is no `busyUntil` to drain to, Papa can leave at any moment.
   */
  update(
    papa: Readonly<ActivityPapa> | null,
    renderSimMs: number,
    isAside: boolean,
    nowAtReal: number,
    choreProgressPct?: number,
  ): void;
  /** A tap on a threat was refused: shakes the bubble (restarts a running shake), or thickens its border under reduced motion. */
  shake(nowAtReal: number): void;
  /** Hides the bubble and forgets what it showed, with no pop (a restart, a level end, a new level). */
  hide(): void;
  dispose(): void;
}

/** Nothing shown: the ring is hidden. */
const HIDDEN = -1;

/** The ring's whole percent, as the strings the CSS variable takes (built once: no per-frame concatenation). */
const PROGRESS_PCT: readonly string[] = Array.from({ length: 101 }, (_, pct) => String(pct));

const SQUASH_KEYFRAMES: Keyframe[] = [
  { transform: `scale(${ACTIVITY_BUBBLE_SQUASH_SCALE_FROM})` },
  { transform: 'scale(1)' },
];
const POP_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1)', opacity: 1 },
  { transform: `scale(${ACTIVITY_BUBBLE_POP_SCALE_TO})`, opacity: 0 },
];

/** The classes the CSS styles (`ui.css` owns the look). */
export const ACTIVITY_BUBBLE_CLASSES = {
  root: 'pp-activity-bubble',
  pop: 'pp-activity-pop',
  aside: 'pp-activity-bubble--aside',
  body: 'pp-activity-body',
  refused: 'pp-activity-body--refused',
  thick: 'pp-activity-body--thick',
} as const;

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

/**
 * The activity bubble (story 2.12; DESIGN.md › activity-bubble, UX-DR28): a paper disc with an ink border and
 * a pictogram, above Papa at the combo badge's height, for as long as he is busy (`isPapaBusy`), with the
 * hold-ring's visual around it draining to `busyUntil`. One pooled `CSS2DObject`, like the combo badge: the
 * outer element is placed by the `CSS2DRenderer` (it writes its `transform`; the aside step is `translate`),
 * the `pop` inside it is the one the Web Animations API squashes and pops, and the shake is a class on the
 * `body` inside that: the two never animate the same `transform`, so a refusal during a squash still shows. It is
 * `aria-hidden` and takes no tap. The ring is gameplay information (sim time, never a timer or a transition);
 * the squash, the pop and the shake are juice (real time).
 */
export function createActivityBubble(
  scene: Scene,
  doc: Doc,
  { isMotionReduced, pictograms = ACTIVITY_PICTOGRAMS }: ActivityBubbleOptions,
): ActivityBubble {
  const element = doc.createElement('div');
  element.className = ACTIVITY_BUBBLE_CLASSES.root;
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'none';
  // The widths are DESIGN's, written from the constants over the 0px placeholders `ui.css` declares.
  element.style.setProperty('--pp-activity-border', `${ACTIVITY_BUBBLE_BORDER_PX}px`);
  element.style.setProperty(
    '--pp-activity-border-reduced',
    `${ACTIVITY_BUBBLE_REDUCED_BORDER_PX}px`,
  );
  element.style.setProperty('--pp-activity-stroke', `${HOLD_RING_STROKE_PX}px`);
  element.style.setProperty('--pp-activity-outline', `${HOLD_RING_OUTLINE_PX}px`);
  element.style.setProperty('--pp-activity-shake-ms', `${ACTIVITY_BUBBLE_REFUSED_SHAKE_MS}ms`);

  const pop = doc.createElement('div');
  pop.className = ACTIVITY_BUBBLE_CLASSES.pop;
  const body = doc.createElement('div');
  body.className = ACTIVITY_BUBBLE_CLASSES.body;
  const ringOutline = doc.createElement('div');
  ringOutline.className = 'pp-activity-ring-outline';
  const ringBand = doc.createElement('div');
  ringBand.className = 'pp-activity-ring-band';
  const disc = doc.createElement('div');
  disc.className = 'pp-activity-disc';
  const pictogramPath = svgElement(
    'path',
    { d: '', fill: 'var(--pp-color-ink)', 'fill-rule': 'nonzero' },
    [],
    doc,
  );
  const pictogramSvg = svgElement(
    'svg',
    { class: 'pp-activity-pictogram', viewBox: '0 0 24 24' },
    [pictogramPath],
    doc,
  );
  disc.append(pictogramSvg);
  // The tail points down to Papa: two ink sides over a paper fill, open at the top where the disc covers it.
  const tail = svgElement(
    'svg',
    { class: 'pp-activity-tail', viewBox: '0 0 20 12' },
    [
      svgElement(
        'path',
        {
          d: 'M1.5 0L10 10.5L18.5 0',
          fill: 'var(--pp-color-paper)',
          stroke: 'var(--pp-color-ink)',
          'stroke-width': String(ACTIVITY_BUBBLE_BORDER_PX),
          'stroke-linejoin': 'round',
        },
        [],
        doc,
      ),
    ],
    doc,
  );
  body.append(ringOutline, ringBand, tail, disc);
  pop.append(body);
  element.append(pop);

  const object = new CSS2DObject(element);
  object.visible = false;
  object.position.set(0, PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M, 0);
  scene.add(object);

  let shownPictogram: ActivityPictogram | null = null;
  // The pictogram whose class is on the element: it outlives `shownPictogram` for the length of a pop.
  let classedPictogram: ActivityPictogram | null = null;
  let isActive = false;
  let isAsideShown = false;
  let shownPct = HIDDEN;
  let shakeUntilAtReal: number | null = null;
  let enter: Animation | null = null;
  let isUnknownWarned = false;

  const setVisible = (isVisible: boolean): void => {
    if (isVisible === object.visible) return;
    object.visible = isVisible;
    element.style.display = isVisible ? '' : 'none';
  };
  const setAside = (isAside: boolean): void => {
    if (isAside === isAsideShown) return;
    isAsideShown = isAside;
    element.classList.toggle(ACTIVITY_BUBBLE_CLASSES.aside, isAside);
  };
  const clearShake = (): void => {
    shakeUntilAtReal = null;
    body.classList.remove(ACTIVITY_BUBBLE_CLASSES.refused, ACTIVITY_BUBBLE_CLASSES.thick);
  };
  const play = (keyframes: Keyframe[], durationMs: number, fill: FillMode): Animation => {
    enter?.cancel();
    const animation = pop.animate(keyframes, { duration: durationMs, easing: 'ease-out', fill });
    enter = animation;
    return animation;
  };
  const setPictogram = (next: ActivityPictogram): void => {
    if (next === shownPictogram) return;
    shownPictogram = next;
    // Busy again during a pop with the same pictogram: the path and the class are still right.
    if (next === classedPictogram) return;
    if (classedPictogram !== null)
      element.classList.remove(`pp-activity-bubble--${classedPictogram}`);
    classedPictogram = next;
    pictogramPath.setAttribute('d', ACTIVITY_PICTOGRAM_PATHS[next]);
    element.classList.add(`pp-activity-bubble--${next}`);
  };
  const forget = (): void => {
    // Called every frame while no level is live: nothing shown, nothing written.
    if (
      !object.visible &&
      !isActive &&
      enter === null &&
      shakeUntilAtReal === null &&
      classedPictogram === null
    ) {
      return;
    }
    enter?.cancel();
    enter = null;
    clearShake();
    setAside(false);
    setVisible(false);
    isActive = false;
    if (classedPictogram !== null)
      element.classList.remove(`pp-activity-bubble--${classedPictogram}`);
    classedPictogram = null;
    shownPictogram = null;
    shownPct = HIDDEN;
  };

  return {
    get isVisible() {
      return object.visible;
    },
    get isActive() {
      return isActive;
    },
    get isShaking() {
      return shakeUntilAtReal !== null;
    },
    get pictogram() {
      return shownPictogram;
    },
    get progressPct() {
      return shownPct;
    },
    update(papa, renderSimMs, isAside, nowAtReal, choreProgressPct = HIDDEN) {
      if (shakeUntilAtReal !== null && nowAtReal >= shakeUntilAtReal) clearShake();
      const next = papa === null ? null : (pictograms[papa.state] ?? null);
      if (papa !== null && next === null && isPapaBusy(papa) && !isUnknownWarned) {
        isUnknownWarned = true;
        log.warn('render', 'a busy Papa state has no activity pictogram: no bubble is drawn', {
          state: papa.state,
        });
      }
      if (papa === null || next === null) {
        if (isActive) {
          // Busy → free: the bubble pops out, then goes (under reduced motion it just goes).
          isActive = false;
          shownPictogram = null;
          shownPct = HIDDEN;
          clearShake();
          if (isMotionReduced()) {
            forget();
          } else {
            const pop = play(POP_KEYFRAMES, ACTIVITY_BUBBLE_POP_MS, 'forwards');
            pop.onfinish = () => {
              if (enter === pop && !isActive) forget();
            };
          }
        }
        return;
      }
      const isStart = !isActive;
      const isSwap = isActive && next !== shownPictogram;
      isActive = true;
      setVisible(true);
      setPictogram(next);
      setAside(isAside);
      object.position.x = papa.xM;
      object.position.z = papa.zM;
      if (isStart || isSwap) {
        // A new busy state replaces a pop still running, or another busy state: squash in again.
        if (isMotionReduced()) {
          enter?.cancel();
          enter = null;
        } else {
          play(SQUASH_KEYFRAMES, ACTIVITY_BUBBLE_SQUASH_MS, 'none');
        }
      }
      // A chore has no `busyUntil` to drain to: its ring fills with the progress, and reads empty when the
      // caller gives none.
      const pct =
        papa.state === 'chore'
          ? Math.min(100, Math.max(0, Math.floor(choreProgressPct)))
          : Math.min(
              100,
              Math.floor(chronoDrainPermille(papa.enteredAt, papa.busyUntil, renderSimMs) / 10),
            );
      if (pct !== shownPct) {
        shownPct = pct;
        element.style.setProperty('--pp-activity-progress', PROGRESS_PCT[pct] as string);
      }
    },
    shake(nowAtReal) {
      if (!isActive) return;
      // A second refused tap during a shake restarts it: the class comes off, the layout is read, and it goes on again.
      clearShake();
      void (body as { offsetWidth?: number }).offsetWidth;
      const refusedClass = isMotionReduced()
        ? ACTIVITY_BUBBLE_CLASSES.thick
        : ACTIVITY_BUBBLE_CLASSES.refused;
      body.classList.add(refusedClass);
      shakeUntilAtReal = nowAtReal + ACTIVITY_BUBBLE_REFUSED_SHAKE_MS;
    },
    hide: forget,
    dispose() {
      forget();
      scene.remove(object);
    },
  };
}
