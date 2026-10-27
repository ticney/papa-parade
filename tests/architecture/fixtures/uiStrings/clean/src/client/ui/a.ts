declare function t(key: string): string;
export function build(el: HTMLElement, flag: boolean, n: number): void {
  el.textContent = t('pause.title');
  el.textContent = '';
  el.setAttribute('aria-label', t('pause.resume'));
  el.setAttribute('class', 'pp-button');
  el.append(t('pause.title'), document.createElement('span'));
  el.textContent = flag ? t('pause.title') : t('pause.resume');
  el.textContent += t('pause.restart');
  el.textContent = `${n}`;
  // Où est papa ? is fine in a comment
}
