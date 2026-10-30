import { stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { err, ok, type Result } from '@shared/result';

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Why `path` cannot be written as a report file, or `null` when it can: its folder exists and it is not a folder. */
export async function outProblem(path: string): Promise<string | null> {
  const parent = dirname(path);
  try {
    if (!(await stat(parent)).isDirectory()) return `${parent} is not a folder`;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return `the folder ${parent} does not exist`;
    }
    return `cannot use the folder ${parent}: ${reasonOf(cause)}`;
  }
  try {
    if ((await stat(path)).isDirectory()) return `${path} is a folder, not a file`;
  } catch {
    // A file that does not exist yet is the normal case.
  }
  return null;
}

export async function writeText(path: string, text: string): Promise<Result<null, string>> {
  try {
    await writeFile(path, text);
    return ok(null);
  } catch (cause) {
    return err(`cannot write ${path}: ${reasonOf(cause)}`);
  }
}
