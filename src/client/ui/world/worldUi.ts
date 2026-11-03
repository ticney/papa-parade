import type { BeatEntry, ComboSlice, StealthSlice, ThreatInstance, World } from '@sim';
import type { Camera, Scene } from 'three';
import { Scene as ThreeScene } from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { type ActivityBubble, type ActivityPapa, createActivityBubble } from './activityBubble.ts';
import { type BeatRing, createBeatRing } from './beatRing.ts';
import { type BreathRing, createBreathRing } from './breathRing.ts';
import type { ChronoRing } from './chronoRing.ts';
import { type ComboBadge, type ComboBadgeOptions, createComboBadge } from './comboBadge.ts';
import { createGlyphChip, type GlyphChip } from './glyphChip.ts';
import { createObjectMarkers, type ObjectMarkerSpec } from './objectMarkers.ts';
import { createPapaHint, type PapaHint } from './papaHint.ts';
import { createStealthExitMarker, type StealthExitMarker } from './stealthExitMarker.ts';
import { createTapMarker, type TapMarker } from './tapMarker.ts';
import { createThreatMarkers, type ThreatMarkerEntry } from './threatMarkers.ts';
import { createTidyMarkers } from './tidyMarkers.ts';
import { createBrowserVerbMetrics, type VerbMetrics } from './verbMetrics.ts';

