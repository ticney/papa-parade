import type {
  ThreatColor,
  ThreatIcon,
  ThreatIconShape,
  ThreatTarget,
} from '@content/schemas/threat';
import {
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  VERB_MAX_WIDTH_PCT,
  VERB_STACK_GAP_PX,
  VERB_STROKE_PX,
} from '@shared/constants';
import { log } from '@shared/log';
import type { ThreatInstance } from '@sim';
import { type Camera, type Scene, Vector3 } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { threatCloseAt } from '../../input/urgency.ts';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';
import { createVerbStack, fitVerbFontPx, stackVerbs, type VerbStack } from './verbLayout.ts';
import { createBrowserVerbMetrics, type VerbMetrics } from './verbMetrics.ts';

/** An icon floats this far above the top of the body it marks (Papa's cube, the baby's), in metres. */
const PAPA_MARKER_OFFSET_M = 0.3;

/**
 * The icon point of one threat: where its marker stands and where the hit test aims, in metres.
 * `xM` and `yM` and `zM` are written only for an entry that `followsPapa` (story 1.19: the
 * micro-sleep stands on him), by `ThreatMarkers.update`, each frame; `hitTest` reads them as they are.
 */
export interface ThreatMarkerEntry {
  readonly threatId: number;
  xM: number;
  readonly yM: number;
  zM: number;
  /** The glyph its marker draws: the threat def's `icon`. */
  readonly icon: ThreatIcon;
  /** The threat stands on Papa (its def's `target` is `papa`): the marker follows his pose. */
  readonly followsPapa: boolean;
  /** The verb shown above the icon, translated once at build (story 2.2); `''` for no verb (an unknown def). */
  readonly verb: string;
  /**
   * What a `firm` threat shows instead of its verb while the baby is carried (« POSE-LE D'ABORD ! »,
   * story 4.1), translated once at build. Absent for a threat that is not a Firmness: its verb never changes.
   */
  readonly carriedVerb?: string;
  /**
   * What a `wait` threat shows from its signal on (« FILE ! », story 4.6): the verb, translated once
   * at build, and the glyph. Both absent for any other threat. The signal is the glyph and the verb,
   * never the colour alone (NFR8).
   */
  readonly signalVerb?: string;
  readonly signalIcon?: ThreatIcon;
  /** The marker's shape and colour, copied from the def (the pair is the signal, NFR8). */
  readonly iconShape: ThreatIconShape;
  readonly color: ThreatColor;
  /**
   * The verb's box as laid out, in CSS px, for the glyph chip: written by `ThreatMarkers.setSize`
   * (width and height, with the outline) and `ThreatMarkers.layout` (how far it is pushed up, 0 when
   * it overlaps nothing). 0 while nothing has been laid out or when there is no verb.
   */
  verbWidthPx: number;
  verbHeightPx: number;
  verbOffsetPx: number;
}

