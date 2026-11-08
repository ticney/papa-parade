import type { FramingStyle } from '@content/schemas/feedback';
import type { FramingStyleId } from '@shared/constants';
import type { SequenceFraming } from '../../render/cameraFx.ts';

// The film grammar of a special sequence on screen (story 7.4, D8): the letterbox bars, a vignette and
// an Epic title card. Three siblings put right before `#pp-world` (under it, like the instinct vignette),
// so every marker, verb, ring and the HUD stay on top, and the HUD's node budget is not touched. Read from
// the world's sequence slice and the sim clock alone (the framing chain's values): a pause holds it, a
// slow-mo stretches it. It reads no threat: no window, no feint.

type Doc = Pick<Document, 'createElement'>;

export const FILM_FRAMING_CLASSES = {
  vignette: 'pp-film-vignette',
  letterbox: 'pp-film-letterbox',
  title: 'pp-film-title',
} as const;

/** The CSS property the letterbox's two bars take their height from, in % of the screen. */
export const LETTERBOX_HEIGHT_PROPERTY = '--pp-letterbox-pct';

/** What the film grammar draws this frame, written by {@link filmLookInto}. */
export interface FilmLook {
  /** The style of the sequence on screen, or null: nothing is drawn. */
  styleId: FramingStyleId | null;
  /** The bars' height now, in % of the screen (`letterboxPct × blend`, the seam's carry included). */
  letterboxPct: number;
  /** The bars' height at full blend: what reduced motion draws, fading instead of sliding. */
  letterboxFullPct: number;
  /** The vignette's darkness now, in %. */
  vignettePct: number;
  /** The title card's string key, or null for none. */
  titleKey: string | null;
  /** When the sequence that owns the title started, in sim ms: a new start is a new card. */
  titleStartedAt: number;
  /** How far into the title card the sim clock is, in sim ms (negative before, past `titleHoldMs` after). */
  titleAgeMs: number;
  /** How long the card stays, in sim ms; 0 shows none. */
  titleHoldMs: number;
}

export function createFilmLook(): FilmLook {
  return {
    styleId: null,
    letterboxPct: 0,
    letterboxFullPct: 0,
    vignettePct: 0,
    titleKey: null,
    titleStartedAt: 0,
    titleAgeMs: 0,
    titleHoldMs: 0,
  };
}

