import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FEEL_WRITER_ENDPOINT,
  FEEL_WRITER_HEADER,
  FEEL_WRITER_HEADER_VALUE,
  FEEL_WRITER_MAX_BODY_BYTES,
} from '@shared/constants';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { feelProblems } from '../../../tools/vite/feelValidator.ts';
import { FEEL_FILE, type FeelWriteDeps } from '../../../tools/vite/feelWrite.ts';
import { createFeelWriterMiddleware, gateFeelRequest } from '../../../tools/vite/feelWriteHttp.ts';
import {
  createBiomeFormatter,
  feelWriterPlugin,
  writeWhole,
} from '../../../tools/vite/feelWriterPlugin.ts';

// The HTTP layer of the feel-writer (story 2.1 review): the checks of the request, the streamed
// body, the queue, the temp file, and the plugin's own wiring, on a throwaway `http.Server` and a
// temp folder. The sample is a literal file, not the live `content/feel.json`.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const sampleText = await readFile(join(here, 'fixtures', 'feelSample.json'), 'utf8');
const sample = JSON.parse(sampleText) as { timing: { windowMs: number; hitstopMs: number } };

const GOOD_HEADERS = {
  'content-type': 'application/json',
  [FEEL_WRITER_HEADER]: FEEL_WRITER_HEADER_VALUE,
};
const body = (patch: object): string => JSON.stringify({ file: FEEL_FILE, patch });

interface Answer {
  status: number;
  json: { ok: boolean; message: string; changed?: string[] } | null;
}

let root: string;
let target: string;
let server: Server | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-feel-writer-http-'));
  target = join(root, FEEL_FILE);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, sampleText, 'utf8');
});

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((done) => (server === null ? done() : server.close(() => done())));
  server = null;
  await rm(root, { recursive: true, force: true });
});

const onDisk = (): Promise<string> => readFile(target, 'utf8');
const folderEntries = (): Promise<string[]> => readdir(dirname(target));

const realDeps = (overrides: Partial<FeelWriteDeps> = {}): FeelWriteDeps => ({
  root,
  readText: (path) => readFile(path, 'utf8'),
  writeText: writeWhole,
  validate: feelProblems,
  format: createBiomeFormatter(repoRoot),
  ...overrides,
});

interface Hosted {
  port: number;
  loads: number;
  errors: unknown[];
}

/** Hosts the middleware on a throwaway server; `loads` counts how often the deps were needed. */
async function host(deps: () => FeelWriteDeps = realDeps): Promise<Hosted> {
  const hosted: Hosted = { port: 0, loads: 0, errors: [] };
  const middleware = createFeelWriterMiddleware({
    loadDeps: async () => {
      hosted.loads += 1;
      return deps();
    },
    onError: (cause) => hosted.errors.push(cause),
  });
  await listen(middleware, hosted);
  return hosted;
}

async function listen(
  handler: (request: IncomingMessage, response: import('node:http').ServerResponse) => void,
  hosted: Hosted,
): Promise<void> {
  server = createServer(handler);
  await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
  hosted.port = (server.address() as AddressInfo).port;
}

/** One request; `chunks` are written one after the other (a streamed body). Resolves with the answer. */
function send(
  port: number,
  options: {
    method?: string;
    headers?: Record<string, string>;
    chunks?: string[];
    path?: string;
  },
): Promise<Answer> {
  return new Promise((done, fail) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? FEEL_WRITER_ENDPOINT,
        method: options.method ?? 'POST',
        headers: options.headers ?? GOOD_HEADERS,
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          done({ status: response.statusCode ?? 0, json: text === '' ? null : JSON.parse(text) });
        });
      },
    );
    request.on('error', fail);
    for (const chunk of options.chunks ?? []) request.write(chunk);
    request.end();
  });
}

const post = (
  port: number,
  patch: object,
  headers: Record<string, string> = GOOD_HEADERS,
): Promise<Answer> => send(port, { headers, chunks: [body(patch)] });

