import { log } from '@shared/log';
import type { HapticKind, Platform, PlatformTarget } from './platform.ts';
import { createWebHaptics, type NavigatorLike } from './web/webHaptics.ts';

export interface CreatePlatformOptions {
  /** `import.meta.env.VITE_TARGET`: `web`, `ios`, `android`, or unset (= `web`). */
  target: string | undefined;
  /** The vibration of each kind, from `content/feedback.json` (the platform cannot import content). */
  hapticPatternsMs: Readonly<Record<HapticKind, readonly number[]>>;
  /** Default: `globalThis.navigator`. */
  nav?: NavigatorLike;
}

const NATIVE_TARGETS: readonly string[] = ['ios', 'android'] satisfies PlatformTarget[];

/**
 * The platform for the build's target. Today only the web one exists: `ios` and `android` run it
 * too, with a `warn` (Capacitor arrives in E8), and so does a target nobody knows.
 */
export function createPlatform(options: CreatePlatformOptions): Platform {
  const { target, hapticPatternsMs } = options;
  const nav: NavigatorLike =
    options.nav ?? (typeof navigator === 'undefined' ? {} : (navigator as NavigatorLike));
  if (target !== undefined && target !== 'web') {
    log.warn(
      'platform',
      NATIVE_TARGETS.includes(target)
        ? `VITE_TARGET=${target}: the native platform arrives in E8, using the web one`
        : `unknown VITE_TARGET=${target}: using the web platform`,
    );
  }
  const web = createWebHaptics(nav, hapticPatternsMs);
  return {
    haptics: web.haptics,
    capabilities: {
      touch: (nav.maxTouchPoints ?? 0) > 0,
      haptics: web.isSupported,
      target: 'web',
    },
  };
}
