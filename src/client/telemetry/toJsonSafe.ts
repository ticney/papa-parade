import {
  JOURNAL_LOG_DATA_MAX_CHARS,
  JOURNAL_LOG_DATA_MAX_DEPTH,
  JOURNAL_LOG_STRING_MAX_CHARS,
} from '@shared/constants';
import { log } from '@shared/log';

const CYCLE = '[cycle]';
const TRUNCATED = '[truncated]';
const UNSERIALIZABLE = '[unserializable]';

/** Marks a value that JSON cannot carry: dropped from an object, `null` in an array. */
const DROPPED = Symbol('dropped');

function convert(value: unknown, ancestors: Set<object>, depth: number): unknown {
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
  if (depth > JOURNAL_LOG_DATA_MAX_DEPTH) return TRUNCATED;
  if (value instanceof Error) {
    return {
      name: convert(value.name, ancestors, depth + 1),
      message: convert(value.message, ancestors, depth + 1),
    };
  }
  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  if (Array.isArray(value)) {
    ancestors.add(value);
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = convert(value[index], ancestors, depth + 1);
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
    let item: unknown;
    try {
      item = convert(record[key], ancestors, depth + 1);
    } catch {
      // A throwing getter costs this key only.
      item = UNSERIALIZABLE;
    }
    // `defineProperty`, not `copy[key] =`: an own `__proto__` key must stay a key.
    if (item !== DROPPED) {
      Object.defineProperty(copy, key, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
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
 * `JOURNAL_LOG_DATA_MAX_CHARS`, or nested deeper than `JOURNAL_LOG_DATA_MAX_DEPTH`, becomes `"[truncated]"`; a
 * value that throws while it is read (getter, revoked proxy) gives `"[unserializable]"`, so this never throws.
 * A value that is itself dropped gives `undefined`.
 */
export function toJsonSafe(value: unknown): unknown {
  try {
    const converted = convert(value, new Set(), 0);
    if (converted === DROPPED) return undefined;
    if (JSON.stringify(converted).length > JOURNAL_LOG_DATA_MAX_CHARS) return TRUNCATED;
    return converted;
  } catch (cause) {
    // Never throws: one bad log entry must not cost the tester the whole journal.
    log.warn('debug', 'a log entry cannot go into the journal', {
      error: cause instanceof Error ? cause.name : typeof cause,
    });
    return UNSERIALIZABLE;
  }
}
