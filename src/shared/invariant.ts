import type { SimMs } from './time.ts';

/** Pushed by {@link clampInvariant} outside strict mode. A `SimEvent` of the sim. */
export interface InvariantViolation {
  type: 'InvariantViolated';
  t: SimMs;
  name: string;
  /** The offending value; a non-finite or non-number value is spelled out so the event stays JSON. */
  value: number | string;
}

/** What `clampInvariant` needs from a step context; a `SimEvent[]` satisfies `events`. */
export interface InvariantContext {
  /** Strict (dev, test, tools): a violation throws. Otherwise it is clamped and reported. */
  readonly strictInvariants: boolean;
  /** Current sim time, stamped on the emitted event. */
  readonly t: SimMs;
  readonly events: { push(event: InvariantViolation): unknown };
}

/** Programmer error guard: always throws when `condition` is false. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant violated: ${message}`);
}

/**
 * Strict everywhere except in a `vite build` (any mode, playtest included): in a build we never
 * crash mid-level. `import.meta.env` is undefined under `tsx`, so tools stay strict.
 */
export function defaultStrictInvariants(): boolean {
  return import.meta.env?.PROD !== true;
}

function describeValue(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return String(value);
}

/**
 * Returns `value` when it is a number in `[min, max]`. Otherwise, in strict mode it throws; else it
 * emits `InvariantViolated` and returns the clamped value (`NaN`, `undefined` or a string become
 * `min`). The check is by type: a string such as `"0.5"` is a violation, not a coerced number.
 */
export function clampInvariant(
  ctx: InvariantContext,
  value: number,
  min: number,
  max: number,
  name: string,
): number {
  if (typeof value === 'number' && value >= min && value <= max) return value;
  if (ctx.strictInvariants) {
    throw new Error(`Invariant violated: ${name} = ${value} is outside [${min}, ${max}]`);
  }
  ctx.events.push({ type: 'InvariantViolated', t: ctx.t, name, value: describeValue(value) });
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return value < min ? min : max;
}

/**
 * Reports a violation that has no number to clamp (a rejected input): in strict mode it throws with
 * `message`; otherwise it emits `InvariantViolated{name, value}` and the caller ignores the input.
 */
export function rejectInvariant(
  ctx: InvariantContext,
  name: string,
  value: number | string,
  message: string,
): void {
  if (ctx.strictInvariants) throw new Error(`Invariant violated: ${message}`);
  ctx.events.push({ type: 'InvariantViolated', t: ctx.t, name, value: describeValue(value) });
}