/** The sequence the look is read for: its framing keys and its slice of the world. */
export interface FilmSequence {
  readonly style: FramingStyleId | undefined;
  readonly titleKey: string | undefined;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

/**
 * Writes into `out` the look of `sequence` at sim time `clockMs`, from the camera's `framing` (already
 * through the chain) and the style's row of `feedback.json › framingStyles`. Nothing to draw once the
 * framing has gone out (`blend` 0). The title shows from the start for `titleHoldMs` while the sequence
 * runs. Pure and allocation-free.
 */
export function filmLookInto(
  out: FilmLook,
  framing: Readonly<SequenceFraming>,
  sequence: Readonly<FilmSequence> | null,
  style: Readonly<FramingStyle> | null,
  clockMs: number,
): void {
  const isShown = sequence !== null && sequence.style !== undefined && style !== null;
  if (!isShown || framing.blend <= 0) {
    out.styleId = null;
    out.letterboxPct = 0;
    out.letterboxFullPct = 0;
    out.vignettePct = 0;
    out.titleKey = null;
    out.titleHoldMs = 0;
    return;
  }
  out.styleId = sequence.style ?? null;
  out.letterboxPct = framing.letterboxPct * framing.blend;
  out.letterboxFullPct = Math.max(style.letterboxPct, out.letterboxPct);
  out.vignettePct = framing.vignetteOpacityPct * framing.blend;
  const isRunning = sequence.endedAt === null || clockMs < sequence.endedAt;
  out.titleKey = isRunning && sequence.titleKey !== undefined ? sequence.titleKey : null;
  out.titleStartedAt = sequence.startedAt;
  out.titleAgeMs = clockMs - sequence.startedAt;
  out.titleHoldMs = style.titleHoldMs;
}

export interface FilmFraming {
  /** The vignette, the letterbox and the title, in this order, for boot to put right before `#pp-world`. */
  readonly elements: readonly HTMLElement[];
  /** Once per frame. Writes the DOM only when what it shows changes. */
  update(look: Readonly<FilmLook>, isMotionReduced: boolean): void;
  /** Hides everything at once (level end, restart, loading). */
  reset(): void;
}

/** The title's scale-in takes this share of its time, and its fade out the last quarter (as the stamp). */
const TITLE_IN_SHARE = 0.15;
const TITLE_OUT_FROM = 0.75;
const TITLE_IN_SCALE = 1.25;

/**
 * The film framing's three layers (story 7.4). The bars are one element and its two pseudo-elements,
 * their height a CSS property; under reduced motion they stand at full height and fade in and out
 * instead (`opacity`). The title card is in the Epic register; its Web Animation is paused and its
 * `currentTime` set from the sim clock each frame (a pause holds it), a plain fade under reduced motion.
 */
export function createFilmFraming(doc: Doc, translate: (key: string) => string): FilmFraming {
  const vignette = doc.createElement('div');
  vignette.className = FILM_FRAMING_CLASSES.vignette;
  vignette.setAttribute('aria-hidden', 'true');
  const letterbox = doc.createElement('div');
  letterbox.className = FILM_FRAMING_CLASSES.letterbox;
  letterbox.setAttribute('aria-hidden', 'true');
  const title = doc.createElement('div');
  title.className = `${FILM_FRAMING_CLASSES.title} pp-type-epic pp-stroked`;
  title.setAttribute('aria-hidden', 'true');

  let drawnBarsPct = 0;
  let drawnBarsOpacity = 0;
  let drawnVignette = 0;
  let titleKeyShown: string | null = null;
  let titleStartedAt = Number.NaN;
  let titleReduced = false;
  let titleRun: Animation | null = null;

  const setBars = (heightPct: number, opacity: number): void => {
    if (heightPct !== drawnBarsPct) {
      drawnBarsPct = heightPct;
      letterbox.style.setProperty(LETTERBOX_HEIGHT_PROPERTY, String(heightPct));
    }
    if (opacity !== drawnBarsOpacity) {
      drawnBarsOpacity = opacity;
      letterbox.style.opacity = String(opacity);
    }
  };
  const setVignette = (opacity: number): void => {
    if (opacity === drawnVignette) return;
    drawnVignette = opacity;
    vignette.style.opacity = String(opacity);
  };
  const stopTitle = (): void => {
    titleRun?.cancel();
    titleRun = null;
    titleStartedAt = Number.NaN;
  };
  const startTitle = (holdMs: number, isMotionReduced: boolean): void => {
    titleRun?.cancel();
    const keyframes: Keyframe[] = isMotionReduced
      ? [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: TITLE_IN_SHARE },
          { opacity: 1, offset: TITLE_OUT_FROM },
          { opacity: 0, offset: 1 },
        ]
      : [
          { opacity: 0, transform: `scale(${TITLE_IN_SCALE})`, offset: 0, easing: 'ease-out' },
          { opacity: 1, transform: 'scale(1)', offset: TITLE_IN_SHARE },
          { opacity: 1, transform: 'scale(1)', offset: TITLE_OUT_FROM },
          { opacity: 0, transform: 'scale(1)', offset: 1 },
        ];
    titleRun = title.animate(keyframes, { duration: holdMs, easing: 'linear', fill: 'both' });
    titleRun.pause();
    titleReduced = isMotionReduced;
  };

  return {
    elements: [vignette, letterbox, title],
    update(look, isMotionReduced) {
      if (isMotionReduced) {
        const full = look.letterboxFullPct;
        setBars(full, full > 0 ? look.letterboxPct / full : 0);
      } else {
        setBars(look.letterboxPct, look.letterboxPct > 0 ? 1 : 0);
      }
      setVignette(look.vignettePct / 100);
      const isTitleOn =
        look.titleKey !== null &&
        look.titleHoldMs > 0 &&
        look.titleAgeMs >= 0 &&
        look.titleAgeMs < look.titleHoldMs;
      if (!isTitleOn || look.titleKey === null) {
        if (titleRun !== null) stopTitle();
        return;
      }
      if (look.titleKey !== titleKeyShown) {
        titleKeyShown = look.titleKey;
        title.textContent = translate(look.titleKey);
      }
      if (
        titleRun === null ||
        look.titleStartedAt !== titleStartedAt ||
        isMotionReduced !== titleReduced
      ) {
        startTitle(look.titleHoldMs, isMotionReduced);
        titleStartedAt = look.titleStartedAt;
      }
      if (titleRun !== null) titleRun.currentTime = look.titleAgeMs;
    },
    reset() {
      setBars(0, 0);
      setVignette(0);
      stopTitle();
    },
  };
}
