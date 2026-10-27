// The platform layer is the one place that may call navigator.vibrate.
export function pulse(nav: { vibrate?: (pattern: number[]) => boolean }): void {
  nav.vibrate?.([15]);
}