export interface ThreatMarkers {
  /** One marker per entry, replacing the previous level's. All hidden until `update` shows them. */
  mount(entries: readonly ThreatMarkerEntry[]): void;
  /** Removes the markers of the current level. */
  unmount(): void;
  /**
   * Once per frame: shows the markers of the threats that are `telegraph` or `windowOpen`, hides
   * the others, and highlights the one named `highlightedId` (the pressed one) and the one named
   * `targetedId` (the keyboard or gamepad auto-target, or null: touch and mouse show none, story
   * 1.17). `highlightedId` is shown even if the sim
   * already resolved it: a quick tap is judged in the same frame as its press, and the highlight
   * must still be drawn once (the caller forgets `highlightedId` after that frame). `threats[i]` is the instance of
   * `entries[i]` (same order, built from `world.threats`). Writes the DOM only when a value
   * changes and allocates nothing. Returns true when a press began to show in this call (the
   * latency mark): a target ring that appears with no press, or one already up when the press
   * comes, does not make a new mark of its own before that press. `papa` is his pose as drawn
   * (interpolated): the markers that follow him move to it, so their icon point (and the hit test) is
   * where he is drawn; null leaves them where they were.
   *
   * The hold-ring (story 1.23) is drawn from the sim's pending press, in sim time: `renderSimMs` is the
   * sim time as drawn (interpolated by the caller) and `holdMinMs` the feel's fill duration. A ring
   * fills while a press is down, closes when the sim says the press was held that long (`heldAt`), and
   * goes with the press. With `renderSimMs` null no ring is drawn. `isBabyCarried` (story 4.1) makes the
   * marker of a Firmness show `carriedVerb` instead of its verb; the text is rewritten only when it changes.
   */
  update(
    threats: readonly Readonly<ThreatInstance>[],
    highlightedId: number | null,
    targetedId: number | null,
    papa?: Readonly<{ xM: number; zM: number }> | null,
    renderSimMs?: number | null,
    holdMinMs?: number,
    isBabyCarried?: boolean,
  ): boolean;
  /**
   * The layer's size, in CSS px (the verbs' maximum width is a share of it): refits every verb. Called
   * on every resize; a size that is not positive leaves the verbs at their CSS size.
   */
  setSize(widthPx: number, heightPx: number): void;
  /**
   * Fits the verbs again: their font size, from the current surface, `--pp-verb-scale` and the font
   * that is loaded now (a fallback font measures differently). Called when the fonts have loaded and by
   * the « Grands verbes » setting (story 2.10); `layout` also calls it when the surface changes.
   */
  refit(): void;
  /**
   * Once per frame, after `update` and before the DOM renderer: offsets the verbs of the shown markers
   * that would overlap on screen (the most urgent stays, the next ones go up), and puts the most urgent
   * marker in front (`z-index`). Allocates nothing; writes the DOM only when an offset or a rank changes.
   */
  layout(camera: Camera): void;
  /** True while at least one marker is shown: the layer must be rendered. */
  readonly isAnyVisible: boolean;
  /** The icon points of the mounted level, for the hit test (the same objects, never copied). */
  readonly entries: readonly ThreatMarkerEntry[];
  dispose(): void;
}

/** What a marker falls back to when the threat's def is unknown: a bolt, in the parry circle, with no verb. */
const FALLBACK_ICON: ThreatIcon = 'bolt';
const FALLBACK_SHAPE: ThreatIconShape = 'circle';
const FALLBACK_COLOR: ThreatColor = 'parry';

/**
 * The verb a response shows when its def writes `verbKey: null` (« the default of the response », story
 * 2.2 D1): only `dodge` has one, and no def can be a `dodge` before story 5.1.
 */
const DEFAULT_VERB_KEYS: Readonly<Record<string, string>> = { dodge: 'verb.dodge' };

/** The verb of a Firmness while the baby is carried (story 4.1, `EXPERIENCE.md`). */
const CARRIED_FIRM_VERB_KEY = 'verb.put_down_first';

/** The slice of a `ThreatDef` that a marker reads; a `ThreatDef` is one. */
export interface ThreatMarkerDef {
  readonly icon: ThreatIcon;
  readonly target: ThreatTarget;
  readonly verbKey: string | null;
  readonly iconShape: ThreatIconShape;
  readonly color: ThreatColor;
  readonly response: string;
  /** Only on a `wait` threat (story 4.6): the verb and the glyph from the signal on. */
  readonly signalVerbKey?: string | undefined;
  readonly signalIcon?: ThreatIcon | undefined;
}

/**
 * The text of a verb key. A translator gives a missing key back as it is, which must never become
 * the loudest text on screen (« verb.catch » in 40 px letters): it warns and shows no verb.
 */
function translateVerb(verbKey: string, threatId: number, t: Translator): string {
  const text = t(verbKey);
  if (text !== verbKey) return text;
  log.warn('render', `threat ${threatId}: the verb string ${verbKey} is missing, no verb is shown`);
  return '';
}

/**
 * The marker entries of a level: one per threat of `threats`, in the same order, at the position
 * of its anchor (`anchors` are the level geometry's), with the glyph, verb, shape and colour of its
 * def (`defs` is the level's `LevelContent.threats`; the verb is `t(def.verbKey)`, or the default verb
 * of its response for a `null` key). An anchor the geometry lacks, or a def the level lacks, cannot
 * happen (`createSim` refuses both); if it does the icon goes to the threat's floor point, or draws a
 * bolt in a parry circle with no verb, with a `warn`. Built once per level, never per frame.
 */