export interface WorldUi {
  /** The small scene that holds the world-anchored elements (the tap marker, the threat icons and the glyph chip). */
  readonly scene: Scene;
  readonly tapMarker: TapMarker;
  /** The one key or button glyph beside the auto-targeted threat (story 1.17). */
  readonly glyphChip: GlyphChip;
  /** The multiplier above Papa, and the points of a cash-in (story 4.2). */
  readonly comboBadge: ComboBadge;
  /** « POSE-LE D'ABORD ! » above Papa after a refused toilet (story 4.3). */
  readonly papaHint: PapaHint;
  /** The ring that closes on Papa at each beat of a rhythm step (story 4.5). */
  readonly beatRing: BeatRing;
  /**
   * Once per frame, before `render`: the ring of the next beat, from the timeline and the loop's
   * continuous clock (`timeline` null outside a beats step). Allocation-free.
   */
  updateBeatRing(
    timeline: readonly BeatEntry[] | null,
    stepStartAt: number,
    clockMs: number,
    approachMs: number,
    papa: Readonly<{ xM: number; zM: number }> | null,
  ): void;
  /** The bubble above a busy Papa, with its ring draining to `busyUntil` (story 2.12). */
  readonly activityBubble: ActivityBubble;
  /**
   * Once per frame, before `updateCombo` (the badge moves to the bubble's right while it shows) and `render`:
   * the activity bubble from the world's Papa (not the pose: he is hidden on the toilet), the sim time as
   * drawn and the real time of the frame. It steps left while a threat that follows Papa is up and holds the
   * centre. Allocation-free.
   */
  updateActivity(
    papa: Readonly<ActivityPapa> | null,
    renderSimMs: number,
    threats: readonly Readonly<ThreatInstance>[],
    nowAtReal: number,
  ): void;
  /** A tap on a threat was refused: the bubble shakes (story 2.12). */
  shakeActivity(nowAtReal: number): void;
  /** The ring of breath around Papa during a stealth step (story 4.9). */
  readonly breathRing: BreathRing;
  /**
   * Once per frame, before `render`: the breath ring around Papa's drawn pose and the exit marker of a
   * stealth step, from the stealth slice (`null` outside a level). Allocation-free.
   */
  updateStealth(
    stealth: Readonly<StealthSlice> | null,
    breathCapacityMs: number,
    papa: Readonly<{ xM: number; zM: number }> | null,
  ): void;
  /** The « SORS ! » door at the exit of a stealth step (story 4.9). */
  readonly stealthExitMarker: StealthExitMarker;
  /** Mounts the threat icons of a level, replacing the previous level's (all hidden until a frame shows them). */
  mountThreats(entries: readonly ThreatMarkerEntry[]): void;
  /**
   * The chrono-ring geometry (story 2.11) the marker of `threatId` holds, as drawn at its last telegraph: the
   * judged mirror reads the per-mille the ring would draw at a press instant from it. Null for a threat with
   * no ring, or one not drawn yet. The marker's own object: allocation-free.
   */
  chronoRingOf(threatId: number): Readonly<ChronoRing> | null;
  /** Removes the threat icons (a restart hides the old ones before its countdown). */
  unmountThreats(): void;
  /**
   * Once per frame, before `render`: shows the icons of the active threats and highlights
   * `highlightedId` (pressed) and `targetedId` (auto-targeted, null on touch and mouse). The icons
   * that follow Papa (the micro-sleep) move to `papa`, his drawn pose. True when a press began to
   * show in this call (a target ring alone is not one). `renderSimMs` is the sim time as drawn and
   * `holdMinMs` the feel's: the hold-ring (story 1.23) fills over the one, from the press (see
   * `ThreatMarkers.update`). With `isBabyCarried` the Firmness icons say to put the baby down first.
   */
  updateThreats(
    threats: readonly Readonly<ThreatInstance>[],
    highlightedId: number | null,
    targetedId: number | null,
    papa?: Readonly<{ xM: number; zM: number }> | null,
    renderSimMs?: number | null,
    holdMinMs?: number,
    isBabyCarried?: boolean,
  ): boolean;
  /**
   * Once per frame, before `render`: the combo badge reads the combo and Papa's drawn pose. It moves
   * aside while a threat that follows Papa (the micro-sleep, the cry in the arms) is up, so that its
   * verb stays readable. `nowAtReal` is the real time of the frame, in ms. Allocation-free.
   */
  updateCombo(
    combo: Readonly<ComboSlice>,
    minMultiplier: number,
    papa: Readonly<{ xM: number; zM: number }> | null,
    threats: readonly Readonly<ThreatInstance>[],
    nowAtReal: number,
  ): void;
  /**
   * Once per frame, before `render`: the hint follows Papa's drawn pose and ends its hold (see
   * `PapaHint.update`). `nowAtReal` is the real time of the frame, in ms. Allocation-free.
   */
  updatePapaHint(papa: Readonly<{ xM: number; zM: number }> | null, nowAtReal: number): void;
  /** Mounts the icons of the level's interactive objects (the coffee machine, the toilet door), replacing the previous level's. */
  mountObjects(objects: readonly ObjectMarkerSpec[]): void;
  /** Removes the object icons. */
  unmountObjects(): void;
  /**
   * Once per frame, before `render`: one state per object kind (story 4.3). `isCoffeeUrgent` is the
   * fatigue being above its threshold, `isToiletUrgent` the need being at its warm point and
   * `isToiletOccupied` Papa being on the toilet.
   */
  updateObjects(isCoffeeUrgent: boolean, isToiletUrgent: boolean, isToiletOccupied: boolean): void;
  /** Mounts one « RANGE ! » marker per prop of the level (`world.props` order), replacing the previous level's (story 3.5). */
  mountTidy(propCount: number): void;
  /** Removes the tidy markers. */
  unmountTidy(): void;
  /**
   * Once per frame, before `render`: « RANGE ! » over each prop that is a mess while the flow is
   * `finalRush`, gone when it is tidied and in `photo`. Allocation-free.
   */
  updateTidy(world: Readonly<World>): void;
  /** The icon points of the mounted level, for the hit test. */
  readonly threatEntries: readonly ThreatMarkerEntry[];
  /**
   * Sizes the layer like the canvas, in CSS px; a marker would drift from its point otherwise. The
   * verbs are fitted to a share of this width (story 2.2), so they are fitted again.
   */
  setSize(widthPx: number, heightPx: number): void;
  /**
   * Fits the threat verbs again, from the current surface, `--pp-verb-scale` and loaded fonts: after the
   * fonts have loaded, and when the « Grands verbes » setting changes (story 2.10).
   */
  refitVerbs(): void;
  /**
   * Places the elements for this frame's camera: first the verb layout (the verbs that would overlap
   * are offset, the most urgent threat is in front) and the chip beside its verb, then the DOM renderer.
   * Returns at once, without calling the DOM renderer, while nothing in the layer is visible (no tap
   * marker, no threat icon, no object icon, no chip, no combo badge, no papa hint, no activity bubble).
   */
  render(camera: Camera): void;
  dispose(): void;
}

/**
 * The world-anchored UI layer (`#pp-world`, between the canvas and the HUD): one `CSS2DRenderer`
 * with its own scene. `sortObjects` is off: the renderer's z-sort allocates arrays every frame,
 * and a few markers have nothing to sort. `doc` makes the elements (the browser's `document`; a double
 * in tests). `metrics` reads the typography the verb fit needs (default: the page's, read when a level
 * has a verb).
 */
