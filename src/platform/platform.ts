/**
 * What the game asks of the device it runs on, behind one interface (architecture › Contrats d'API).
 * `lifecycle` (E8) joins it with the story that uses it.
 */

import type { Result } from '@shared/result';

/** The same literals as the content schema's `HapticKind`: `platform` cannot import `content`. */
export type HapticKind = 'light' | 'medium' | 'heavy' | 'heartbeat';

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

/** What a storage call can go wrong with: the value did not parse, or the device refused. */
export interface StorageError {
  kind: 'unavailable' | 'invalid';
  key: string;
  message: string;
  /** With `invalid`: the stored text that did not parse, so that a caller can set it aside. */
  raw?: string;
}

/**
 * Small persistent key-value storage for JSON values (architecture › Persistance). Async so that a
 * native implementation (E8) can slot in; every call returns a `Result` and never throws, since a
 * private window can throw on any access.
 */
export interface StoragePort {
  /** The stored value, or `null` when the key is absent. `invalid` when the stored text is not JSON. */
  get(key: string): Promise<Result<unknown | null, StorageError>>;
  set(key: string, value: unknown): Promise<Result<void, StorageError>>;
  remove(key: string): Promise<Result<void, StorageError>>;
}

export interface Platform {
  readonly haptics: Haptics;
  readonly storage: StoragePort;
  readonly capabilities: PlatformCapabilities;
}
