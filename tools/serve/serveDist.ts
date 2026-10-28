import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, posix, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { type HeaderRule, headersFor, parseHeaders } from './headers.ts';

const USAGE = 'usage: npm run serve:dist -- [--dir dist] [--port n] [--host]';
const DEFAULT_PORT = 4173;

/** The content types the built game needs; anything else is sent as opaque bytes. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The files a host never publishes: the `_headers` rules are for the host, not for the visitor. */
const HOST_ONLY_FILES: readonly string[] = ['_headers', '_redirects'];

export function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export interface ServeArgs {
  dir: string;
  port: number;
  /** `--host`: listen on every interface, so a phone on the LAN can open it. */
  isLan: boolean;
}

/** Reads `--dir <folder>` (default `dist`), `--port <n>` (default 4173, 0 = any free port) and `--host`. */
export function parseServeArgs(argv: readonly string[]): Result<ServeArgs, string> {
  const args: ServeArgs = { dir: 'dist', port: DEFAULT_PORT, isLan: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--host') {
      args.isLan = true;
    } else if (arg === '--dir' || arg === '--port') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--'))
        return err(`${arg} needs a value. ${USAGE}`);
      if (arg === '--dir') {
        args.dir = value;
      } else {
        const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
        if (!Number.isInteger(port) || port > 65535) {
          return err(`--port must be an integer in [0, 65535], got "${value}". ${USAGE}`);
        }
        args.port = port;
      }
    } else {
      return err(`unknown argument "${arg}". ${USAGE}`);
    }
  }
  return ok(args);
}

/**
 * `urlPath` decoded and normalised once (`//a`, `/./a` and `/%61` all read `/a`), the form that the
 * header rules, the host-only guard and the file lookup all use; `null` for a malformed escape, a
 * NUL byte, a backslash or a `..` segment. Pure.
 */
export function normalizeUrlPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded.split('/').includes('..')) return null;
  const normalized = posix.normalize(decoded);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * The file `urlPath` names inside `root`, or `null` when it would leave it (a `..` segment, a NUL
 * byte, a malformed escape). `/` is `index.html`. Pure: the disk is not touched.
 */
export function fileForUrlPath(root: string, urlPath: string): string | null {
  const decoded = normalizeUrlPath(urlPath);
  if (decoded === null) return null;
  const relative = decoded === '/' ? '/index.html' : decoded;
  const absoluteRoot = resolve(root);
  const file = resolve(absoluteRoot, `.${relative}`);
  return file.startsWith(absoluteRoot + sep) ? file : null;
}

/** True when `file` is one of the host-only files of `root` (compared case-insensitively: macOS disks are). */
function isHostOnly(root: string, file: string): boolean {
  const absoluteRoot = resolve(root);
  return HOST_ONLY_FILES.some(
    (name) => file.toLowerCase() === resolve(absoluteRoot, name).toLowerCase(),
  );
}

/**
 * A static server for a built folder that behaves like the host: it applies the rules of
 * `rules` (the folder's `_headers`) to every response, serves `index.html` for `/`, never serves
 * `_headers` itself, answers 404 for a missing file and 403 for a path that escapes the folder.
 * `GET` and `HEAD` only. No cache headers: a test must never see a stale build.
 */
export function createDistServer(root: string, rules: readonly HeaderRule[]): Server {
  return createServer((request, response) => {
    const rawPath = (request.url ?? '/').split('?')[0]?.split('#')[0] ?? '/';
    const urlPath = normalizeUrlPath(rawPath) ?? rawPath;
    const send = (status: number, extra: Record<string, string | number> = {}, body?: string) => {
      response.writeHead(status, { ...headersFor(rules, urlPath), ...extra });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(405, { allow: 'GET, HEAD' });
      return;
    }
    const file = fileForUrlPath(root, rawPath);
    if (file === null) {
      send(403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');
      return;
    }
    if (isHostOnly(root, file)) {
      send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
      return;
    }
    stat(file).then(
      (info) => {
        if (!info.isFile()) {
          send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
          return;
        }
        response.writeHead(200, {
          ...headersFor(rules, urlPath),
          'content-type': mimeTypeFor(file),
          'content-length': info.size,
          'cache-control': 'no-store',
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        // `pipeline` destroys the file stream when the client aborts, so no descriptor lingers.
        pipeline(createReadStream(file), response, (cause) => {
          if (cause && cause.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
            log.warn('assets', `cannot send ${file}`, cause);
          }
        });
      },
      (cause: NodeJS.ErrnoException) => {
        if (cause.code !== 'ENOENT' && cause.code !== 'ENOTDIR') {
          log.warn('assets', `cannot stat ${file}`, cause);
        }
        send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
      },
    );
  });
}

/** Reads `<dir>/_headers`; a folder without one is an `err` (a host would serve no CSP). */
export async function readHeaderRules(dir: string): Promise<Result<HeaderRule[], string>> {
  let text: string;
  try {
    text = await readFile(join(dir, '_headers'), 'utf8');
  } catch (cause) {
    return err(
      `cannot read ${dir}/_headers: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return parseHeaders(text);
}

async function main(): Promise<void> {
  const fail = (message: string): void => {
    log.error('assets', message);
    process.exitCode = 1;
  };
  const args = parseServeArgs(process.argv.slice(2));
  if (!args.ok) return fail(args.error);
  const { dir, port, isLan } = args.value;
  const rules = await readHeaderRules(dir);
  if (!rules.ok) return fail(rules.error);
  const server = createDistServer(dir, rules.value);
  server.on('error', (cause) => fail(`cannot listen on port ${port}: ${cause.message}`));
  server.listen(port, isLan ? '0.0.0.0' : '127.0.0.1', () => {
    const address = server.address();
    const where = typeof address === 'object' && address !== null ? address.port : port;
    log.info('assets', 'serving the built folder', {
      dir,
      url: `http://${isLan ? '0.0.0.0' : '127.0.0.1'}:${where}/`,
    });
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
