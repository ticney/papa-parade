function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function write(value: unknown, path: string, ancestors: Set<object>): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`Not serializable: ${path} is ${value}`);
      return String(value);
    case 'object': {
      if (value === null) return 'null';
      if (ancestors.has(value)) throw new Error(`Not serializable: ${path} is a cycle`);
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const items: string[] = [];
          for (let index = 0; index < value.length; index++) {
            if (!(index in value)) throw new Error(`Not serializable: ${path}[${index}] is a hole`);
            items.push(write(value[index], `${path}[${index}]`, ancestors));
          }
          return `[${items.join(',')}]`;
        }
        if (!isPlainObject(value)) {
          throw new Error(`Not serializable: ${path} is not a plain object`);
        }
        const record = value as Record<string, unknown>;
        const parts = Object.keys(record)
          .sort()
          .map(
            (key) => `${JSON.stringify(key)}:${write(record[key], `${path}.${key}`, ancestors)}`,
          );
        return `{${parts.join(',')}}`;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new Error(`Not serializable: ${path} is of type ${typeof value}`);
  }
}

/**
 * JSON with sorted keys. Throws on anything JSON cannot carry faithfully (`undefined`, `NaN`,
 * `±Infinity`, functions, symbols, `bigint`, `Map`/`Set`, class instances): it is the
 * serializability guard of `World`, of snapshots and of journals.
 */
export function canonicalJson(value: unknown): string {
  return write(value, '$', new Set());
}

/** Deep copy through the canonical form: the copy is guaranteed to be plain JSON data. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

/** cyrb53 (public domain, bryc) of the canonical JSON, as 14 hex chars. Not cryptographic. */
export function hashJson(value: unknown): string {
  const text = canonicalJson(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