export function threatMarkerEntries(
  threats: readonly Readonly<ThreatInstance>[],
  anchors: readonly { id: string; positionM: readonly [number, number, number] }[],
  defs: Readonly<Record<string, ThreatMarkerDef>>,
  babyBodyRadiusM: number,
  t: Translator,
): ThreatMarkerEntry[] {
  return threats.map((threat) => {
    const def = defs[threat.defId];
    if (def === undefined) {
      log.warn(
        'render',
        `threat ${threat.id} names the def ${threat.defId}, which the level lacks`,
      );
    }
    const icon = def?.icon ?? FALLBACK_ICON;
    const verbKey =
      def === undefined ? null : (def.verbKey ?? DEFAULT_VERB_KEYS[def.response] ?? null);
    // A Firmness cannot be held with a baby in the arms: its verb says to put him down first (story 4.1).
    const carriedVerb =
      def?.response === 'firm' ? translateVerb(CARRIED_FIRM_VERB_KEY, threat.id, t) : '';
    // A `wait` threat swaps its verb and its glyph at the signal (story 4.6).
    const signalVerb =
      def?.signalVerbKey === undefined ? '' : translateVerb(def.signalVerbKey, threat.id, t);
    const look = {
      icon,
      verb: verbKey === null ? '' : translateVerb(verbKey, threat.id, t),
      ...(carriedVerb === '' ? {} : { carriedVerb }),
      ...(signalVerb === '' ? {} : { signalVerb }),
      ...(def?.signalIcon === undefined ? {} : { signalIcon: def.signalIcon }),
      iconShape: def?.iconShape ?? FALLBACK_SHAPE,
      color: def?.color ?? FALLBACK_COLOR,
      verbWidthPx: 0,
      verbHeightPx: 0,
      verbOffsetPx: 0,
    };
    // A threat on Papa has no anchor to look up: its marker starts at him and follows him.
    if (def?.target === 'papa') {
      return {
        threatId: threat.id,
        xM: threat.xM,
        yM: PAPA_HEIGHT_M + PAPA_MARKER_OFFSET_M,
        zM: threat.zM,
        followsPapa: true,
        ...look,
      };
    }
    // A silence stands on the open cell of its hidden zone, which the sim chose: above the baby
    // (his body is a cube of side twice `feel.baby.bodyRadiusM`).
    if (def?.target === 'hiddenZone') {
      return {
        threatId: threat.id,
        xM: threat.xM,
        yM: babyBodyRadiusM * 2 + PAPA_MARKER_OFFSET_M,
        zM: threat.zM,
        followsPapa: false,
        ...look,
      };
    }
    const anchor = anchors.find((candidate) => candidate.id === threat.anchorId);
    if (anchor === undefined) {
      log.warn(
        'render',
        `threat ${threat.id} names the anchor ${threat.anchorId}, which the room lacks`,
      );
      return {
        threatId: threat.id,
        xM: threat.xM,
        yM: 0,
        zM: threat.zM,
        followsPapa: false,
        ...look,
      };
    }
    const [xM, yM, zM] = anchor.positionM;
    return { threatId: threat.id, xM, yM, zM, followsPapa: false, ...look };
  });
}

/** The two classes of a marker the CSS styles; `ui.css` owns their look (sizes by surface). */
export const THREAT_CLASSES = {
  root: 'pp-threat',
  halo: 'pp-threat-halo',
  highlight: 'pp-threat-highlight',
  chevron: 'pp-threat-chevron',
  /** The verb stack: the chevron over the verb, above the icon (story 2.2). */
  verbStack: 'pp-threat-verb-stack',
  verb: 'pp-threat-verb',
  icon: 'pp-threat-icon',
  /** The icon of a `dodge` threat: a triangle, drawn as an SVG polygon (a CSS `border` cannot follow a `clip-path`). */
  iconTriangle: 'pp-threat-icon--triangle',
  /** The SVG of that triangle. */
  triangle: 'pp-threat-triangle',
  /** The glyph inside the icon, whatever its shape. */
  glyph: 'pp-threat-glyph',
  /** The hold-ring (story 1.23); `--closed` once the press has been held `holdMinMs`. */
  hold: 'pp-threat-hold',
  holdClosed: 'pp-threat-hold--closed',
  /** On the marker of a `wait` threat from its signal on (story 4.6): the CSS draws the cue's onset. */
  signal: 'pp-threat--signal',
} as const;

/** The ring's progress in whole percent, as the strings the CSS variable takes (built once: no per-frame concatenation). */
const HOLD_PROGRESS_PCT: readonly string[] = Array.from({ length: 101 }, (_, pct) => String(pct));

