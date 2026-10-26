import { err, ok, type Result } from '@shared/result';
import type { z } from 'zod';
import type { ContentProblem } from './contentError.ts';
import { findDuplicateKeys } from './duplicateKeys.ts';
import { formatJsonPath } from './jsonPath.ts';

const BYTE_ORDER_MARK = 0xfeff;

function withoutSchemaKey(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema'));
}

/** Zod issues → problems. An unknown key is reported once per key, with the key in the path. */
export function issueToProblems(file: string, issue: z.core.$ZodIssue): ContentProblem[] {
  if (issue.code === 'unrecognized_keys') {
    // The path names the parent object; the offending keys are in `issue.keys`.
    return issue.keys.map((key) => ({
      file,
      jsonPath: formatJsonPath([...issue.path, key]),
      message: `unknown key "${key}" (the schema is strict: add it to the schema first)`,
    }));
  }
  if (issue.code === 'invalid_key') {
    // The useful message (for example "a string key is group.lower_snake_case") is nested.
    return issue.issues.map((inner) => ({
      file,
      jsonPath: formatJsonPath(issue.path),
      message: inner.message,
    }));
  }
  return [{ file, jsonPath: formatJsonPath(issue.path), message: issue.message }];
}

/**
 * Parses the text of one content file and validates it against its schema. Every problem carries
 * the file and the JSON path of the faulty value; a top-level `$schema` key (editor autocomplete)
 * is ignored. Never throws.
 */
export function parseContentFile<T>(
  file: string,
  text: string,
  schema: z.ZodType<T>,
): Result<T, ContentProblem[]> {
  const source = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;

  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err([{ file, jsonPath: '', message: `not valid JSON: ${message}` }]);
  }

  const problems: ContentProblem[] = findDuplicateKeys(source).map(({ jsonPath, key }) => ({
    file,
    jsonPath,
    message: `duplicate key "${key}" (JSON.parse would silently keep the last one)`,
  }));

  const parsed = schema.safeParse(withoutSchemaKey(json));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(...issueToProblems(file, issue));
  }

  if (problems.length > 0 || !parsed.success) return err(problems);
  return ok(parsed.data);
}