describe('gateFeelRequest', () => {
  const ok = { method: 'POST', headers: { ...GOOD_HEADERS, host: 'localhost:5173' } };

  it('lets a well formed same-origin request through, with or without an Origin', () => {
    expect(gateFeelRequest(ok)).toBeNull();
    const origin = { ...ok, headers: { ...ok.headers, origin: 'http://localhost:5173' } };
    expect(gateFeelRequest(origin)).toBeNull();
  });

  it('accepts a media type with parameters and any case', () => {
    const headers = { ...ok.headers, 'content-type': 'Application/JSON; charset=utf-8' };
    expect(gateFeelRequest({ ...ok, headers })).toBeNull();
  });

  it('is LAN-usable: the phone loads the page from the dev server host, so Origin equals Host', () => {
    const headers = {
      ...ok.headers,
      host: '192.168.1.20:5173',
      origin: 'http://192.168.1.20:5173',
    };
    expect(gateFeelRequest({ ...ok, headers })).toBeNull();
  });

  it.each([
    ['another host', 'http://evil.example'],
    ['the same host on another port', 'http://localhost:9999'],
    ['an opaque origin', 'null'],
    ['garbage', 'not a url'],
    ['a host that only starts like ours', 'http://localhost:5173.evil.example'],
  ])('refuses (403) an Origin that is %s', (_name, origin) => {
    const headers = { ...ok.headers, origin };
    expect(gateFeelRequest({ ...ok, headers })?.status).toBe(403);
  });

  it('refuses (403) an Origin when there is no Host to compare it with', () => {
    const headers = { ...GOOD_HEADERS, origin: 'http://localhost:5173' };
    expect(gateFeelRequest({ method: 'POST', headers })?.status).toBe(403);
  });

  it.each([
    ['text/plain'],
    ['application/x-www-form-urlencoded'],
    ['multipart/form-data; boundary=x'],
    ['application/jsonp'],
    [''],
  ])('refuses (415) the content type "%s"', (contentType) => {
    const headers = { ...ok.headers, 'content-type': contentType };
    expect(gateFeelRequest({ ...ok, headers })?.status).toBe(415);
  });

  it('refuses (415) a request without a content type', () => {
    const { 'content-type': _dropped, ...headers } = ok.headers;
    expect(gateFeelRequest({ ...ok, headers })?.status).toBe(415);
  });

  it('refuses (403) a missing or wrong custom header', () => {
    const { [FEEL_WRITER_HEADER]: _dropped, ...without } = ok.headers;
    expect(gateFeelRequest({ ...ok, headers: without })?.status).toBe(403);
    const wrong = { ...ok.headers, [FEEL_WRITER_HEADER]: '0' };
    expect(gateFeelRequest({ ...ok, headers: wrong })?.status).toBe(403);
  });

  it('checks the method first (405), whatever else is wrong', () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', undefined]) {
      expect(gateFeelRequest({ method, headers: {} })?.status).toBe(405);
    }
  });
});

