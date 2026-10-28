import type { ThreatDef, ThreatIcon } from '@content/schemas/threat';
import { log } from '@shared/log';
import type { ThreatInstance } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { svgElement } from '../svg.ts';

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
   */
  update(
    threats: readonly Readonly<ThreatInstance>[],
    highlightedId: number | null,
    targetedId: number | null,
    papa?: Readonly<{ xM: number; zM: number }> | null,
  ): boolean;
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
  defs: Readonly<Record<string, Pick<ThreatDef, 'icon' | 'target'>>>,
  babyBodyRadiusM: number,
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
    // A threat on Papa has no anchor to look up: its marker starts at him and follows him.
    if (def?.target === 'papa') {
      return {
        threatId: threat.id,
        xM: threat.xM,
        yM: PAPA_HEIGHT_M + PAPA_MARKER_OFFSET_M,
        zM: threat.zM,
        icon,
        followsPapa: true,
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
        icon,
        followsPapa: false,
      };
    }
    const anchor = anchors.find((candidate) => candidate.id === threat.anchorId);
    if (anchor === undefined) {
      log.warn(
        'render',
        `threat ${threat.id} names the anchor ${threat.anchorId}, which the room lacks`,
      );
      return { threatId: threat.id, xM: threat.xM, yM: 0, zM: threat.zM, icon, followsPapa: false };
    }
    const [xM, yM, zM] = anchor.positionM;
    return { threatId: threat.id, xM, yM, zM, icon, followsPapa: false };
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
  // Three dots: the « … » of the suspicious silence (story 1.21).
  dots: 'M6 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0 M12 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0 M18 12m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0',
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
  return {
    object,
    element,
    highlight,
    chevron,
    isShown: false,
    isHighlighted: false,
    isPressed: false,
  };
}

/**
 * The threat icons of a level, world-anchored in the `CSS2DRenderer` layer: a `{colors.parry}`
 * circle with the threat's glyph (`THREAT_ICON_PATHS`) and a pulsing `{colors.alert}` halo while the threat is `telegraph` or
 * `windowOpen`, and the `target-highlight` (a solid ring and a bouncing chevron) on the pressed
 * one and on the auto-targeted one. Reconciled from the world every frame (D8), not from events. `doc` makes the elements
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
    update(threats, highlightedId, targetedId, papa = null) {
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
        // A marker that follows Papa goes where he is drawn (the hit test reads the same entry).
        const entry = mounted[i] as ThreatMarkerEntry;
        if (isActive && entry.followsPapa && papa !== null) {
          entry.xM = papa.xM;
          entry.zM = papa.zM;
          marker.object.position.set(entry.xM, entry.yM, entry.zM);
        }
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
