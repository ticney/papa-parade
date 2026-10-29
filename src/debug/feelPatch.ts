import { type Feel, FeelSchema } from '@content/schemas/feel';
import { type AppError, err, ok, type Result } from '@shared/result';
import type { Sim } from '@sim';

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

const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * The first path at which `patch` does not fit the shape of `base` the way the sim's own merge of a
 * `SetFeel` requires (`sim/feel/applyFeelPatch.ts`): a key `base` does not have (a new key of a
 * record such as `physics.kinds.new_kind` included: `FeelSchema` accepts it, the sim drops it), a
 * leaf of another type, an array of another length. `null` when it fits. Mirrors the sim's rule,
 * which it does not export to the debug layer.
 */
function shapeProblem(base: unknown, patch: unknown, path: string): string | null {
  if (isPlainObject(base)) {
    if (!isPlainObject(patch)) return path === '' ? '(feel)' : path;
    for (const key of Object.keys(patch)) {
      const child = path === '' ? key : `${path}.${key}`;
      if (UNSAFE_KEYS.includes(key) || !Object.hasOwn(base, key)) return child;
      const problem = shapeProblem(base[key], patch[key], child);
      if (problem !== null) return problem;
    }
    return null;
  }
  if (Array.isArray(base)) {
    if (!Array.isArray(patch) || patch.length !== base.length) return path;
    for (let i = 0; i < base.length; i++) {
      const problem = shapeProblem(base[i], patch[i], `${path}[${i}]`);
      if (problem !== null) return problem;
    }
    return null;
  }
  return typeof patch === typeof base && patch !== null ? null : path;
}

/**
 * The feel with `patch` laid over it, checked by `FeelSchema` (strict: an unknown key, a value out
 * of range or a wrong type is refused) and by the shape rule of the sim's own merge (no new key of
 * a record: `physics.kinds.new_kind` is refused here as the sim would drop it). An `err` lists the
 * paths the check objects to; nothing is applied then. The test API's `setFeel` and the feel panel
 * check a patch with it before they send the journaled `SetFeel` command (the sim only checks the
 * shape).
 */
export function applyFeelPatch(feel: Feel, patch: unknown): Result<Feel, AppError> {
  if (!isPlainObject(patch)) {
    return err({ kind: 'feel', message: 'a feel patch must be an object' });
  }
  const misfit = shapeProblem(feel, patch, '');
  if (misfit !== null) {
    return err({
      kind: 'feel',
      message: `invalid feel patch: ${misfit}: not a key of the feel, or not of its shape (the sim would drop it)`,
    });
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

/**
 * `patch` laid over `feel` with no value check, or `feel` itself when the patch does not fit its
 * shape (the sim drops such a patch). Neither argument is changed. For what the sim already holds:
 * whatever its values, it will apply it.
 */
export function layFeelPatch(feel: Feel, patch: unknown): Feel {
  if (!isPlainObject(patch) || shapeProblem(feel, patch, '') !== null) return feel;
  return merge(feel, patch) as Feel;
}

/**
 * The feel the running sim will have once the `SetFeel` commands it still holds are applied: its
 * `world.feel` with every queued `SetFeel` (a journal entry due after the sim's time) laid over
 * it, in the order the sim applies them. A change made through the panel or `__PP__.setFeel` is
 * checked against this, not against `world.feel`, which only changes at the next step. An ended
 * level applies nothing, so it is just `world.feel`.
 */
export function effectiveFeel(sim: Sim): Feel {
  const { world } = sim;
  let feel = world.feel;
  if (world.flow.state === 'ended') return feel;
  const queued = sim
    .journal()
    .entries.filter((entry) => entry.command.type === 'SetFeel' && entry.applyAt > world.time.sim)
    .sort((a, b) => a.applyAt - b.applyAt);
  for (const entry of queued) {
    if (entry.command.type === 'SetFeel') feel = layFeelPatch(feel, entry.command.patch);
  }
  return feel;
}
