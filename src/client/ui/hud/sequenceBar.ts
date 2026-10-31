import type { SequenceDef } from '@content/schemas/sequence';
import type { Translator } from '../strings.ts';

type Doc = Pick<Document, 'createElement'>;

/** What the bar reads of the world: the sequence slice and the sim clock. */
export interface SequenceBarWorld {
  readonly sequence: {
    readonly id: string | null;
    readonly startedAt: number;
    readonly endsAt: number;
    /** The running `beats` step: the baby's wake feeds the `calmLeft` bar (story 4.5). */
    readonly beat: { readonly wakePct: number };
  };
  readonly time: { readonly sim: number };
}

type SequenceBarValue = NonNullable<SequenceDef['framing']['bar']>['value'];

const PERCENT_MAX = 100;

/**
 * The whole percent a bar of `value` shows. A `switch` with no default and a return type of
 * `number`: a new `SEQUENCE_BAR_VALUES` entry does not compile until it has its case here.
 */
function percentOf(value: SequenceBarValue, world: SequenceBarWorld): number {
  const { sequence } = world;
  switch (value) {
    case 'timeLeft': {
      const lengthMs = sequence.endsAt - sequence.startedAt;
      const left = lengthMs > 0 ? (sequence.endsAt - world.time.sim) / lengthMs : 0;
      return Math.round(Math.min(PERCENT_MAX, Math.max(0, left * PERCENT_MAX)));
    }
    case 'calmLeft':
      // The baby's calm: what is left of him before he is awake (story 4.5).
      return Math.round(Math.min(PERCENT_MAX, Math.max(0, PERCENT_MAX - sequence.beat.wakePct)));
  }
}

export interface SequenceBar {
  /** The bar's element: in the DOM only while shown, and `slideMs` of real time after the end. */
  readonly element: HTMLElement;
  /** The parent the bar mounts into when shown: the HUD's `timer` zone (`hudLayer.ts`). */
  attachTo(parent: HTMLElement): void;
  /**
   * Once per frame, by state (never by events: a pause, a restart or a level end cannot leave it
   * up): the bar is wanted while a sequence whose def has a bar runs. Returns the whole percent the
   * bar should show (0 when none is wanted and the bar is gone; the last one shown while it slides out); the caller writes it through `hudBatch` (`setPercent`).
   * Allocation-free.
   */
  update(world: SequenceBarWorld, def: SequenceDef | null): number;
  /** The `hudBatch` writer of the value: whole percent, `aria-valuenow` and the fill's scale. */
  setPercent(percent: number): void;
  /**
   * The sequence ended in failure (on its event, the one thing the bar is told): a `calmLeft` bar
   * slides out empty, because the stir that woke the baby and the end fall in one sim step and the
   * last frame it drew was still calm. A `timeLeft` bar keeps what it showed. Cleared when a
   * sequence is wanted again and at `reset`.
   */
  markFailed(): void;
  /** Once per frame, with real time: mounts a bar that is wanted, and unmounts one `slideMs` after its end. */
  frame(nowAtReal: number): void;
  /** Whether the bar is in the DOM (shown, or still sliding out): the timer is compact exactly then. */
  readonly isMounted: boolean;
  /** A level start: the bar is removed at once, whatever was playing. */
  reset(): void;
}

export interface SequenceBarOptions {
  t: Translator;
  /** How long the bar stays mounted after the end, to slide out, in real ms (`feedback.sequenceBar.slideMs`). */
  slideMs: number;
}

/**
 * The sequence bar (UX-DR23, story 4.4): a paper container with an ink outline under the timer, a
 * label and a segmented track whose fill is `gauge-warn` for an opponent's « health » and
 * `gauge-calm` for a player resource. Two DOM nodes only, to stay in the HUD's budget. `role="progressbar"`, `aria-label` from the def's `labelKey`.
 * It slides in at the start and out at the end; the unmount waits for `slideMs` of real time and
 * never for `transitionend`, which does not fire under `prefers-reduced-motion`. A sequence that
 * starts while the bar slides out re-shows it and cancels the removal.
 */
