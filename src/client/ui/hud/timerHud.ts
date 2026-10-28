import type { LevelVariant } from '@content/schemas/level';
import { SECONDS_PER_MINUTE } from '@shared/constants';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

type Doc = Pick<Document, 'createElement' | 'createElementNS'>;

export interface TimerHud {
  /** The `hud-timer` pill, for the `timer` zone of the HUD. */
  readonly element: HTMLElement;
  /** The icon and the spoken name of the level's variant (once per level). */
  setVariant(variant: LevelVariant): void;
  /** The time left, in whole seconds. The caller writes through `hudBatch`: once per second at most. */
  setRemainingS(seconds: number): void;
}

export interface TimerHudOptions {
  t: Translator;
}

// Literal keys on purpose: the architecture test checks every key against the strings file.
const VARIANT_KEYS: Readonly<Record<LevelVariant, string>> = {
  nap: 'hud.timer_variant_nap',
};

/**
 * The sleeping Mama of the Sieste (mockup `#i-mama-sleep`): a head, a hair bun, two closed eyes and
 * a « Z ». The colours come from CSS classes that use the tokens (the face in paper, the lines in
 * ink), never from here.
 */
function napIcon(doc: Doc): SVGSVGElement {
  return svgElement(
    'svg',
    { viewBox: '0 0 28 28', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgElement(
        'circle',
        { class: 'pp-hud-timer-face', cx: '13', cy: '15', r: '9', 'stroke-width': '2.4' },
        [],
        doc,
      ),
      svgElement('circle', { class: 'pp-hud-timer-bun', cx: '13', cy: '5.5', r: '3.4' }, [], doc),
      svgElement(
        'path',
        { class: 'pp-hud-timer-line', d: 'M8.5 15q2 1.8 3.6 0M14 15q2 1.8 3.6 0' },
        [],
        doc,
      ),
      svgElement('path', { class: 'pp-hud-timer-line', d: 'M20 3h5l-5 5h5' }, [], doc),
    ],
    doc,
  ) as SVGSVGElement;
}

/** One icon per variant: adding `'return'` to `LEVEL_VARIANTS` without its icon does not compile. */
const ICONS: Readonly<Record<LevelVariant, (doc: Doc) => SVGSVGElement>> = {
  nap: napIcon,
};

/** `m:ss`: 0 → `0:00`, 59 → `0:59`, 180 → `3:00`, 600 → `10:00`. A negative or fractional count is floored at 0 / down. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const rest = total % SECONDS_PER_MINUTE;
  return `${Math.floor(total / SECONDS_PER_MINUTE)}:${rest < 10 ? '0' : ''}${rest}`;
}

/**
 * The HUD's timer (UX-DR4, top centre): a paper pill with an ink outline, the variant's icon and
 * the time left in `numeric` digits. `role="timer"` with an `aria-label` that says the variant and
 * the time (« Sieste, 2:47 »). It counts sim time, so it slows with a slow-mo and freezes with a pause.
 */
export function createTimerHud(doc: Doc, options: TimerHudOptions): TimerHud {
  const { t } = options;
  const element = doc.createElement('div');
  element.className = 'pp-hud-timer';
  element.setAttribute('role', 'timer');
  const digits = doc.createElement('span');
  digits.className = 'pp-hud-timer-digits pp-type-numeric';
  element.append(digits);
  let variant: LevelVariant | null = null;
  let icon: SVGSVGElement | null = null;
  let clock = '';

  const refreshLabel = (): void => {
    const name = variant === null ? '' : t(VARIANT_KEYS[variant]);
    element.setAttribute(
      'aria-label',
      name !== '' && clock !== '' ? `${name}, ${clock}` : `${name}${clock}`,
    );
  };

  return {
    element,
    setVariant(next) {
      variant = next;
      const fresh = ICONS[next](doc);
      if (icon === null) element.prepend(fresh);
      else icon.replaceWith(fresh);
      icon = fresh;
      refreshLabel();
    },
    setRemainingS(seconds) {
      clock = formatClock(seconds);
      digits.textContent = clock;
      refreshLabel();
    },
  };
}
