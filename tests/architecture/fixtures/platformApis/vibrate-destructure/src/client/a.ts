export function buzz(): void {
  const { vibrate } = navigator;
  vibrate.call(navigator, 30);
}
