import { bindPressButton } from '../pressButton.ts';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

export interface PauseButton {
  readonly element: HTMLButtonElement;
  dispose(): void;
}

export interface PauseButtonOptions {
  t: Translator;
  onPress(): void;
}

/** The HUD's pause button: a `button-icon`, 44 × 44 at least, with a French `aria-label`. */
export function createPauseButton(options: PauseButtonOptions): PauseButton {
  const { t, onPress } = options;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'pp-button pp-button-icon pp-hud-pause';
  element.setAttribute('aria-label', t('hud.pause_button'));
  element.append(
    svgElement('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true', focusable: 'false' }, [
      svgElement('rect', { x: '3', y: '2', width: '5', height: '16', rx: '2' }),
      svgElement('rect', { x: '12', y: '2', width: '5', height: '16', rx: '2' }),
    ]),
  );
  const unbind = bindPressButton(element, onPress);
  return { element, dispose: unbind };
}
