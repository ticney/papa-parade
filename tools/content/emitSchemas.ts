import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_FILES } from '@content/contentFiles';
import { renderContentJsonSchema } from '@content/jsonSchema';
import { log } from '@shared/log';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMAS_DIR = join(ROOT, 'content', '_schemas');

await mkdir(SCHEMAS_DIR, { recursive: true });
for (const entry of CONTENT_FILES) {
  await writeFile(
    join(SCHEMAS_DIR, `${entry.schemaName}.schema.json`),
    renderContentJsonSchema(entry.schema),
  );
}
log.info('content', 'JSON Schemas written', { files: CONTENT_FILES.length });
