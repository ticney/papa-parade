import { type Feel, FeelSchema } from '@content/schemas/feel';
import { type AppError, err, ok, type Result } from '@shared/result';

/** A deep partial: plain objects merge key by key, arrays and scalars are given whole. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type FeelPatch = DeepPartial<Feel>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** `patch` laid over `base`: objects merge, anything else replaces. Neither argument is changed. */
function merge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) merged[key] = merge(base[key], value);
  return merged;
}

/**
 * The feel with `patch` laid over it, checked by `FeelSchema` (strict: an unknown key, a value out
 * of range or a wrong type is refused). An `err` lists the paths the schema objects to; nothing is
 * applied then. Used by the test API's `setFeel` until story 2.1 brings the journaled `SetFeel`
 * command.
 */
export function applyFeelPatch(feel: Feel, patch: unknown): Result<Feel, AppError> {
  if (!isPlainObject(patch)) {
    return err({ kind: 'feel', message: 'a feel patch must be an object' });
  }
  const parsed = FeelSchema.safeParse(merge(feel, patch));
  if (parsed.success) return ok(parsed.data);
  const problems = parsed.error.issues.map(
    (issue) => `${issue.path.length === 0 ? '(feel)' : issue.path.join('.')}: ${issue.message}`,
  );
  return err({
    kind: 'feel',
    message: `invalid feel patch: ${problems.join('; ')}`,
    cause: parsed.error,
  });
}
