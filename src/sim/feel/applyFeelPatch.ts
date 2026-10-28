import type { Feel } from '@content/schemas/feel';
import { cloneJson } from '@shared/hash';

/** A deep partial: plain objects merge key by key, arrays and scalars are given whole. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** What a `SetFeel` command carries: the leaves of the feel to change. */
export type FeelPatch = DeepPartial<Feel>;

/** Keys that could reach `Object.prototype` through a careless merge. */
export const UNSAFE_PATCH_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const MISMATCH = Symbol('mismatch');

/**
 * `patch` laid over `base`, or `MISMATCH` when it does not fit `base`'s shape: an unknown key, a
 * leaf of another type, an array of another length. Nothing is changed; the result shares nothing
 * with `base` except scalars.
 */
function mergeShaped(base: unknown, patch: unknown): unknown {
  if (isPlainObject(base)) {
    if (!isPlainObject(patch)) return MISMATCH;
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(base)) merged[key] = cloneJson(base[key]);
    for (const key of Object.keys(patch)) {
      if (UNSAFE_PATCH_KEYS.includes(key) || !Object.hasOwn(base, key)) return MISMATCH;
      const value = mergeShaped(base[key], patch[key]);
      if (value === MISMATCH) return MISMATCH;
      merged[key] = value;
    }
    return merged;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(patch) || patch.length !== base.length) return MISMATCH;
    const items: unknown[] = [];
    for (let i = 0; i < base.length; i++) {
      // A whole array is given, so each item replaces its twin: it must be of the same kind.
      const item = mergeShaped(base[i], patch[i]);
      if (item === MISMATCH) return MISMATCH;
      items.push(item);
    }
    return items;
  }
  if (typeof patch !== typeof base || patch === null) return MISMATCH;
  return patch;
}

/**
 * The sim's own merge of a `SetFeel` patch onto the effective feel (the sim may not value-import
 * `@content`, so it cannot run `FeelSchema`; ranges and cross-field rules are the sender's job).
 * Returns a new feel, or `null` when the patch does not fit the feel's shape: an unknown key at any
 * depth, a `__proto__`/`constructor`/`prototype` key, a leaf whose type differs, an array of another
 * length. `feel` is never changed.
 */
export function applyFeelPatch(feel: Feel, patch: unknown): Feel | null {
  const merged = mergeShaped(feel, patch);
  return merged === MISMATCH ? null : (merged as Feel);
}

/**
 * Why `actual` is not shaped like `expected` (the same keys at every depth, leaves of the same
 * type, arrays of the same length), or `null`. Used to check the feel a snapshot carries against the
 * feel the sim was created with; values are not range-checked here.
 */
export function feelShapeProblem(expected: unknown, actual: unknown, path: string): string | null {
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return path;
    const keys = Object.keys(expected);
    if (Object.keys(actual).length !== keys.length) return path;
    for (const key of keys) {
      if (!Object.hasOwn(actual, key)) return `${path}.${key}`;
      const problem = feelShapeProblem(expected[key], actual[key], `${path}.${key}`);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return path;
    for (let i = 0; i < expected.length; i++) {
      const problem = feelShapeProblem(expected[i], actual[i], `${path}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (typeof actual !== typeof expected) return path;
  if (typeof actual === 'number' && !Number.isFinite(actual)) return path;
  return null;
}
