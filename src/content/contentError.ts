import type { AppError } from '@shared/result';

/** One thing wrong in one content file. `jsonPath` is `''` for the root of the file. */
export interface ContentProblem {
  /** Repo-relative path (`content/feel.json`), or the origin of an in-memory value. */
  file: string;
  /** Path of the faulty value inside the file (`timing.windowMs`, `mama.starThresholdPoints[2]`). */
  jsonPath: string;
  message: string;
}

export interface ContentError extends AppError {
  kind: 'content';
  problems: ContentProblem[];
}

/** `content/feel.json › timing.windowMs: message` (no `›` for a problem on the whole file). */
export function formatContentProblem(problem: ContentProblem): string {
  const where = problem.jsonPath === '' ? problem.file : `${problem.file} › ${problem.jsonPath}`;
  return `${where}: ${problem.message}`;
}

/** One line that names the first problem and counts the others. */
export function createContentError(problems: ContentProblem[]): ContentError {
  const [first] = problems;
  const rest = problems.length - 1;
  const head = first === undefined ? 'invalid content' : formatContentProblem(first);
  return {
    kind: 'content',
    message: rest > 0 ? `${head} (+${rest} more)` : head,
    problems,
  };
}
