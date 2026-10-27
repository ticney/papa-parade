import { LOADING_LINE_INTERVAL_MS } from '@shared/constants';
import type { OverlayScreen } from '../overlayScreen.ts';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

// Literal keys on purpose: the architecture test checks every key against the strings file.
const LINE_KEYS: readonly string[] = [
  'loading.line_bottle',
  'loading.line_toys',
  'loading.line_keys',
];

/** The line after `current` out of `count`, going round. Anything unusable starts over at 0. */
export function nextLineIndex(current: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  if (!Number.isInteger(current) || current < 0) return 0;
  return (current + 1) % count;
}

export interface LoadingScreenOptions {
  t: Translator;
  /** Default: `setInterval`/`clearInterval`. Tests pass their own. */
  timers?: {
    setInterval(callback: () => void, delayMs: number): number;
    clearInterval(handle: number): void;
  };
}

function createBottle(): SVGElement {
  return svgElement(
    'svg',
    { class: 'pp-bottle', viewBox: '0 0 64 96', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgElement('rect', {
        class: 'pp-bottle-glass',
        x: '14',
        y: '34',
        width: '36',
        height: '56',
        rx: '9',
      }),
      // The milk fills from the bottom: a `scaleY` of this rect, nothing that triggers layout.
      svgElement('rect', {
        class: 'pp-bottle-fill',
        x: '19',
        y: '39',
        width: '26',
        height: '46',
        rx: '5',
      }),
      svgElement('rect', {
        class: 'pp-bottle-neck',
        x: '25',
        y: '24',
        width: '14',
        height: '10',
        rx: '2',
      }),
      svgElement('path', {
        class: 'pp-bottle-teat',
        d: 'M27 24 C27 12 29 6 32 6 C35 6 37 12 37 24 Z',
      }),
    ],
  );
}

/**
 * The loading screen: a baby bottle that fills on `cream` and flavour lines that rotate. There is no
 * percentage and no number: the fill is indeterminate on purpose, because nothing here knows how far
 * the load is. The screen is opaque and covers the surface, so nothing reaches the canvas under it.
 * It takes no focus.
 */
export function createLoadingScreen(options: LoadingScreenOptions): OverlayScreen {
  const { t } = options;
  const timers = options.timers ?? {
    setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
    clearInterval: (handle) => window.clearInterval(handle),
  };

  const element = document.createElement('div');
  element.className = 'pp-overlay pp-loading-screen';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');

  const line = document.createElement('p');
  line.className = 'pp-loading-line pp-type-body';
  let index = 0;
  line.textContent = t(LINE_KEYS[index] as string);
  element.append(createBottle(), line);

  const handle = timers.setInterval(() => {
    index = nextLineIndex(index, LINE_KEYS.length);
    line.textContent = t(LINE_KEYS[index] as string);
  }, LOADING_LINE_INTERVAL_MS);

  return {
    element,
    initialFocus: null,
    dispose() {
      timers.clearInterval(handle);
    },
  };
}
