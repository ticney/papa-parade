import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** content/strings.fr.json, read from disk: what the UI must show, key by key. */
export const STRINGS: Record<string, string> = JSON.parse(
  readFileSync(join(here, '..', '..', '..', 'content', 'strings.fr.json'), 'utf8'),
);