describe('the feel-writer over HTTP', () => {
  it('saves a well formed request and answers 200 with the changed paths', async () => {
    const hosted = await host();
    const answer = await post(hosted.port, { timing: { windowMs: sample.timing.windowMs + 25 } });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ ok: true, changed: ['timing.windowMs'] });
    expect((JSON.parse(await onDisk()) as typeof sample).timing.windowMs).toBe(
      sample.timing.windowMs + 25,
    );
    expect(await folderEntries()).toEqual(['feel.json']);
  });

  it('accepts a request from its own origin (what the panel on a phone sends)', async () => {
    const hosted = await host();
    const headers = { ...GOOD_HEADERS, origin: `http://127.0.0.1:${hosted.port}` };
    expect((await post(hosted.port, { timing: { hitstopMs: 90 } }, headers)).status).toBe(200);
  });

  it('refuses a foreign Origin (403) and does not even load the deps or touch the file', async () => {
    const hosted = await host();
    const headers = { ...GOOD_HEADERS, origin: 'http://evil.example' };
    const answer = await post(hosted.port, { timing: { windowMs: 400 } }, headers);
    expect(answer.status).toBe(403);
    expect(hosted.loads).toBe(0);
    expect(await onDisk()).toBe(sampleText);
  });

  it('refuses a text/plain « simple » request (415), the cross-site form post', async () => {
    const hosted = await host();
    const headers = {
      'content-type': 'text/plain',
      [FEEL_WRITER_HEADER]: FEEL_WRITER_HEADER_VALUE,
    };
    expect((await post(hosted.port, { timing: { windowMs: 400 } }, headers)).status).toBe(415);
    const bare = { [FEEL_WRITER_HEADER]: FEEL_WRITER_HEADER_VALUE };
    expect((await post(hosted.port, { timing: { windowMs: 400 } }, bare)).status).toBe(415);
    expect(hosted.loads).toBe(0);
    expect(await onDisk()).toBe(sampleText);
  });

  it('refuses a request without the custom header (403)', async () => {
    const hosted = await host();
    const headers = { 'content-type': 'application/json' };
    const answer = await post(hosted.port, { timing: { windowMs: 400 } }, headers);
    expect(answer.status).toBe(403);
    expect(answer.json?.message).toContain(FEEL_WRITER_HEADER);
    expect(await onDisk()).toBe(sampleText);
  });

  it('answers 405 to any other method, before loading anything', async () => {
    const hosted = await host();
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      expect((await send(hosted.port, { method })).status).toBe(405);
    }
    expect(hosted.loads).toBe(0);
  });

  it('answers 413 to a streamed body over the limit and closes the connection', async () => {
    const hosted = await host();
    const piece = 'x'.repeat(16_384);
    const chunks = ['{"file":"content/feel.json","patch":{},"pad":"'];
    for (let i = 0; i < 8; i += 1) chunks.push(piece);
    chunks.push('"}');
    expect(chunks.join('').length).toBeGreaterThan(FEEL_WRITER_MAX_BODY_BYTES);
    // No Content-Length (chunked), so the size is only known as the body streams in. The server
    // may reset the connection right after its answer: both outcomes mean « refused ».
    const answer = await send(hosted.port, { headers: GOOD_HEADERS, chunks }).catch(
      (cause: NodeJS.ErrnoException) => cause,
    );
    if (answer instanceof Error) expect(['ECONNRESET', 'EPIPE']).toContain(answer.code);
    else expect(answer.status).toBe(413);
    expect(hosted.loads).toBe(0);
    expect(await onDisk()).toBe(sampleText);
  });

  it('answers 413 at once to a declared Content-Length over the limit', async () => {
    const hosted = await host();
    const headers = {
      ...GOOD_HEADERS,
      'content-length': String(FEEL_WRITER_MAX_BODY_BYTES + 1),
    };
    const answer = await send(hosted.port, { headers }).catch(
      (cause: NodeJS.ErrnoException) => cause,
    );
    if (answer instanceof Error)
      expect(['ECONNRESET', 'EPIPE', 'ECONNABORTED']).toContain(answer.code);
    else expect(answer.status).toBe(413);
    expect(hosted.loads).toBe(0);
  });

  it('answers 500 once, and logs, when the deps fail to load', async () => {
    const hosted = await host();
    const failing = await host(() => {
      throw new Error('ssr broke');
    });
    const answer = await post(failing.port, { timing: { windowMs: 400 } });
    expect(answer.status).toBe(500);
    expect(failing.errors).toHaveLength(1);
    expect(hosted.errors).toHaveLength(0);
  });

  it('serialises concurrent saves: neither one is lost', async () => {
    const hosted = await host();
    const answers = await Promise.all([
      post(hosted.port, { timing: { windowMs: sample.timing.windowMs + 10 } }),
      post(hosted.port, { timing: { hitstopMs: sample.timing.hitstopMs + 10 } }),
      post(hosted.port, { timing: { windowMs: sample.timing.windowMs + 20 } }),
      post(hosted.port, { baby: { crawlSpeedMps: 0.7 } }),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
    const after = JSON.parse(await onDisk()) as typeof sample & { baby: { crawlSpeedMps: number } };
    // Requests run in arrival order on one queue: the last window write wins, the others stay.
    expect(after.timing.hitstopMs).toBe(sample.timing.hitstopMs + 10);
    expect(after.baby.crawlSpeedMps).toBe(0.7);
    expect([sample.timing.windowMs + 10, sample.timing.windowMs + 20]).toContain(
      after.timing.windowMs,
    );
    // No temp file is left behind by the four writes.
    expect(await folderEntries()).toEqual(['feel.json']);
  });

  it('keeps answering after a request failed', async () => {
    const hosted = await host();
    expect((await post(hosted.port, { timing: { windowMs: -1 } })).status).toBe(400);
    expect((await post(hosted.port, { timing: { windowMs: 310 } })).status).toBe(200);
  });
});

describe('writeWhole', () => {
  it('writes through a uniquely named temp file that does not outlive the write', async () => {
    await writeWhole(target, '{"a":1}\n');
    expect(await onDisk()).toBe('{"a":1}\n');
    expect(await folderEntries()).toEqual(['feel.json']);
  });

  it('removes its temp file when the rename fails', async () => {
    const asDirectory = join(root, 'content', 'dir');
    await mkdir(join(asDirectory, 'inner'), { recursive: true });
    await expect(writeWhole(asDirectory, 'x')).rejects.toThrow();
    expect(await folderEntries()).toEqual(['dir', 'feel.json']);
  });

  it('leaves no temp file when the write itself fails', async () => {
    await expect(writeWhole(join(root, 'missing', 'feel.json'), 'x')).rejects.toThrow();
    expect(await readdir(root)).toEqual(['content']);
  });

  it('does not use the same temp name twice at once', async () => {
    // A shared name would make one rename fail (ENOENT), and the all() below would reject.
    await Promise.all([1, 2, 3].map((n) => writeWhole(target, `{"n":${n}}\n`)));
    expect(await folderEntries()).toEqual(['feel.json']);
    expect(JSON.parse(await onDisk())).toHaveProperty('n');
  });

  it('a save whose file cannot be replaced answers 500 and leaves the file and no temp file', async () => {
    const hosted = await host(() =>
      realDeps({
        writeText: (_path, text) => writeWhole(join(root, 'content', 'nope', 'f'), text),
      }),
    );
    const answer = await post(hosted.port, { timing: { windowMs: 310 } });
    expect(answer.status).toBe(500);
    expect(await onDisk()).toBe(sampleText);
    expect(await folderEntries()).toEqual(['feel.json']);
  });
});

