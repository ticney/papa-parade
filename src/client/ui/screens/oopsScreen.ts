import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import type { Translator } from '../strings.ts';

export interface OopsScreenOptions {
  t: Translator;
  /** « Réessayer »: the level loads again. */
  onRetry(): void;
}

/**
 * « Oups ! Quelque chose s'est renversé. » on a plain panel, and one button. The failure is never
 * named: no error text, no stack, nothing a parent would have to read at the end of a long day. The
 * button takes focus when the screen appears.
 */
export function createOopsScreen(options: OopsScreenOptions): OverlayScreen {
  const { t, onRetry } = options;
  const element = document.createElement('div');
  element.className = 'pp-overlay pp-oops-screen';

  const panel = document.createElement('section');
  panel.className = 'pp-panel';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('oops.message'));

  const message = document.createElement('h2');
  message.className = 'pp-panel-title pp-type-heading';
  message.textContent = t('oops.message');

  const actions = document.createElement('div');
  actions.className = 'pp-panel-actions';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'pp-button pp-button-primary';
  retry.textContent = t('oops.retry');
  retry.setAttribute('aria-label', t('oops.retry'));
  const unbind = bindPressButton(retry, onRetry);
  actions.append(retry);

  panel.append(message, actions);
  element.append(panel);

  // A pad's A presses the button the way a key does (`click` with no pointer), so it is one path.
  return { element, initialFocus: retry, activate: () => retry.click(), dispose: unbind };
}