/** Nothing shown: the ring has no press to follow. */
const HOLD_HIDDEN = -1;

/**
 * The glyph of each `ThreatIcon` (24 × 24 view box), drawn in the paper fill with an ink outline:
 * a `Record`, so that an icon of the schema with no glyph is a type error. `bolt` is the mockup's
 * `i-bolt`. `stairs` is three steps rising to the right; `mug` is a cup with its handle; `eyelids` is
 * a closed eye with its lashes (the micro-sleep, story 1.19). Provisional
 * placeholders (E7 draws the final ones).
 */
export const THREAT_ICON_PATHS: Readonly<Record<ThreatIcon, string>> = {
  bolt: 'M14 1.5L4.5 14h6.5l-1.5 8.5L19.5 10H13z',
  stairs: 'M2.5 21.5V16h5.5v-5.5h5.5V5h8v16.5z',
  mug: 'M3.5 6.5h13v9.5a4 4 0 0 1-4 4h-5a4 4 0 0 1-4-4z M16.5 9h2.5a3 3 0 0 1 0 6h-2.5v-2.2h2.5a.8.8 0 0 0 0-1.6h-2.5z',
  eyelids:
    'M2.5 11c3.5 6 15.5 6 19 0c-3.5-3-15.5-3-19 0z M5 15.5L3 19 M9.5 17.3l-.8 3.4 M14.5 17.3l.8 3.4 M19 15.5l2 3.5',
  // A tear drop: the baby crying in Papa's arms (story 4.1).
  cry: 'M12 2.5C12 2.5 5.5 10 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z',
  // An open eye, the pupil in the middle: the baby who is not asleep yet (the bedtime duel, story 4.6).
  eyes: 'M1.5 12C5 6 19 6 22.5 12C19 18 5 18 1.5 12z M12 12m-3.4 0a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0-6.8 0',
  // Three dots: the « … » of the suspicious silence (story 1.21).
  dots: 'M6 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0 M12 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0 M18 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0',
};
/** The chevron: a down-pointing triangle above the verb (12 × 8 view box). */
const CHEVRON_PATH = 'M1 1h10L6 7z';

/** The dodge triangle (mockup `icon-dodge`, 52 × 48 view box): the hard ink shadow is the same polygon 4 units down. */
const TRIANGLE_POINTS = '26,4 49,43 3,43';
const TRIANGLE_SHADOW_DROP = 4;

interface Marker {
  readonly object: CSS2DObject;
  readonly element: HTMLElement;
  readonly highlight: HTMLElement;
  readonly chevron: Element;
  /** The chevron over the verb: the stack the layout pushes up (`--pp-verb-offset`). */
  readonly verbStack: HTMLElement;
  /** The verb's text node holder; null for an entry with no verb. */
  readonly verb: HTMLElement | null;
  /** The verb's font size as drawn, in px; 0 until the first fit. */
  verbFontPx: number;
  /** The verb's text as drawn is the entry's `carriedVerb` (story 4.1), not its `verb`. */
  isCarriedShown: boolean;
  /** The glyph's path: swapped for the entry's `signalIcon` from the signal on (story 4.6). */
  readonly glyphPath: Element;
  /** The signal has come: the verb and the glyph are the entry's `signalVerb` and `signalIcon`. */
  isSignalShown: boolean;
  /** How far the verb stack is pushed up as drawn, in whole px. */
  verbOffsetPx: number;
  /** The window's closing, in sim ms (`Infinity` while there is none): the urgency of the layout. */
  closeAt: number;
  /** The z-index as drawn: a rank counted from the least urgent (0 = not set). */
  zRank: number;
  /** The hold-ring: a disc under the icon whose conic fill is `--pp-hold-progress` percent. */
  readonly hold: HTMLElement;
  /** The ring's progress as drawn, in whole percent; `HOLD_HIDDEN` while it is hidden. */
  holdPct: number;
  isHoldClosed: boolean;
  isShown: boolean;
  isHighlighted: boolean;
  /** The press highlight is up for this marker (the return value of `update` follows its rising edge). */
  isPressed: boolean;
}

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

