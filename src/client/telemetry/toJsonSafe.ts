import { JOURNAL_LOG_DATA_MAX_CHARS, JOURNAL_LOG_STRING_MAX_CHARS } from '@shared/constants';

const CYCLE = '[cycle]';
const TRUNCATED = '[truncated]';

/** Marks a value that JSON cannot carry: dropped from an object, `null` in an array. */
const DROPPED = Symbol('dropped');

function convert(value: unknown, ancestors: Set<object>): unknown {
  switch (typeof value) {
    case 'string':
      return value.length > JOURNAL_LOG_STRING_MAX_CHARS
        ? `${value.slice(0, JOURNAL_LOG_STRING_MAX_CHARS)}…`
        : value;
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'object':
      break;
    default:
      // undefined, function, symbol, bigint
      return DROPPED;
  }
  if (value === null) return null;
  if (ancestors.has(value)) return CYCLE;
  if (value instanceof Error) {
    return {
      name: convert(value.name, ancestors),
      message: convert(value.message, ancestors),
    };
  }
  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  if (Array.isArray(value)) {
    ancestors.add(value);
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = convert(value[index], ancestors);
      items.push(item === DROPPED ? null : item);
    }
    ancestors.delete(value);
    return items;
  }
  if (prototype !== null && prototype !== Object.prototype) {
    return `[${prototype.constructor?.name || 'Object'}]`;
  }
  ancestors.add(value);
  const record = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    const item = convert(record[key], ancestors);
    if (item !== DROPPED) copy[key] = item;
  }
  ancestors.delete(value);
  return copy;
}

/**
 * Makes the `data` of a log entry safe to put in the exported journal (story 3.3): the result always
 * goes through `JSON.stringify` and a strict schema. `canonicalJson` throws on everything below, by
 * design, so it cannot be used here. An `Error` becomes `{ name, message }`, a cycle `"[cycle]"`, a
 * class instance `"[<constructor name>]"`, a non-finite number its string; `undefined`, functions,
 * symbols and bigints are dropped (an array slot becomes `null`); a string longer than
 * `JOURNAL_LOG_STRING_MAX_CHARS` is cut with `…`; and a whole value whose JSON is longer than
 * `JOURNAL_LOG_DATA_MAX_CHARS` becomes `"[truncated]"`. A value that is itself dropped gives `undefined`.
 */
export function toJsonSafe(value: unknown): unknown {
  const converted = convert(value, new Set());
  if (converted === DROPPED) return undefined;
  if (JSON.stringify(converted).length > JOURNAL_LOG_DATA_MAX_CHARS) return TRUNCATED;
  return converted;
}
