import { err, ok, type Result } from '@shared/result';
import { type ContentError, createContentError } from './contentError.ts';
import { issueToProblems } from './parseContentFile.ts';
import { type Feel, FeelSchema } from './schemas/feel.ts';

/** Nested objects become optional; arrays and scalars stay whole (an override replaces them). */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** What a level may declare in `feelOverrides` (story 1.10). */
export type FeelOverrides = DeepPartial<Feel>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Keys come from parsed JSON, where `__proto__` is an ordinary own property: copy with
// `defineProperty` so it stays one and never reaches `Object.prototype`.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) setOwn(copy, key, clone(child));
    return copy;
  }
  return value;
}

function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return clone(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) setOwn(merged, key, clone(value));
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    setOwn(merged, key, merge(Object.hasOwn(base, key) ? base[key] : undefined, value));
  }
  return merged;
}

/**
 * The effective feel of a level: `base` (feel.json) deep-merged with the level's overrides, then
 * validated by `FeelSchema` (unknown key, wrong type or broken cross-field rule are rejected and
 * reported with `origin` as the file). Plain objects merge, arrays and scalars are replaced, the
 * inputs are never mutated and the result shares nothing with them.
 */
export function mergeFeel(
  base: Feel,
  overrides: unknown,
  origin = 'feelOverrides',
): Result<Feel, ContentError> {
  if (!isPlainObject(overrides)) {
    return err(
      createContentError([
        { file: origin, jsonPath: '', message: 'feel overrides must be an object' },
      ]),
    );
  }
  const parsed = FeelSchema.safeParse(merge(base, overrides));
  if (!parsed.success) {
    return err(
      createContentError(parsed.error.issues.flatMap((issue) => issueToProblems(origin, issue))),
    );
  }
  return ok(parsed.data);
}
