import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatContentProblem } from '@content/contentError';
import { log } from '@shared/log';
import { checkContent, listContentFiles } from './contentChecks.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const problems = await checkContent(ROOT);
if (problems.length > 0) {
  for (const problem of problems) log.error('content', formatContentProblem(problem));
  log.error('content', `${problems.length} content problem(s)`);
  process.exitCode = 1;
} else {
  log.info('content', 'content OK', { files: (await listContentFiles(ROOT)).length });
}
