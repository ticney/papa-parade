import type { ThreatDef, ThreatIcon } from '@content/schemas/threat';
import { log } from '@shared/log';
import type { ThreatInstance } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { svgElement } from '../svg.ts';

/** The icon point of one threat: where its marker stands and where the hit test aims, in metres. */
export interface ThreatMarkerEntry {
  readonly threatId: number;
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
  /** The glyph its marker draws: the threat def's `icon`. */
  readonly icon: ThreatIcon;
}

export interface ThreatMarkers {
  /** One marker per entry, replacing the previous level's. All hidden until `update` shows them. */
  mount(entries: readonly ThreatMarkerEntry[]): void;
  /** Removes the markers of the current level. */
  unmount(): void;
  /**
   * Once per frame: shows the markers of the threats that are `telegraph` or `windowOpen`, hides
   * the others, and highlights the one named `highlightedId`. That one is shown even if the sim
   * already resolved it: a quick tap is judged in the same frame as its press, and the highlight
   * must still be drawn once (the caller forgets `highlightedId` after that frame). `threats[i]` is the instance of
   * `entries[i]` (same order, built from `world.threats`). Writes the DOM only when a value
   * changes and allocates nothing. Returns true when a highlight became visible in this call.
   */
  update(threats: readonly Readonly<ThreatInstance>[], highlightedId: number | null): boolean;
  /** True while at least one marker is shown: the layer must be rendered. */
  readonly isAnyVisible: boolean;
  /** The icon points of the mounted level, for the hit test (the same objects, never copied). */
  readonly entries: readonly ThreatMarkerEntry[];
  dispose(): void;
}

/** The glyph a marker falls back to when the threat's def is unknown. */
const FALLBACK_ICON: ThreatIcon = 'bolt';

/**
 * The marker entries of a level: one per threat of `threats`, in the same order, at the position
 * of its anchor (`anchors` are the level geometry's), with the glyph of its def (`defs` is the
 * level's `LevelContent.threats`). An anchor the geometry lacks, or a def the level lacks, cannot
 * happen (`createSim` refuses both); if it does the icon goes to the threat's floor point, or
 * draws a bolt, with a `warn`. Built once per level, never per frame.
 */
export function threatMarkerEntries(
  threats: readonly Readonly<ThreatInstance>[],
  anchors: readonly { id: string; positionM: readonly [number, number, number] }[],
  defs: Readonly<Record<string, Pick<ThreatDef, 'icon'>>>,
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
    const anchor = anchors.find((candidate) => candidate.id === threat.anchorId);
    if (anchor === undefined) {
      log.warn(
        'render',
        `threat ${threat.id} names the anchor ${threat.anchorId}, which the room lacks`,
      );
      return { threatId: threat.id, xM: threat.xM, yM: 0, zM: threat.zM, icon };
    }
    const [xM, yM, zM] = anchor.positionM;
    return { threatId: threat.id, xM, yM, zM, icon };
  });
}

/** The two classes of a marker the CSS styles; `ui.css` owns their look (sizes by surface). */
export const THREAT_CLASSES = {
  root: 'pp-threat',
  halo: 'pp-threat-halo',
  highlight: 'pp-threat-highlight',
  chevron: 'pp-threat-chevron',
  icon: 'pp-threat-icon',
} as const;

/**
 * The glyph of each `ThreatIcon` (24 × 24 view box), drawn in the paper fill with an ink outline:
 * a `Record`, so that an icon of the schema with no glyph is a type error. `bolt` is the mockup's
 * `i-bolt`. `stairs` is three steps rising to the right; `mug` is a cup with its handle. Provisional
 * placeholders (E7 draws the final ones).
 */
export const THREAT_ICON_PATHS: Readonly<Record<ThreatIcon, string>> = {
  bolt: 'M14 1.5L4.5 14h6.5l-1.5 8.5L19.5 10H13z',
  stairs: 'M2.5 21.5V16h5.5v-5.5h5.5V5h8v16.5z',
  mug: 'M3.5 6.5h13v9.5a4 4 0 0 1-4 4h-5a4 4 0 0 1-4-4z M16.5 9h2.5a3 3 0 0 1 0 6h-2.5v-2.2h2.5a.8.8 0 0 0 0-1.6h-2.5z',
};
/** The chevron: a down-pointing triangle above the icon (12 × 8 view box). */
const CHEVRON_PATH = 'M1 1h10L6 7z';

interface Marker {
  readonly object: CSS2DObject;
  readonly element: HTMLElement;
  readonly highlight: HTMLElement;
  readonly chevron: Element;
  isShown: boolean;
  isHighlighted: boolean;
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
  const icon = doc.createElement('div');
  icon.className = THREAT_CLASSES.icon;
  icon.append(
    svgElement(
      'svg',
      { viewBox: '0 0 24 24' },
      [
        svgElement(
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
        ),
      ],
      doc,
    ),
  );
  element.append(halo, highlight, chevron, icon);
  // Hidden until its threat is active: the CSS2D renderer only writes `display` when it runs.
  element.style.display = 'none';

  const object = new CSS2DObject(element);
  object.position.set(entry.xM, entry.yM, entry.zM);
  object.visible = false;
  return { object, element, highlight, chevron, isShown: false, isHighlighted: false };
}

/**
 * The threat icons of a level, world-anchored in the `CSS2DRenderer` layer: a `{colors.parry}`
 * circle with the threat's glyph (`THREAT_ICON_PATHS`) and a pulsing `{colors.alert}` halo while the threat is `telegraph` or
 * `windowOpen`, and the `target-highlight` (a solid ring and a bouncing chevron) on the pressed
 * one. Reconciled from the world every frame (D8), not from events. `doc` makes the elements
 * (the browser's `document`; a double in tests).
 */
export function createThreatMarkers(scene: Scene, doc: Doc = document): ThreatMarkers {
  let markers: Marker[] = [];
  let mounted: readonly ThreatMarkerEntry[] = [];
  let shownCount = 0;
  // `threats[i]` must be the instance of `entries[i]` (same order, built from `world.threats`): a
  // pair that is not is skipped, and said once per mount.
  let isMisalignedWarned = false;

  const unmount = (): void => {
    for (const marker of markers) scene.remove(marker.object);
    markers = [];
    mounted = [];
    shownCount = 0;
    isMisalignedWarned = false;
  };

  return {
    mount(entries) {
      unmount();
      mounted = entries;
      markers = entries.map((entry) => createMarker(entry, doc));
      for (const marker of markers) scene.add(marker.object);
    },
    unmount,
    update(threats, highlightedId) {
      let isHighlightShown = false;
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
        const isHighlighted = isPressed;
        if (isHighlighted !== marker.isHighlighted) {
          marker.isHighlighted = isHighlighted;
          marker.highlight.hidden = !isHighlighted;
          if (isHighlighted) marker.chevron.removeAttribute('hidden');
          else marker.chevron.setAttribute('hidden', '');
          if (isHighlighted) isHighlightShown = true;
        }
      }
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
