import type { BeatEntry } from '@sim';
import type { Scene } from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';

export interface BeatRingOptions {
  /** Whether the player asked for less motion: the ring then pops in opacity and drops its scale. */
  isMotionReduced: () => boolean;
}

export interface BeatRing {
  /** True while a ring is drawn. */
  readonly isVisible: boolean;
  /** The entry the ring counts down to (an index of the timeline), or -1 when none is shown. */
  readonly entryIndex: number;
  /** How far it has closed, 0 (just appeared) to 1 (on the beat), 0 when none is shown. */
  readonly progress: number;
  /**
   * Once per frame, before `worldUi.render`, from the timeline and the loop's continuous clock, never
   * from events: a pause holds the clock, hence the ring. `timeline` is null outside a beats step.
   * `approachMs` is `feedback.json › beatRing.approachMs`, in sim ms. With no pose (a restart) the
   * ring hides. Allocation-free.
   */
  update(
    timeline: readonly BeatEntry[] | null,
    stepStartAt: number,
    clockMs: number,
    approachMs: number,
    papa: Readonly<{ xM: number; zM: number }> | null,
  ): void;
  /** Hides the ring and forgets the step (a restart). */
  hide(): void;
  dispose(): void;
}

/**
 * The one pooled ring on Papa (story 4.5, AC 16), built like the papa hint: a `CSS2DObject`,
 * `aria-hidden`, no pointer events. It closes on Papa over `approachMs` before a beat, so the tempo
 * can be followed with the sound off. The outer element is placed by the CSS2DRenderer (it writes
 * its `transform`), the inner disc carries the scale. A decoy's ring is dashed and carries a `✕`
 * from CSS: shape and colour, never colour alone (NFR8). The progress is the custom property
 * `--pp-beat-progress` on the outer element; the classes are written only when they change.
 */
export function createBeatRing(
  scene: Scene,
  doc: Pick<Document, 'createElement'>,
  options: BeatRingOptions,
): BeatRing {
  const element = doc.createElement('div');
  element.className = 'pp-beat-ring';
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'none';
  const disc = doc.createElement('div');
  disc.className = 'pp-beat-ring-disc';
  element.append(disc);

  const object = new CSS2DObject(element);
  object.visible = false;
  object.position.set(0, PAPA_HEIGHT_M / 2, 0);
  scene.add(object);

  /** The cursor into the timeline: it only moves forward, except when the step restarts. */
  let cursor = 0;
  let runStartAt = Number.NaN;
  let shownKind: BeatEntry['kind'] | null = null;
  let isReduced = false;
  let shownIndex = -1;
  let shownProgress = 0;

  const setVisible = (isVisible: boolean): void => {
    if (isVisible === object.visible) return;
    object.visible = isVisible;
    element.style.display = isVisible ? '' : 'none';
  };

  const hide = (): void => {
    setVisible(false);
    shownIndex = -1;
    shownProgress = 0;
    shownKind = null;
  };

  return {
    get isVisible() {
      return object.visible;
    },
    get entryIndex() {
      return shownIndex;
    },
    get progress() {
      return shownProgress;
    },
    update(timeline, stepStartAt, clockMs, approachMs, papa) {
      if (timeline === null || papa === null) {
        hide();
        runStartAt = Number.NaN;
        cursor = 0;
        return;
      }
      if (stepStartAt !== runStartAt) {
        runStartAt = stepStartAt;
        cursor = 0;
      }
      // The first entry still to come: never behind itself, and it walks back if the clock did.
      while (cursor > 0 && stepStartAt + (timeline[cursor - 1]?.offsetMs ?? 0) >= clockMs) {
        cursor -= 1;
      }
      while (
        cursor < timeline.length &&
        stepStartAt + (timeline[cursor]?.offsetMs ?? 0) < clockMs
      ) {
        cursor += 1;
      }
      const entry = timeline[cursor];
      if (entry === undefined) {
        hide();
        return;
      }
      const startsAt = stepStartAt + entry.offsetMs - approachMs;
      if (clockMs < startsAt) {
        hide();
        return;
      }
      const progress = Math.min(1, Math.max(0, (clockMs - startsAt) / approachMs));
      object.position.x = papa.xM;
      object.position.z = papa.zM;
      setVisible(true);
      shownIndex = cursor;
      if (progress !== shownProgress) {
        shownProgress = progress;
        element.style.setProperty('--pp-beat-progress', String(progress));
      }
      if (entry.kind !== shownKind) {
        shownKind = entry.kind;
        element.classList.toggle('pp-beat-ring--decoy', entry.kind === 'decoy');
        element.classList.toggle('pp-beat-ring--count-in', entry.kind === 'countIn');
      }
      const isNowReduced = options.isMotionReduced();
      if (isNowReduced !== isReduced) {
        isReduced = isNowReduced;
        element.classList.toggle('pp-beat-ring--reduced', isNowReduced);
      }
    },
    hide,
    dispose() {
      hide();
      scene.remove(object);
    },
  };
}
