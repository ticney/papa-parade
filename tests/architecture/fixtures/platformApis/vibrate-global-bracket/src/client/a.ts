export function buzz(): void {
  globalThis['navigator']['vibrate'](30);
}
