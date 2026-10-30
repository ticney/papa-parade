import type { OverlayScreen } from '../overlayScreen.ts';
import { bindPressButton } from '../pressButton.ts';
import type { Translator } from '../strings.ts';

export interface CreditsScreenOptions {
  t: Translator;
  /** Back to the settings. */
  onBack(): void;
}

/**
 * The credits (story 2.8): a plain panel, its text a placeholder until story 6.8. Retour has focus;
 * Escape and B go back as well. The screen holds no state, so a turned phone rebuilds it as it was.
 */
export function createCreditsScreen(options: CreditsScreenOptions): OverlayScreen {
  const { t } = options;
  const element = document.createElement('div');
  element.className = 'pp-overlay pp-credits-screen';
  const panel = document.createElement('section');
  panel.className = 'pp-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('credits.title'));
  const title = document.createElement('h2');
  title.className = 'pp-panel-title pp-type-heading';
  title.textContent = t('credits.title');
  const body = document.createElement('p');
  body.className = 'pp-panel-note pp-type-body';
  body.textContent = t('credits.body');
  const actions = document.createElement('div');
  actions.className = 'pp-panel-actions';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'pp-button pp-button-primary';
  back.textContent = t('settings.back');
  back.setAttribute('aria-label', t('settings.back'));
  const unbind = bindPressButton(back, options.onBack);
  actions.append(back);
  panel.append(title, body, actions);
  element.append(panel);

  return {
    element,
    initialFocus: back,
    activate() {
      back.click();
    },
    back() {
      options.onBack();
    },
    dispose() {
      unbind();
    },
  };
}
