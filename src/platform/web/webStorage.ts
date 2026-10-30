import { err, ok } from '@shared/result';
import type { StorageError, StoragePort } from '../platform.ts';

/** The slice of `Storage` the web platform reads. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function unavailable(key: string, cause: unknown): StorageError {
  return { kind: 'unavailable', key, message: `storage refused "${key}": ${String(cause)}` };
}

/**
 * JSON values in `localStorage` (the only place that may touch it). Every access is in a `try`:
 * a private window or a blocked-site-data setting can throw on a read as well as on a write, and
 * even the `localStorage` getter itself can throw, so `getStorage` is called per access. Never
 * throws; a refusal comes back as an `unavailable` error for the caller to log.
 */
export function createWebStorage(getStorage: () => StorageLike): StoragePort {
  return {
    async get(key) {
      let text: string | null;
      try {
        text = getStorage().getItem(key);
      } catch (cause) {
        return err(unavailable(key, cause));
      }
      if (text === null) return ok(null);
      try {
        return ok(JSON.parse(text) as unknown);
      } catch (cause) {
        return err({
          kind: 'invalid',
          key,
          message: `"${key}" does not hold JSON: ${String(cause)}`,
          raw: text,
        });
      }
    },
    async set(key, value) {
      try {
        getStorage().setItem(key, JSON.stringify(value));
        return ok(undefined);
      } catch (cause) {
        return err(unavailable(key, cause));
      }
    },
    async remove(key) {
      try {
        getStorage().removeItem(key);
        return ok(undefined);
      } catch (cause) {
        return err(unavailable(key, cause));
      }
    },
  };
}

/** The browser's `localStorage`, looked up at each access (the getter itself can throw). */
export function getLocalStorage(): StorageLike {
  return localStorage;
}
