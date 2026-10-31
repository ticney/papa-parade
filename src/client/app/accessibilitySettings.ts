import type { Settings } from '@content/schemas/save';
import { LARGE_VERBS_SCALE } from '@shared/constants';

/** What `createAccessibilitySettings` reads and writes, injected so that a test needs no DOM (story 2.10). */
export interface AccessibilitySettingsDeps {
  /** The `<html>` element: `data-pp-motion` and `--pp-verb-scale` go here. */
  root: Pick<HTMLElement, 'dataset' | 'style'>;
  /** `matchMedia('(prefers-reduced-motion: reduce)')`: the OS setting, read at creation then on its `change` event. */
  motionQuery: Pick<MediaQueryList, 'matches' | 'addEventListener'>;
  /** The settings in memory (the save), read at each use. */
  settings(): Settings;
  /** The verb scale really changed: the verb layout must refit (it reads the variable through `getComputedStyle`). */
  onVerbScaleChanged(): void;
}

export interface AccessibilitySettings {
  /**
   * « Motion reduced »: the player's switch, or the OS asking for it. Read per frame: no allocation.
   * The one answer for every effect of the screen (story 2.5).
   */
  isMotionReduced(): boolean;
  /**
   * Only the OS asking for reduced motion, whatever the player's switch says. The settings screen
   * uses it to tell the player that the effects are already reduced on this device.
   */
  isDeviceMotionReduced(): boolean;
  /**
   * Writes what the CSS reads: `data-pp-motion="reduced"` on the root (absent otherwise) and
   * `--pp-verb-scale`. Runs at boot, once the save is read, on each `SettingsChanged` and on a change
   * of the OS setting. Refits the verbs only when the scale really changed.
   */
  apply(): void;
}

/** What `ui.css` declares on `:root` before anything is applied. */
const DEFAULT_VERB_SCALE = 1;

/**
 * The single source of truth for the two comfort settings (story 2.10), reaching JS (a function) and
 * CSS (a root attribute and a custom property). Never a `style` attribute: the CSP forbids it, hence
 * `style.setProperty`. Not a debug mirror either: this attribute is a real feature, in prod too.
 */
export function createAccessibilitySettings(
  deps: AccessibilitySettingsDeps,
): AccessibilitySettings {
  const { root, motionQuery } = deps;
  let appliedVerbScale = DEFAULT_VERB_SCALE;

  // The OS value is read once, then followed through the query's `change` event, never read per frame:
  // Chromium reports no change to a list whose `matches` was read between the change and its event,
  // and the game asks `isMotionReduced` at every frame.
  let isOsReduced = motionQuery.matches;
  const isMotionReduced = (): boolean => deps.settings().reducedMotion || isOsReduced;

  const apply = (): void => {
    if (isMotionReduced()) root.dataset.ppMotion = 'reduced';
    else delete root.dataset.ppMotion;
    const verbScale = deps.settings().largeVerbs ? LARGE_VERBS_SCALE : DEFAULT_VERB_SCALE;
    root.style.setProperty('--pp-verb-scale', String(verbScale));
    if (verbScale === appliedVerbScale) return;
    appliedVerbScale = verbScale;
    deps.onVerbScaleChanged();
  };

  // The player can change the OS setting with the page open (`ui.spec.ts` does, with `emulateMedia`).
  motionQuery.addEventListener('change', () => {
    isOsReduced = motionQuery.matches;
    apply();
  });

  return { isMotionReduced, isDeviceMotionReduced: () => isOsReduced, apply };
}
