import { formatJsonPath } from './jsonPath.ts';

export interface DuplicateKey {
  /** Path of the repeated key (`timing.windowMs`). */
  jsonPath: string;
  key: string;
}

interface Frame {
  kind: 'object' | 'array';
  path: (string | number)[];
  keys: Set<string>;
  /** Next array index. */
  index: number;
  expectKey: boolean;
  pendingKey: string;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function decodeJsonString(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, sequence: string) => {
    if (sequence.length === 5) return String.fromCharCode(Number.parseInt(sequence.slice(1), 16));
    return SIMPLE_ESCAPES[sequence] ?? sequence;
  });
}

/**
 * Finds object keys that appear twice in the same object of a JSON text. `JSON.parse` keeps the
 * last one silently, so this scans the raw text with a small string-aware tokenizer. It never
 * throws: on malformed JSON it reports what it saw before the damage (the caller parses next).
 */
export function findDuplicateKeys(jsonText: string): DuplicateKey[] {
  const found: DuplicateKey[] = [];
  const stack: Frame[] = [];
  const n = jsonText.length;
  let i = 0;

  const valuePath = (): (string | number)[] => {
    const top = stack[stack.length - 1];
    if (top === undefined) return [];
    return top.kind === 'object' ? [...top.path, top.pendingKey] : [...top.path, top.index];
  };

  while (i < n) {
    const c = jsonText[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < n && jsonText[j] !== '"') j += jsonText[j] === '\\' ? 2 : 1;
      const text = decodeJsonString(jsonText.slice(i + 1, j));
      const top = stack[stack.length - 1];
      if (top?.kind === 'object' && top.expectKey) {
        if (top.keys.has(text)) {
          found.push({ jsonPath: formatJsonPath([...top.path, text]), key: text });
        }
        top.keys.add(text);
        top.pendingKey = text;
      }
      i = j + 1;
    } else if (c === '{' || c === '[') {
      const path = valuePath();
      stack.push({
        kind: c === '{' ? 'object' : 'array',
        path,
        keys: new Set(),
        index: 0,
        expectKey: c === '{',
        pendingKey: '',
      });
      i++;
    } else if (c === '}' || c === ']') {
      stack.pop();
      i++;
    } else if (c === ':') {
      const top = stack[stack.length - 1];
      if (top?.kind === 'object') top.expectKey = false;
      i++;
    } else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top?.kind === 'object') top.expectKey = true;
      else if (top?.kind === 'array') top.index++;
      i++;
    } else {
      i++;
    }
  }
  return found;
}