export function createSequenceBar(doc: Doc, options: SequenceBarOptions): SequenceBar {
  const { t, slideMs } = options;
  const element = doc.createElement('div');
  element.className = 'pp-hud-sequence-bar pp-type-label pp-hud-sequence-bar--out';
  element.setAttribute('role', 'progressbar');
  element.setAttribute('aria-valuemin', '0');
  element.setAttribute('aria-valuemax', String(PERCENT_MAX));
  element.style.setProperty('--pp-sequence-slide-ms', `${slideMs}ms`);
  // Two nodes (the HUD's budget, story 4.4): the label is the container's `::before` (read from
  // `data-label`), and the fill is the track's background, driven by `--pp-sequence-value`.
  const track = doc.createElement('span');
  track.className = 'pp-hud-sequence-track';
  element.append(track);

  let parent: HTMLElement | null = null;
  let isMounted = false;
  let isWanted = false;
  /** Real time the bar stopped being wanted, or null while it is wanted or gone. */
  let unwantedAtReal: number | null = null;
  /** Whether the `--out` class (slid out of sight) is on: written only on a change. */
  let isOut = true;
  let shownPercent = -1;
  /** What the bar showed last while wanted, and whether the sequence then ended in failure. */
  let shownValue: SequenceBarValue | null = null;
  let isFailed = false;
  let shownLabelKey = '';
  let shownFill = '';

  const setOut = (next: boolean): void => {
    if (next === isOut) return;
    isOut = next;
    element.classList.toggle('pp-hud-sequence-bar--out', next);
  };

  const unmount = (): void => {
    if (!isMounted) return;
    element.remove();
    isMounted = false;
    setOut(true);
    unwantedAtReal = null;
  };

  return {
    element,
    attachTo(next) {
      parent = next;
    },
    update(world, def) {
      const bar = def?.framing.bar ?? null;
      const { sequence } = world;
      isWanted = sequence.id !== null && bar !== null;
      if (bar === null || def === null) return 0;
      if (bar.labelKey !== shownLabelKey) {
        shownLabelKey = bar.labelKey;
        const text = t(bar.labelKey);
        element.setAttribute('data-label', text);
        element.setAttribute('aria-label', text);
      }
      const fillClass =
        bar.fill === 'opponent' ? 'pp-hud-sequence-bar--warn' : 'pp-hud-sequence-bar--calm';
      if (fillClass !== shownFill) {
        shownFill = fillClass;
        element.classList.remove('pp-hud-sequence-bar--warn', 'pp-hud-sequence-bar--calm');
        element.classList.add(fillClass);
      }
      // Sliding out after an end: the fill keeps what it showed (a time bar must not empty while it
      // is still seen), except the baby's calm after he woke: he is not calm, the bar says 0.
      if (!isWanted) {
        if (isFailed && shownValue === 'calmLeft') return 0;
        return isMounted ? Math.max(0, shownPercent) : 0;
      }
      isFailed = false;
      shownValue = bar.value;
      return percentOf(bar.value, world);
    },
    markFailed() {
      isFailed = true;
    },
    setPercent(percent) {
      if (percent === shownPercent) return;
      shownPercent = percent;
      element.setAttribute('aria-valuenow', String(percent));
      element.style.setProperty('--pp-sequence-value', String(percent / PERCENT_MAX));
    },
    frame(nowAtReal) {
      if (isWanted) {
        unwantedAtReal = null;
        if (!isMounted) {
          if (parent === null) return;
          parent.append(element);
          isMounted = true;
          // It starts slid out: the next frame takes the class off, so that it slides in.
          return;
        }
        setOut(false);
        return;
      }
      if (!isMounted) return;
      setOut(true);
      unwantedAtReal ??= nowAtReal;
      if (nowAtReal - unwantedAtReal >= slideMs) unmount();
    },
    get isMounted() {
      return isMounted;
    },
    reset() {
      isWanted = false;
      isFailed = false;
      shownValue = null;
      unmount();
    },
  };
}
