import { execFile } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { FEEL_WRITER_ENDPOINT, FEEL_WRITER_MAX_BODY_BYTES } from '../../src/shared/constants.ts';
import { FEEL_FILE, type FeelWriteDeps, handleFeelWrite } from './feelWrite.ts';

// Imports are relative on purpose: `vite.config.ts` loads this file before the path aliases exist.

/** After its own write, the plugin keeps the page from reloading for this long, in real ms. */
const SELF_WRITE_QUIET_MS = 2000;

/**
 * The text as the project's Biome formats it (`biome format --stdin-file-path`), run from `root` so
 * that `biome.json` applies. Rejects if Biome fails.
 */
export function createBiomeFormatter(root: string): FeelWriteDeps['format'] {
  const bin = resolve(root, 'node_modules', '.bin', 'biome');
  return (text) =>
    new Promise((done, fail) => {
      const child = execFile(
        bin,
        ['format', `--stdin-file-path=${FEEL_FILE}`],
        { cwd: root, maxBuffer: 4 * FEEL_WRITER_MAX_BODY_BYTES },
        (error, stdout, stderr) => {
          if (error) fail(new Error(`biome format failed: ${stderr || error.message}`));
          else done(stdout);
        },
      );
      child.stdin?.end(text);
    });
}

/** Writes `text` to `path` through a temp file and a rename, so a failed write never leaves half a file. */
async function writeWhole(path: string, text: string): Promise<void> {
  const temp = `${path}.pp-write.tmp`;
  await writeFile(temp, text, 'utf8');
  await rename(temp, path);
}

/**
 * `feel-writer` (story 2.1, architecture P6): the debug panel's « Enregistrer » button writes the
 * leaves Geo changed into `content/feel.json`. A dev-server plugin only (`apply: 'serve'`): no
 * build contains it. The dev server is open to the LAN (`server.host`), so the handler answers one
 * path, one file and one schema (see {@link handleFeelWrite}). Its own write does not reload the
 * page: the game keeps running while Geo tunes.
 */
export function feelWriterPlugin(): Plugin {
  let root = process.cwd();
  let lastWriteAtReal = Number.NEGATIVE_INFINITY;
  return {
    name: 'pp-feel-writer',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(FEEL_WRITER_ENDPOINT, (request, response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let isTooBig = false;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > FEEL_WRITER_MAX_BODY_BYTES) isTooBig = true;
          else chunks.push(chunk);
        });
        request.on('end', () => {
          void (async () => {
            const send = (status: number, body: object): void => {
              response.statusCode = status;
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify(body));
            };
            if (isTooBig) {
              send(413, {
                ok: false,
                message: `the request body is over ${FEEL_WRITER_MAX_BODY_BYTES} bytes`,
              });
              return;
            }
            // Loaded here, not at the top: it needs the aliases the running server provides.
            const { feelProblems } = (await server.ssrLoadModule(
              '/tools/vite/feelValidator.ts',
            )) as typeof import('./feelValidator.ts');
            const result = await handleFeelWrite(
              { method: request.method, bodyText: Buffer.concat(chunks).toString('utf8') },
              {
                root,
                readText: (path) => readFile(path, 'utf8'),
                writeText: async (path, text) => {
                  lastWriteAtReal = Date.now();
                  await writeWhole(path, text);
                },
                validate: feelProblems,
                format: createBiomeFormatter(root),
              },
            );
            send(result.status, result.body);
          })().catch((cause: unknown) => {
            server.config.logger.error(`[feel-writer] ${String(cause)}`);
            response.statusCode = 500;
            response.end(JSON.stringify({ ok: false, message: 'the feel-writer failed' }));
          });
        });
      });
    },
    handleHotUpdate({ file }) {
      // The write above is ours: the game already has these values, so no reload (an empty list).
      if (
        resolve(file) === resolve(root, FEEL_FILE) &&
        Date.now() - lastWriteAtReal < SELF_WRITE_QUIET_MS
      ) {
        return [];
      }
      return undefined;
    },
  };
}
