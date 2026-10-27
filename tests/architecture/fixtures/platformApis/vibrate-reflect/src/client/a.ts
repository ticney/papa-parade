export function buzz(): void {
  Reflect.get(navigator, 'vibrate').call(navigator, 30);
}
