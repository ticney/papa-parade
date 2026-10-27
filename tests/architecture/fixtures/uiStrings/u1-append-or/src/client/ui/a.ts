declare function t(key: string): string;
export function build(el: HTMLElement, label?: string): void {
  el.append(label || 'Salut');
  el.append(t('pause.title'));
}
