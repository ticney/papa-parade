import { err, ok, type Result } from '@shared/result';
import type { ContentBundle } from './contentBundle.ts';
import { type ContentError, type ContentProblem, createContentError } from './contentError.ts';
import {
  BOTS_FILE,
  type ContentFile,
  FEEDBACK_FILE,
  FEEL_FILE,
  STRINGS_FILE,
} from './contentFiles.ts';
import type { ContentSource } from './contentSource.ts';
import { parseContentFile } from './parseContentFile.ts';
import { checkStringReferences } from './stringRefs.ts';

async function loadFile<T>(
  source: ContentSource,
  entry: ContentFile<T>,
): Promise<Result<T, ContentProblem[]>> {
  const file = `content/${entry.file}`;
  // A source honours its Result contract; a rejection is a bug in the source, still reported as a problem.
  const text = await Promise.resolve(source.read(entry.file)).catch((cause: unknown) =>
    err({
      kind: 'content' as const,
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  );
  if (!text.ok) return err([{ file, jsonPath: '', message: text.error.message }]);
  return parseContentFile(file, text.value, entry.schema);
}

/**
 * Reads, parses and validates every registered content file. It collects the problems of all the
 * files (it does not stop at the first), then checks that every string key a content file points
 * at exists. Never throws and never logs: the caller logs.
 */
export async function loadContent(
  source: ContentSource,
): Promise<Result<ContentBundle, ContentError>> {
  const [feel, feedback, bots, strings] = await Promise.all([
    loadFile(source, FEEL_FILE),
    loadFile(source, FEEDBACK_FILE),
    loadFile(source, BOTS_FILE),
    loadFile(source, STRINGS_FILE),
  ]);

  const problems: ContentProblem[] = [];
  if (!feel.ok) problems.push(...feel.error);
  if (!feedback.ok) problems.push(...feedback.error);
  if (!bots.ok) problems.push(...bots.error);
  if (!strings.ok) problems.push(...strings.error);

  if (strings.ok) {
    // The strings file itself is exempt: it is the target of the references.
    const loaded = [
      ...(feel.ok ? [{ file: `content/${FEEL_FILE.file}`, value: feel.value }] : []),
      ...(feedback.ok ? [{ file: `content/${FEEDBACK_FILE.file}`, value: feedback.value }] : []),
    ];
    problems.push(...checkStringReferences(loaded, strings.value, `content/${STRINGS_FILE.file}`));
  }

  if (problems.length > 0 || !feel.ok || !feedback.ok || !bots.ok || !strings.ok) {
    return err(createContentError(problems));
  }
  return ok({
    feel: feel.value,
    feedback: feedback.value,
    bots: bots.value,
    strings: strings.value,
  });
}
