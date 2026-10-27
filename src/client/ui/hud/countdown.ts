import { RESUME_COUNTDOWN_MS } from '@shared/constants';
import type { Emitter } from '@shared/emitter';
import type { ClientEvents } from '../../app/clientEvents.ts';
import type { Translator } from '../strings.ts';

export type CountdownStep = 3 | 2 | 1;

const STEPS: readonly CountdownStep[] = [3, 2, 1];
// Literal keys on purpose: the architecture test checks every key against the strings file.
const STEP_KEYS: Record<CountdownStep, string> = {
  3: 'countdown.step_3',
  2: 'countdown.step_2',
  1: 'countdown.step_1',
};

/**
 * The digit to show with `remainingMs` of countdown left: the first third shows « 3 », the second
 * « 2 », the last « 1 »; nothing at 0 (the game is running). Longer than the countdown still
 * shows « 3 ». Anything that is not a positive number shows nothing.
 */
export function countdownStep(
  remainingMs: number,
  countdownMs: number = RESUME_COUNTDOWN_MS,
): CountdownStep | null {
  if (!(remainingMs > 0) || !Number.isFinite(remainingMs) || !(countdownMs > 0)) return null;
  const stepMs = countdownMs / STEPS.length;
  return Math.min(STEPS.length, Math.ceil(remainingMs / stepMs)) as CountdownStep;
}

export interface CountdownView {
  readonly element: HTMLElement;
  /** Call every frame while resuming. Touches the DOM, and emits `CountdownTicked`, only when the digit changes. */
  update(remainingMs: number): void;
  /** Forget the digit shown, so the next `update` shows and announces it again. */
  reset(): void;
}

export interface CountdownViewOptions {
  t: Translator;
  events: Emitter<ClientEvents>;
}

/**
 * The « 3 » « 2 » « 1 » of the resume countdown. The three digits exist from the start and are
 * shown one at a time, so a change is a `hidden` toggle (each digit pulses when it appears, by CSS)
 * and `update` allocates nothing.
 */
export function createCountdownView(options: CountdownViewOptions): CountdownView {
  const { t, events } = options;
  const element = document.createElement('div');
  element.className = 'pp-countdown';
  element.setAttribute('role', 'timer');
  element.setAttribute('aria-live', 'assertive');

  const digits = new Map<CountdownStep, HTMLElement>();
  for (const step of STEPS) {
    const digit = document.createElement('span');
    digit.className = 'pp-countdown-digit pp-type-countdown pp-stroked';
    digit.textContent = t(STEP_KEYS[step]);
    digit.hidden = true;
    digits.set(step, digit);
    element.append(digit);
  }

  let shown: CountdownStep | null = null;
  return {
    element,
    update(remainingMs) {
      const step = countdownStep(remainingMs);
      if (step === shown) return;
      if (shown !== null) (digits.get(shown) as HTMLElement).hidden = true;
      shown = step;
      if (step === null) return;
      (digits.get(step) as HTMLElement).hidden = false;
      events.emit('CountdownTicked', { step });
    },
    reset() {
      if (shown !== null) (digits.get(shown) as HTMLElement).hidden = true;
      shown = null;
    },
  };
}