describe('createBiomeFormatter', () => {
  it('rejects, instead of hanging or throwing, when Biome exits without reading its input', async () => {
    const fakeRoot = await mkdtemp(join(tmpdir(), 'pp-fake-biome-'));
    try {
      const bin = join(fakeRoot, 'node_modules', '.bin');
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, 'biome'), '#!/bin/sh\nexit 3\n', 'utf8');
      await chmod(join(bin, 'biome'), 0o755);
      await expect(createBiomeFormatter(fakeRoot)('x'.repeat(200_000))).rejects.toThrow(
        /biome format failed/,
      );
    } finally {
      await rm(fakeRoot, { recursive: true, force: true });
    }
  });

  it('rejects when Biome is not installed', async () => {
    await expect(createBiomeFormatter(root)('{}')).rejects.toThrow(/biome format failed/);
  });
});

describe('feelWriterPlugin', () => {
  interface PluginHooks {
    apply?: string;
    configResolved(config: { root: string }): void;
    configureServer(server: unknown): void;
    handleHotUpdate(context: { file: string }): unknown;
  }

  /** The plugin wired to a fake Vite dev server whose middleware is hosted on a real http.Server. */
  async function wire() {
    const plugin = feelWriterPlugin({ formatRoot: repoRoot }) as unknown as PluginHooks;
    const mounted: { path: string; handler: Parameters<typeof createServer>[1] }[] = [];
    const logged: string[] = [];
    let ssrLoads = 0;
    plugin.configResolved({ root });
    plugin.configureServer({
      middlewares: { use: (path: string, handler: never) => mounted.push({ path, handler }) },
      ssrLoadModule: async () => {
        ssrLoads += 1;
        return { feelProblems };
      },
      config: { logger: { error: (message: string) => logged.push(message) } },
    });
    const hosted: Hosted = { port: 0, loads: 0, errors: [] };
    await listen((request, response) => mounted[0]?.handler?.(request, response), hosted);
    return { plugin, mounted, logged, hosted, ssrLoads: () => ssrLoads };
  }

  it('applies to the dev server only: no build contains it', () => {
    expect(feelWriterPlugin().apply).toBe('serve');
  });

  it('mounts one middleware, on the feel-writer path, and loads the validator only for a real save', async () => {
    const wired = await wire();
    expect(wired.mounted.map((mount) => mount.path)).toEqual([FEEL_WRITER_ENDPOINT]);
    expect((await send(wired.hosted.port, { method: 'GET' })).status).toBe(405);
    expect((await post(wired.hosted.port, { timing: { windowMs: 310 } }, {})).status).toBe(415);
    expect(wired.ssrLoads()).toBe(0);
    expect((await post(wired.hosted.port, { timing: { windowMs: 310 } })).status).toBe(200);
    expect(wired.ssrLoads()).toBe(1);
    expect((JSON.parse(await onDisk()) as typeof sample).timing.windowMs).toBe(310);
    expect(wired.logged).toEqual([]);
  });

  it('keeps the page from reloading on its own write, and only on that file', async () => {
    const wired = await wire();
    const reload = { file: target };
    // Not written yet: Vite's normal handling (undefined), e.g. when Geo edits the file by hand.
    expect(wired.plugin.handleHotUpdate(reload)).toBeUndefined();
    expect((await post(wired.hosted.port, { timing: { windowMs: 310 } })).status).toBe(200);
    expect(wired.plugin.handleHotUpdate(reload)).toEqual([]);
    expect(
      wired.plugin.handleHotUpdate({ file: join(root, 'content', 'other.json') }),
    ).toBeUndefined();
  });

  it('does not suppress a reload after a refused request', async () => {
    const wired = await wire();
    await post(wired.hosted.port, { timing: { windowMs: -1 } });
    expect(wired.plugin.handleHotUpdate({ file: target })).toBeUndefined();
  });
});