function createMarker(entry: ThreatMarkerEntry, doc: Doc): Marker {
  const element = doc.createElement('div');
  element.className = THREAT_CLASSES.root;
  element.setAttribute('aria-hidden', 'true');

  const halo = doc.createElement('div');
  halo.className = THREAT_CLASSES.halo;
  const highlight = doc.createElement('div');
  highlight.className = THREAT_CLASSES.highlight;
  highlight.hidden = true;
  const chevron = svgElement(
    'svg',
    { class: THREAT_CLASSES.chevron, viewBox: '0 0 12 8' },
    [
      svgElement(
        'path',
        {
          d: CHEVRON_PATH,
          fill: 'currentcolor',
          stroke: 'var(--pp-color-ink)',
          'stroke-width': '1.5',
          'stroke-linejoin': 'round',
        },
        [],
        doc,
      ),
    ],
    doc,
  );
  chevron.setAttribute('hidden', '');
  const hold = doc.createElement('div');
  hold.className = THREAT_CLASSES.hold;
  hold.hidden = true;
  // DESIGN.md's pixel sizes come from the constants, not from CSS literals (`holdRingSpec.test.ts`):
  // the disc is the band wider than the icon on every side, with the ink outline spread around it.
  hold.style.inset = `-${HOLD_RING_STROKE_PX}px`;
  hold.style.boxShadow = `0 0 0 ${HOLD_RING_OUTLINE_PX}px var(--pp-color-ink)`;
  // The verb stack: the chevron over the verb, bottom-anchored above the icon, so that the verb stays
  // where it is whether the chevron shows or not. The layout pushes the whole stack up.
  const verbStack = doc.createElement('div');
  verbStack.className = THREAT_CLASSES.verbStack;
  let verb: HTMLElement | null = null;
  if (entry.verb !== '') {
    verb = doc.createElement('span');
    verb.className = THREAT_CLASSES.verb;
    verb.textContent = entry.verb;
    // DESIGN.md's outline comes from the constant (`verbLabelSpec.test.ts`): `paint-order: stroke` hides
    // the inner half of a text stroke, so the visible outline is half of the stroke's width.
    verb.style.setProperty('-webkit-text-stroke', `${VERB_STROKE_PX * 2}px var(--pp-color-ink)`);
    verbStack.append(chevron, verb);
  } else {
    verbStack.append(chevron);
  }
  const icon = doc.createElement('div');
  icon.className = THREAT_CLASSES.icon;
  const glyphPath = svgElement(
    'path',
    {
      d: THREAT_ICON_PATHS[entry.icon],
      fill: 'var(--pp-color-paper)',
      stroke: 'var(--pp-color-ink)',
      'stroke-width': '2',
      'stroke-linejoin': 'round',
    },
    [],
    doc,
  );
  const glyph = svgElement(
    'svg',
    { class: THREAT_CLASSES.glyph, viewBox: '0 0 24 24' },
    [glyphPath],
    doc,
  );
  // The colour is the def's, by its DESIGN token name; the circle fills with it in CSS, the triangle below.
  element.style.setProperty('--pp-threat-color', `var(--pp-color-${entry.color})`);
  if (entry.iconShape === 'triangle') {
    icon.className = `${THREAT_CLASSES.icon} ${THREAT_CLASSES.iconTriangle}`;
    const outline = {
      'stroke-linejoin': 'round',
      stroke: 'var(--pp-color-ink)',
      'stroke-width': '3',
    };
    icon.append(
      svgElement(
        'svg',
        { class: THREAT_CLASSES.triangle, viewBox: '0 0 52 48' },
        [
          svgElement(
            'polygon',
            {
              points: TRIANGLE_POINTS,
              fill: 'var(--pp-color-ink)',
              transform: `translate(0,${TRIANGLE_SHADOW_DROP})`,
            },
            [],
            doc,
          ),
          svgElement(
            'polygon',
            { points: TRIANGLE_POINTS, fill: 'var(--pp-threat-color)', ...outline },
            [],
            doc,
          ),
        ],
        doc,
      ),
      glyph,
    );
  } else {
    icon.append(glyph);
  }
  element.append(halo, hold, highlight, verbStack, icon);
  // Hidden until its threat is active: the CSS2D renderer only writes `display` when it runs.
  element.style.display = 'none';

  const object = new CSS2DObject(element);
  object.position.set(entry.xM, entry.yM, entry.zM);
  object.visible = false;
  return {
    object,
    element,
    highlight,
    chevron,
    verbStack,
    verb,
    verbFontPx: 0,
    isCarriedShown: false,
    glyphPath,
    isSignalShown: false,
    verbOffsetPx: 0,
    closeAt: Number.POSITIVE_INFINITY,
    zRank: 0,
    hold,
    holdPct: HOLD_HIDDEN,
    isHoldClosed: false,
    isShown: false,
    isHighlighted: false,
    isPressed: false,
  };
}

