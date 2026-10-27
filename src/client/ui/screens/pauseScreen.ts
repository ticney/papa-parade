import type { Emitter } from '@shared/emitter';
import type { ClientEvents } from '../../app/clientEvents.ts';
import { createCountdownView } from '../hud/countdown.ts';
import { nextFocusIndex } from '../keys.ts';
import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import type { Translator } from '../strings.ts';

/** `panel`: the « Pause » panel. `countdown`: the « 3 » « 2 » « 1 » of a resume. Same veil. */
export type PauseMode = 'panel' | 'countdown';

export interface PauseScreen extends OverlayScreen {
  readonly mode: PauseMode;
  setMode(mode: PauseMode): void;
  /** Call every frame while the countdown shows. */
  updateCountdown(remainingMs: number): void;
  /** Moves focus between the panel's buttons for an arrow key; false when the key is not one. */
  moveFocus(code: string): boolean;
}

export interface PauseScreenOptions {
  t: Translator;
  /** The face it opens in. Default: `panel`. */
  mode?: PauseMode;
  events: Emitter<ClientEvents>;
  onResume(): void;
  onRestart(): void;
}

interface PauseAction {
  labelKey: string;
  variant: 'primary' | 'secondary' | 'tertiary';
  onActivate(): void;
}

/**
 * The veil and its two faces. The panel lists its actions in code, so later stories append rows
 * (« Réglages » in 2.8, « Quitter vers le frigo » in 3.11). Panel and countdown are both built
 * once and swapped with `hidden`, so the veil never flickers between them.
 */
export function createPauseScreen(options: PauseScreenOptions): PauseScreen {
  const { t, events } = options;
  const actions: PauseAction[] = [
    { labelKey: 'pause.resume', variant: 'primary', onActivate: options.onResume },
    { labelKey: 'pause.restart', variant: 'secondary', onActivate: options.onRestart },
  ];

  const element = document.createElement('div');
  element.className = 'pp-overlay pp-pause-screen';

  const panel = document.createElement('section');
  panel.className = 'pp-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('pause.title'));
  const title = document.createElement('h2');
  title.className = 'pp-panel-title pp-type-heading';
  title.textContent = t('pause.title');
  const list = document.createElement('div');
  list.className = 'pp-panel-actions';
  panel.append(title, list);

  const buttons: HTMLButtonElement[] = [];
  const unbinds: Array<() => void> = [];
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pp-button pp-button-${action.variant}`;
    button.textContent = t(action.labelKey);
    button.setAttribute('aria-label', t(action.labelKey));
    unbinds.push(bindPressButton(button, action.onActivate));
    buttons.push(button);
    list.append(button);
  }

  let mode: PauseMode = options.mode ?? 'panel';
  const countdown = createCountdownView({ t, events });
  panel.hidden = mode !== 'panel';
  countdown.element.hidden = mode !== 'countdown';
  element.append(panel, countdown.element);

  return {
    element,
    // The countdown has nothing to focus: the panel's first button only when the panel shows.
    initialFocus: mode === 'panel' ? (buttons[0] ?? null) : null,
    get mode() {
      return mode;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      panel.hidden = next !== 'panel';
      countdown.element.hidden = next !== 'countdown';
      if (next === 'panel') {
        countdown.reset();
        if (element.isConnected) buttons[0]?.focus({ preventScroll: true });
      }
    },
    updateCountdown(remainingMs) {
      countdown.update(remainingMs);
    },
    moveFocus(code) {
      if (mode !== 'panel') return false;
      const target = nextFocusIndex(
        buttons.length,
        buttons.indexOf(document.activeElement as HTMLButtonElement),
        code,
      );
      if (target === null) return false;
      buttons[target]?.focus({ preventScroll: true });
      return true;
    },
    dispose() {
      for (const unbind of unbinds) unbind();
    },
  };
}
