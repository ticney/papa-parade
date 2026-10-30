import type { Haptics } from '@platform/platform';

/**
 * The vibrations behind the player's setting (story 2.8): `isEnabled` is read at each pulse, so a
 * switch in the settings applies to the very next one. The cue still plays its sound and shows its
 * visual twin; only the pulse is dropped. Never throws.
 */
export function createGatedHaptics(haptics: Haptics, isEnabled: () => boolean): Haptics {
  return {
    pulse(kind) {
      if (isEnabled()) haptics.pulse(kind);
    },
  };
}