/**
 * The hold-ring of one marker, from the sim's pending press (D6): shown while the finger is down,
 * filled over `holdMinMs` of sim time since the press, solid once the sim has set `heldAt`. The DOM is
 * written only when the whole percent, the closed state or the visibility changes; nothing allocates.
 */
function updateHoldRing(
  marker: Marker,
  threat: Readonly<ThreatInstance> | undefined,
  renderSimMs: number | null,
  holdMinMs: number,
): void {
  const press = threat?.press ?? null;
  let pct = HOLD_HIDDEN;
  let isClosed = false;
  if (press !== null && press.releasedAt === null && renderSimMs !== null && holdMinMs > 0) {
    isClosed = press.heldAt !== null;
    const progress = (renderSimMs - press.t) / holdMinMs;
    pct = isClosed ? 100 : Math.min(99, Math.max(0, Math.floor(progress * 100)));
  }
  if (pct !== marker.holdPct) {
    if (pct === HOLD_HIDDEN) marker.hold.hidden = true;
    else {
      if (marker.holdPct === HOLD_HIDDEN) marker.hold.hidden = false;
      marker.hold.style.setProperty('--pp-hold-progress', HOLD_PROGRESS_PCT[pct] as string);
    }
    marker.holdPct = pct;
  }
  if (isClosed !== marker.isHoldClosed) {
    marker.isHoldClosed = isClosed;
    marker.hold.classList.toggle(THREAT_CLASSES.holdClosed, isClosed);
  }
}

/**
 * The threat icons of a level, world-anchored in the `CSS2DRenderer` layer: a `{colors.parry}`
 * circle with the threat's glyph (`THREAT_ICON_PATHS`) and a pulsing `{colors.alert}` halo while the threat is `telegraph` or
 * `windowOpen`, and the `target-highlight` (a solid ring and a bouncing chevron) on the pressed
 * one and on the auto-targeted one. Reconciled from the world every frame (D8), not from events. A `dodge`
 * def is a `{colors.dodge}` triangle instead. The verb (story 2.2) is part of the marker, above the icon:
 * it shows and hides with it, fits `VERB_MAX_WIDTH_PCT` of the layer (`refit`), and is pushed up when verbs
 * overlap (`layout`). `doc` makes the elements (the browser's `document`; a double in tests); `metrics` reads the typography
 * the fit needs (default: the page's, read lazily).
 */
