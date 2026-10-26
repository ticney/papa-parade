import type { ContentProblem } from './contentError.ts';
import { formatJsonPath } from './jsonPath.ts';

export interface StringKeyReference {
  jsonPath: string;
  key: string;
}

// A content file points at a string with a `…Key` property (`verbKey`, `labelKey`); a literal UI
// string in a content file is a review failure.
const KEY_PROPERTY = /[a-z0-9]Key$/;

/** Every string stored under a property whose name ends in `Key`, anywhere in parsed JSON. */
export function findStringKeyReferences(value: unknown): StringKeyReference[] {
  const found: StringKeyReference[] = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, [...path, index]);
      });
    } else if (typeof node === 'object' && node !== null) {
      for (const [name, child] of Object.entries(node)) {
        if (typeof child === 'string' && KEY_PROPERTY.test(name)) {
          found.push({ jsonPath: formatJsonPath([...path, name]), key: child });
        } else {
          walk(child, [...path, name]);
        }
      }
    }
  };
  walk(value, []);
  return found;
}

/** The references whose key is not in the strings file. */
export function findMissingStringKeys(
  references: readonly StringKeyReference[],
  strings: Readonly<Record<string, string>>,
): StringKeyReference[] {
  return references.filter(({ key }) => !Object.hasOwn(strings, key));
}

/**
 * One problem per reference, in the given parsed content files, whose key is not in the strings.
 * `stringsFile` only names the strings file in the message. The strings file itself is not scanned.
 */
export function checkStringReferences(
  files: readonly { file: string; value: unknown }[],
  strings: Readonly<Record<string, string>>,
  stringsFile: string,
): ContentProblem[] {
  return files.flatMap(({ file, value }) =>
    findMissingStringKeys(findStringKeyReferences(value), strings).map(({ jsonPath, key }) => ({
      file,
      jsonPath,
      message: `string key "${key}" is not in ${stringsFile}`,
    })),
  );
}
