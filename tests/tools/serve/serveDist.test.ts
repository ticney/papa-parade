import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseHeaders } from '../../../tools/serve/headers.ts';
import {
  createDistServer,
  fileForUrlPath,
  mimeTypeFor,
  normalizeUrlPath,
  parseServeArgs,
  readHeaderRules,
} from '../../../tools/serve/serveDist.ts';

describe('parseServeArgs', () => {
  it('defaults to dist on 4173, this machine only', () => {
    expect(parseServeArgs([])).toEqual({
      ok: true,
      value: { dir: 'dist', port: 4173, isLan: false },
    });
  });

  it('reads --dir, --port and --host', () => {
    expect(parseServeArgs(['--dir', 'out', '--port', '6180', '--host'])).toEqual({
      ok: true,
      value: { dir: 'out', port: 6180, isLan: true },
    });
  });

  it.each([
    [['--port']],
    [['--port', 'abc']],
    [['--port', '70000']],
    [['--port', '1.5']],
    [['--port', '']],
    [['--port', ' ']],
    [['--port', '0x10']],
    [['--port', '1e3']],
    [['--port', '-1']],
    [['--dir']],
    [['--nope']],
  ])('rejects %j', (argv) => {
    expect(parseServeArgs(argv).ok).toBe(false);
  });
});

describe('mimeTypeFor', () => {
  it.each([
    ['a.js', 'text/javascript; charset=utf-8'],
    ['a.wasm', 'application/wasm'],
    ['a.woff2', 'font/woff2'],
    ['a.m4a', 'audio/mp4'],
    ['a.glb', 'model/gltf-binary'],
    ['a.svg', 'image/svg+xml'],
    ['a.css', 'text/css; charset=utf-8'],
    ['a.json', 'application/json; charset=utf-8'],
    ['index.html', 'text/html; charset=utf-8'],
    ['A.JS', 'text/javascript; charset=utf-8'],
    ['a.unknown', 'application/octet-stream'],
  ])('%s is %s', (path, type) => {
    expect(mimeTypeFor(path)).toBe(type);
  });
});

describe('fileForUrlPath', () => {
  const root = join(tmpdir(), 'pp-root');
  it('maps a path under the root, and / to index.html', () => {
    expect(fileForUrlPath(root, '/assets/a.js')).toBe(join(root, 'assets', 'a.js'));
    expect(fileForUrlPath(root, '/')).toBe(join(root, 'index.html'));
  });

  it.each([
    ['/../secret'],
    ['/a/../../secret'],
    ['/%2e%2e/secret'],
    ['/a%00b'],
    ['/a%5c..%5cb'],
    ['/%zz'],
  ])('refuses %s', (path) => {
    expect(fileForUrlPath(root, path)).toBeNull();
  });
});

describe('normalizeUrlPath', () => {
  it.each([
    ['/a', '/a'],
    ['//a', '/a'],
    ['/./a', '/a'],
    ['/%61', '/a'],
    ['/a//b/./c', '/a/b/c'],
    ['/', '/'],
  ])('%s reads %s', (path, expected) => {
    expect(normalizeUrlPath(path)).toBe(expected);
  });

  it.each([['/../a'], ['/a%00'], ['/%zz'], ['/a%5cb']])('refuses %s', (path) => {
    expect(normalizeUrlPath(path)).toBeNull();
  });
});

describe('the server', () => {
  let dir: string;
  let server: Server;
  let port: number;

  const get = (path: string, method = 'GET') =>
    new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
      (resolve, reject) => {
        // `request` sends the path as written: `fetch` would normalise `/../` away.
        const outgoing = request({ host: '127.0.0.1', port, path, method }, (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        });
        outgoing.on('error', reject);
        outgoing.end();
      },
    );

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-serve-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<html>home</html>');
    await writeFile(join(dir, 'assets', 'a.js'), 'export {};');
    await writeFile(join(dir, 'assets', 'level.glb'), 'glTF');
    await writeFile(
      join(dir, '_headers'),
      "/*\n  X-Everywhere: yes\n  Content-Security-Policy: default-src 'self'\n/assets/*\n  X-Assets: yes\n",
    );
    const rules = await readHeaderRules(dir);
    if (!rules.ok) throw new Error(rules.error);
    server = createDistServer(dir, rules.value);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('serves index.html for /, with the rules of _headers and its content type', async () => {
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.body).toBe('<html>home</html>');
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['x-everywhere']).toBe('yes');
    expect(response.headers['content-security-policy']).toBe("default-src 'self'");
    expect(response.headers['x-assets']).toBeUndefined();
  });

  it('applies a specific rule on top, and the right content type', async () => {
    const js = await get('/assets/a.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['x-assets']).toBe('yes');
    expect(js.headers['x-everywhere']).toBe('yes');
    expect((await get('/assets/level.glb')).headers['content-type']).toBe('model/gltf-binary');
  });

  it('ignores the query string', async () => {
    expect((await get('/assets/a.js?v=1')).status).toBe(200);
  });

  it('answers 404 for a missing file and for a folder, with the headers still on', async () => {
    const missing = await get('/nope.js');
    expect(missing.status).toBe(404);
    expect(missing.headers['x-everywhere']).toBe('yes');
    expect((await get('/assets')).status).toBe(404);
  });

  it('never serves _headers itself, however the path is written', async () => {
    await writeFile(join(dir, '_redirects'), '/a /b 302\n');
    for (const path of [
      '/_headers',
      '//_headers',
      '/./_headers',
      '/%5Fheaders',
      '/_HEADERS',
      '/_redirects',
      '/assets/../_headers',
    ]) {
      const status = (await get(path)).status;
      expect(status === 404 || status === 403, path).toBe(true);
    }
  });

  it('matches the header rules on the normalised path', async () => {
    expect((await get('/%61ssets/a.js')).headers['x-assets']).toBe('yes');
  });

  it('refuses a path that escapes the folder', async () => {
    expect((await get('/../package.json')).status).toBe(403);
    expect((await get('/%2e%2e/package.json')).status).toBe(403);
    expect((await get('/assets/../../package.json')).status).toBe(403);
  });

  it('answers HEAD with the headers and no body, and refuses other methods', async () => {
    const head = await get('/assets/a.js', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('10');
    expect(head.body).toBe('');
    const post = await get('/', 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });
});

describe('readHeaderRules', () => {
  it('is an err for a folder with no _headers', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'pp-serve-empty-'));
    try {
      const rules = await readHeaderRules(empty);
      expect(rules.ok).toBe(false);
      if (!rules.ok) expect(rules.error).toContain('_headers');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('is an err for a _headers that does not parse', async () => {
    expect(parseHeaders('nonsense\n').ok).toBe(false);
    const bad = await mkdtemp(join(tmpdir(), 'pp-serve-bad-'));
    try {
      await writeFile(join(bad, '_headers'), 'nonsense\n');
      expect((await readHeaderRules(bad)).ok).toBe(false);
    } finally {
      await rm(bad, { recursive: true, force: true });
    }
  });
});
