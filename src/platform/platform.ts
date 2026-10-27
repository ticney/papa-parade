/**
 * What the game asks of the device it runs on, behind one interface (architecture › Contrats d'API).
 * `storage` (stories 2.7, 2.8) and `lifecycle` (E8) join it with the stories that use them.
 */

/** The same literals as the content schema's `HapticKind`: `platform` cannot import `content`. */
export type HapticKind = 'light' | 'medium' | 'heavy';

export interface Haptics {
  /** A short vibration. Never throws; does nothing where the device cannot vibrate. */
  pulse(kind: HapticKind): void;
}

export type PlatformTarget = 'web' | 'ios' | 'android';

export interface PlatformCapabilities {
  /** The device reports at least one touch point. */
  readonly touch: boolean;
  /** `navigator.vibrate` exists (it says nothing about a motor: a laptop reports `true`). */
  readonly haptics: boolean;
  readonly target: PlatformTarget;
}

export interface Platform {
  readonly haptics: Haptics;
  readonly capabilities: PlatformCapabilities;
}