export function createWorldUi(
  container: HTMLElement,
  doc: Pick<Document, 'createElement' | 'createElementNS'> = document,
  metrics?: VerbMetrics,
  comboOptions: ComboBadgeOptions = { translate: (key) => key, isMotionReduced: () => false },
): WorldUi {
  const renderer = new CSS2DRenderer({ element: container });
  renderer.sortObjects = false;
  const scene = new ThreeScene();
  const tapMarker = createTapMarker(scene, doc, comboOptions.isMotionReduced);
  const threats = createThreatMarkers(scene, doc, metrics);
  const glyphChip = createGlyphChip(scene, doc);
  const comboBadge = createComboBadge(scene, doc, comboOptions);
  let verbMetrics = metrics;
  const papaHint = createPapaHint(scene, doc, comboOptions.translate, () => {
    verbMetrics ??= createBrowserVerbMetrics();
    return verbMetrics;
  });
  let layerWidthPx = 0;
  const objects = createObjectMarkers(scene, doc);
  // After the markers above it (index 4) and before the object markers, which moved up to 5+ with
  // it: the earlier children keep their places (a test reads them by index).
  const beatRing = createBeatRing(scene, doc, { isMotionReduced: comboOptions.isMotionReduced });
  // After the beat ring: the earlier children keep their places (a test reads them by index).
  const breathRing = createBreathRing(scene, doc);
  const stealthExitMarker = createStealthExitMarker(scene, doc, comboOptions.translate);
  // After the exit marker: the earlier children keep their places (a test reads them by index).
  const tidyMarkers = createTidyMarkers(scene, doc, comboOptions.translate);
  // Last: the earlier children keep their places (tests read them by index).
  const activityBubble = createActivityBubble(scene, doc, {
    isMotionReduced: comboOptions.isMotionReduced,
  });
  // A threat that follows Papa (the micro-sleep, the cry in the arms) is up: it holds the centre above him.
  const isFollowingThreatUp = (threatInstances: readonly Readonly<ThreatInstance>[]): boolean => {
    const entries = threats.entries;
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i]?.followsPapa) continue;
      const state = threatInstances[i]?.state;
      if (state === 'telegraph' || state === 'windowOpen') return true;
    }
    return false;
  };
  return {
    scene,
    tapMarker,
    glyphChip,
    comboBadge,
    papaHint,
    updatePapaHint: papaHint.update,
    beatRing,
    updateBeatRing: beatRing.update,
    breathRing,
    stealthExitMarker,
    updateStealth(stealth, breathCapacityMs, papa) {
      breathRing.update(stealth, breathCapacityMs, papa);
      stealthExitMarker.update(stealth);
    },
    activityBubble,
    updateActivity(papa, renderSimMs, threatInstances, nowAtReal) {
      activityBubble.update(papa, renderSimMs, isFollowingThreatUp(threatInstances), nowAtReal);
    },
    shakeActivity: activityBubble.shake,
    updateCombo(combo, minMultiplier, papa, threatInstances, nowAtReal) {
      comboBadge.update(
        combo.multiplier,
        minMultiplier,
        papa,
        isFollowingThreatUp(threatInstances),
        nowAtReal,
        activityBubble.isActive,
      );
    },
    mountThreats: threats.mount,
    unmountThreats: threats.unmount,
    updateThreats: threats.update,
    chronoRingOf: threats.chronoRing,
    mountObjects: objects.mount,
    unmountObjects: objects.unmount,
    updateObjects: objects.update,
    mountTidy: tidyMarkers.mount,
    unmountTidy: tidyMarkers.unmount,
    updateTidy: tidyMarkers.update,
    get threatEntries() {
      return threats.entries;
    },
    setSize(widthPx, heightPx) {
      renderer.setSize(widthPx, heightPx);
      threats.setSize(widthPx, heightPx);
      layerWidthPx = widthPx;
      papaHint.refit(widthPx);
    },
    refitVerbs() {
      threats.refit();
      papaHint.refit(layerWidthPx);
    },
    render(camera) {
      if (
        !(
          tapMarker.isVisible ||
          threats.isAnyVisible ||
          objects.isAnyVisible ||
          glyphChip.isVisible ||
          comboBadge.isVisible ||
          papaHint.isVisible ||
          beatRing.isVisible ||
          breathRing.isVisible ||
          stealthExitMarker.isVisible ||
          tidyMarkers.isAnyVisible ||
          activityBubble.isVisible
        )
      ) {
        return;
      }
      // Before the DOM renderer: the layout writes the offsets and the z-indices it places.
      threats.layout(camera);
      papaHint.layout(camera);
      glyphChip.refresh();
      renderer.render(scene, camera);
    },
    dispose() {
      tapMarker.dispose();
      glyphChip.dispose();
      comboBadge.dispose();
      papaHint.dispose();
      beatRing.dispose();
      breathRing.dispose();
      stealthExitMarker.dispose();
      tidyMarkers.dispose();
      activityBubble.dispose();
      threats.dispose();
      objects.dispose();
    },
  };
}
