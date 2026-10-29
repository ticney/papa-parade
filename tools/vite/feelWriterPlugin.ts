import { execFile } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { FEEL_WRITER_ENDPOINT, FEEL_WRITER_MAX_BODY_BYTES } from '../../src/shared/constants.ts';
import { FEEL_FILE, type FeelWriteDeps } from './feelWrite.ts';
import { createFeelWriterMiddleware } from './feelWriteHttp.ts';

// Imports are relative on purpose: `vite.config.ts` loads this file before the path aliases exist.

/** After its own write, the plugin keeps the page from reloading for this long, in real ms. */
const SELF_WRITE_QUIET_MS = 2000;

/** Biome gets this long to format a feel file, in real ms; then it is killed and the save fails. */
const FORMAT_TIMEOUT_MS = 10_000;

/**
 * The text as the project's Biome formats it (`biome format --stdin-file-path`), run from `root` so
 * that `biome.json` applies. Rejects if Biome fails, times out or cannot be started.
 */
export function createBiomeFormatter(root: string): FeelWriteDeps['format'] {
  const bin = resolve(root, 'node_modules', '.bin', 'biome');
  return (text) =>
    new Promise((done, fail) => {
      const child = execFile(
        bin,
        ['format', `--stdin-file-path=${FEEL_FILE}`],
        { cwd: root, maxBuffer: 4 * FEEL_WRITER_MAX_BODY_BYTES, timeout: FORMAT_TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) fail(new Error(`biome format failed: ${stderr || error.message}`));
          else done(stdout);
        },
      );
      // Biome that exits (or never starts) before it read the text makes the write fail with EPIPE.
      child.stdin?.on('error', (cause) => fail(new Error(`biome format failed: ${cause.message}`)));
      child.stdin?.end(text);
    });
}

let tempCounter = 0;

/**
 * Writes `text` to `path` through a uniquely named temp file and a rename, so a failed write never
 * leaves half a file; the temp file is removed when the write or the rename fails.
 */
export async function writeWhole(path: string, text: string): Promise<void> {
  tempCounter += 1;
  const temp = `${path}.pp-write.${process.pid}.${tempCounter}.tmp`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, path);
  } catch (cause) {
    try {
      await rm(temp, { force: true });
    } catch (cleanup) {
      const reason = cleanup instanceof Error ? cleanup.message : String(cleanup);
      throw new Error(
        `${cause instanceof Error ? cause.message : String(cause)} (and ${temp} was not removed: ${reason})`,
      );
    }
    throw cause;
  }
}

/**
 * `feel-writer` (story 2.1, architecture P6): the debug panel's « Enregistrer » button writes the
 * leaves Geo changed into `content/feel.json`. A dev-server plugin only (`apply: 'serve'`): no
 * build contains it. The dev server is open to the LAN (`server.host`), so the handler answers one
 * path, one file and one schema, and only a request that carries the panel's marks (JSON content
 * type, custom header, same origin; see `createFeelWriterMiddleware`). Its own write does not reload
 * the page: the game keeps running while Geo tunes.
 *
 * `formatRoot` is where Biome and its `biome.json` are found (the project root by default; a test
 * that writes in a temp folder points it at the repo).
 */
export function feelWriterPlugin(options: { formatRoot?: string } = {}): Plugin {
  let root = process.cwd();
  let lastWriteAtReal = Number.NEGATIVE_INFINITY;
  return {
    name: 'pp-feel-writer',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const middleware = createFeelWriterMiddleware({
        // Called once the request passed the method, origin, content type and header checks.
        loadDeps: async () => {
          // Loaded here, not at the top: the validator needs the aliases the running server provides.
          const { feelProblems } = (await server.ssrLoadModule(
            '/tools/vite/feelValidator.ts',
          )) as typeof import('./feelValidator.ts');
          return {
            root,
            readText: (path) => readFile(path, 'utf8'),
            writeText: async (path, text) => {
              lastWriteAtReal = Date.now();
              await writeWhole(path, text);
              lastWriteAtReal = Date.now();
            },
            validate: feelProblems,
            format: createBiomeFormatter(options.formatRoot ?? root),
          };
        },
        onError: (cause) => server.config.logger.error(`[feel-writer] ${String(cause)}`),
      });
      server.middlewares.use(FEEL_WRITER_ENDPOINT, middleware);
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
