import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentSource } from '@content/contentSource';
import { err, ok } from '@shared/result';

/** Reads content files from a folder on disk. A read error becomes a `Result` error. */
export function createNodeContentSource(contentDir: string): ContentSource {
  return {
    async read(file) {
      try {
        return ok(await readFile(join(contentDir, file), 'utf8'));
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        return err({ kind: 'content', message: `cannot read ${file}: ${reason}`, cause });
      }
    },
  };
}
