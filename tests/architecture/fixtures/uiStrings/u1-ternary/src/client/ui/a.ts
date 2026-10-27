declare function t(key: string): string;
export function build(el: HTMLElement, isPaused: boolean): void {
  el.textContent = isPaused ? t('pause.title') : 'Reprise';
}
