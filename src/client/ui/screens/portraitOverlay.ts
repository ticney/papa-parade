import type { OverlayScreen } from '../overlayScreen.ts';
import type { Translator } from '../strings.ts';
import { svgElement } from '../svg.ts';

/** « Tourne ton téléphone »: covers the game while the device is held in portrait. */
export function createPortraitOverlay(options: { t: Translator }): OverlayScreen {
  const element = document.createElement('div');
  element.className = 'pp-overlay pp-portrait-screen';

  const icon = svgElement(
    'svg',
    { viewBox: '0 0 96 96', 'aria-hidden': 'true', focusable: 'false' },
    [
      svgElement('rect', { x: '30', y: '10', width: '36', height: '76', rx: '8' }),
      svgElement('path', { d: 'M44 74h8' }),
    ],
  );
  icon.classList.add('pp-portrait-icon');

  const text = document.createElement('p');
  text.className = 'pp-portrait-text pp-type-heading';
  text.textContent = options.t('portrait.rotate');
  element.append(icon, text);

  return { element, initialFocus: null, dispose() {} };
}
