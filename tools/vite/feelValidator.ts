import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';

/**
 * The paths and messages `FeelSchema` objects to in this feel, or `[]`: what the `feel-writer`
 * checks before it writes. Kept apart from the plugin because it needs the path aliases, which
 * `vite.config.ts` does not have when it loads: the plugin gets this module from the running dev
 * server (`ssrLoadModule`), and the tests import it directly.
 */
export function feelProblems(feel: unknown): string[] {
  const parsed = parseContentFile('content/feel.json', JSON.stringify(feel), FeelSchema);
  return parsed.ok ? [] : parsed.error.map(formatContentProblem);
}
