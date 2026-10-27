declare function t(key: string): string;
export function build(el: HTMLElement): void {
  el.textContent = t('pause.title');
  el.textContent = '';
  el.setAttribute('aria-label', t('pause.resume'));
  el.setAttribute('class', 'pp-button');
  el.append(t('pause.title'), document.createElement('span'));
  // Où est papa ? is fine in a comment
}
