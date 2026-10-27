export function buzz(): void {
  (navigator as unknown as { [key: string]: (n: number) => boolean })['vibrate'](30);
}
