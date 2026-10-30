import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface OutputPath {
  flag: string;
  path: string;
}

export interface InputPath {
  label: string;
  path: string;
}

/**
 * Why the report files cannot be written where asked, or `null`: two outputs on one file, an output
 * over an input (the notes), or an output inside the journals folder (the next run would read it as
 * a journal). Pure: paths are compared once resolved, nothing is read.
 */
export function outputConflict(
  outputs: readonly OutputPath[],
  journalsDir: string,
  inputs: readonly InputPath[],
): string | null {
  const dir = resolve(journalsDir);
  for (const [index, output] of outputs.entries()) {
    const path = resolve(output.path);
    const inside = relative(dir, path);
    const escapes = inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside);
    if (!escapes) {
      return `${output.flag} ${output.path} is inside the journals folder ${journalsDir}: the next run would read it as a journal`;
    }
    for (const input of inputs) {
      if (resolve(input.path) === path) {
        return `${output.flag} ${output.path} is the ${input.label}: it would be overwritten`;
      }
    }
    for (const other of outputs.slice(index + 1)) {
      if (resolve(other.path) === path) {
        return `${output.flag} and ${other.flag} are the same file ${output.path}`;
      }
    }
  }
  return null;
}