export function createThreatMarkers(
  scene: Scene,
  doc: Doc = document,
  metrics?: VerbMetrics,
): ThreatMarkers {
  let markers: Marker[] = [];
  let mounted: readonly ThreatMarkerEntry[] = [];
  let shownCount = 0;
  let layerWidthPx = 0;
  let layerHeightPx = 0;
  /** The surface the verbs were last fitted for: a change makes `layout` refit. */
  let fittedSurface = '';
  // One Vector3 and arrays sized at mount: the per-frame layout allocates nothing.
  const projected = new Vector3();
  let stack: VerbStack = createVerbStack(0);
  let stackSource = new Int32Array(0);
  let zStrings: readonly string[] = [];
  /** Some marker of the level has a verb: only then is the page's typography read at all. */
  let hasVerbs = false;
  let fontMetrics = metrics;
  const getMetrics = (): VerbMetrics => {
    fontMetrics ??= createBrowserVerbMetrics();
    return fontMetrics;
  };
  // `threats[i]` must be the instance of `entries[i]` (same order, built from `world.threats`): a
  // pair that is not is skipped, and said once per mount.
  let isMisalignedWarned = false;

  const unmount = (): void => {
    for (const marker of markers) scene.remove(marker.object);
    markers = [];
    mounted = [];
    shownCount = 0;
    isMisalignedWarned = false;
    stack = createVerbStack(0);
    stackSource = new Int32Array(0);
    zStrings = [];
    hasVerbs = false;
  };

  const refit = (): void => {
    // Nothing to fit against before the first size: the CSS size shows until `setSize`.
    if (layerWidthPx <= 0 || !hasVerbs) return;
    const typography = getMetrics();
    fittedSurface = typography.surfaceKey();
    const basePx = typography.basePx();
    const scale = typography.scale();
    const scaledBasePx = basePx * scale;
    const maxWidthPx = (layerWidthPx * VERB_MAX_WIDTH_PCT) / 100;
    const lineHeight = typography.lineHeight();
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i] as Marker;
      const entry = mounted[i] as ThreatMarkerEntry;
      if (marker.verb === null) continue;
      // The text as drawn now: a Firmness fits « POSE-LE D'ABORD ! » while the baby is carried, a wait
      // « FILE ! » from its signal on.
      let text = marker.isCarriedShown ? (entry.carriedVerb ?? entry.verb) : entry.verb;
      if (marker.isSignalShown) text = entry.signalVerb ?? text;
      const advancePx = typography.widthPx(text.toUpperCase(), scaledBasePx);
      // The outline adds `VERB_STROKE_PX` on each side and does not shrink with the font: fit the text
      // into what is left of the maximum, so that the box with its outline is at most the maximum.
      const fontPx = fitVerbFontPx(advancePx, basePx, maxWidthPx - 2 * VERB_STROKE_PX, scale);
      if (fontPx !== marker.verbFontPx) {
        marker.verbFontPx = fontPx;
        marker.verb.style.fontSize = `${fontPx}px`;
      }
      entry.verbWidthPx = (advancePx * fontPx) / scaledBasePx + 2 * VERB_STROKE_PX;
      entry.verbHeightPx = fontPx * lineHeight + 2 * VERB_STROKE_PX;
    }
  };

  return {
    mount(entries) {
      unmount();
      mounted = entries;
      markers = entries.map((entry) => createMarker(entry, doc));
      for (const marker of markers) scene.add(marker.object);
      stack = createVerbStack(markers.length);
      stackSource = new Int32Array(markers.length);
      zStrings = Array.from({ length: markers.length + 1 }, (_, rank) => String(rank));
      hasVerbs = markers.some((marker) => marker.verb !== null);
      refit();
    },
    unmount,
    setSize(widthPx, heightPx) {
      layerWidthPx = widthPx;
      layerHeightPx = heightPx;
      refit();
    },
    refit,
    layout(camera) {
      if (shownCount === 0 || layerWidthPx <= 0 || layerHeightPx <= 0) return;
      // A surface change (a resize across `COMPACT_SURFACE_MAX_PX`) changes the verb's base size.
      if (hasVerbs && getMetrics().surfaceKey() !== fittedSurface) refit();
      camera.updateMatrixWorld();
      let count = 0;
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i] as Marker;
        if (!marker.isShown) continue;
        const entry = mounted[i] as ThreatMarkerEntry;
        projected.set(entry.xM, entry.yM, entry.zM).project(camera);
        stack.centerXPx[count] = (projected.x * 0.5 + 0.5) * layerWidthPx;
        stack.bottomPx[count] = (-projected.y * 0.5 + 0.5) * layerHeightPx;
        stack.widthPx[count] = entry.verbWidthPx;
        stack.heightPx[count] = entry.verbHeightPx;
        stack.closeAt[count] = marker.closeAt;
        stack.ids[count] = entry.threatId;
        stackSource[count] = i;
        count++;
      }
      stackVerbs(stack, count, VERB_STACK_GAP_PX);
      for (let k = 0; k < count; k++) {
        const marker = markers[stackSource[k] as number] as Marker;
        const entry = mounted[stackSource[k] as number] as ThreatMarkerEntry;
        const offsetPx = stack.offsetPx[k] as number;
        if (offsetPx !== marker.verbOffsetPx) {
          marker.verbOffsetPx = offsetPx;
          entry.verbOffsetPx = offsetPx;
          marker.verbStack.style.setProperty('--pp-verb-offset', `${offsetPx}px`);
        }
        // The most urgent in front: rank 0 gets the highest z-index. Counted over the shown markers, so
        // the ranks stay small and the chip (`.pp-glyph-chip-anchor`, a fixed higher z-index) is above all.
        const zRank = count - (stack.rank[k] as number);
        if (zRank !== marker.zRank) {
          marker.zRank = zRank;
          marker.element.style.zIndex = zStrings[zRank] as string;
        }
      }
    },
    update(
      threats,
      highlightedId,
      targetedId,
      papa = null,
      renderSimMs = null,
      holdMinMs = 0,
      isBabyCarried = false,
    ) {
      let isHighlightShown = false;
      let isVerbSwapped = false;
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i] as Marker;
        const candidate = threats[i];
        // A pair that does not match is no threat of this marker (never the wrong icon).
        const threat =
          candidate !== undefined && candidate.id === (mounted[i] as ThreatMarkerEntry).threatId
            ? candidate
            : undefined;
        if (threat === undefined && !isMisalignedWarned) {
          isMisalignedWarned = true;
          log.warn(
            'render',
            'threat markers are not aligned with the world threats: marker skipped',
            {
              index: i,
            },
          );
        }
        marker.closeAt =
          (threat === undefined ? null : threatCloseAt(threat)) ?? Number.POSITIVE_INFINITY;
        const isPressed = threat !== undefined && threat.id === highlightedId;
        const isActive =
          threat !== undefined &&
          (isPressed || threat.state === 'telegraph' || threat.state === 'windowOpen');
        if (isActive !== marker.isShown) {
          marker.isShown = isActive;
          marker.object.visible = isActive;
          // The renderer writes `display` only when it runs, and it is skipped once nothing shows.
          if (!isActive) marker.element.style.display = 'none';
          shownCount += isActive ? 1 : -1;
        }
        // A marker that follows Papa goes where he is drawn (the hit test reads the same entry).
        const entry = mounted[i] as ThreatMarkerEntry;
        // A Firmness says to put the baby down first while he is carried (story 4.1): the text is
        // written only when it changes, and the fit is made again for the other string.
        if (marker.verb !== null && entry.carriedVerb !== undefined) {
          if (isBabyCarried !== marker.isCarriedShown) {
            marker.isCarriedShown = isBabyCarried;
            marker.verb.textContent = isBabyCarried ? entry.carriedVerb : entry.verb;
            isVerbSwapped = true;
          }
        }
        // A wait threat swaps its verb and its glyph, and toggles a class, at the signal (story 4.6):
        // `windowOpen` is the signal, and the swap stays while the marker is up (a quick tap is drawn
        // once more after the sim resolved it) until the next telegraph or the marker goes.
        if (entry.signalIcon !== undefined || entry.signalVerb !== undefined) {
          let isSignal = marker.isSignalShown;
          if (threat?.state === 'windowOpen') isSignal = true;
          else if (!isActive || threat?.state === 'telegraph') isSignal = false;
          if (isSignal !== marker.isSignalShown) {
            marker.isSignalShown = isSignal;
            marker.glyphPath.setAttribute(
              'd',
              THREAT_ICON_PATHS[isSignal ? (entry.signalIcon ?? entry.icon) : entry.icon],
            );
            if (marker.verb !== null && entry.signalVerb !== undefined) {
              const normal = marker.isCarriedShown ? (entry.carriedVerb ?? entry.verb) : entry.verb;
              marker.verb.textContent = isSignal ? entry.signalVerb : normal;
              isVerbSwapped = true;
            }
            marker.element.classList.toggle(THREAT_CLASSES.signal, isSignal);
          }
        }
        if (isActive && entry.followsPapa && papa !== null) {
          entry.xM = papa.xM;
          entry.zM = papa.zM;
          marker.object.position.set(entry.xM, entry.yM, entry.zM);
        }
        updateHoldRing(marker, threat, renderSimMs, holdMinMs);
        const isHighlighted = isPressed || (threat !== undefined && threat.id === targetedId);
        if (isHighlighted !== marker.isHighlighted) {
          marker.isHighlighted = isHighlighted;
          marker.highlight.hidden = !isHighlighted;
          if (isHighlighted) marker.chevron.removeAttribute('hidden');
          else marker.chevron.setAttribute('hidden', '');
        }
        // The return value is the press-to-highlight latency mark: a press, not a target ring that
        // was already up before it.
        if (isPressed !== marker.isPressed) {
          marker.isPressed = isPressed;
          if (isPressed) isHighlightShown = true;
        }
      }
      // After the loop: every swapped text is fitted at once, not once per marker.
      if (isVerbSwapped) refit();
      return isHighlightShown;
    },
    get isAnyVisible() {
      return shownCount > 0;
    },
    get entries() {
      return mounted;
    },
    dispose: unmount,
  };
}
