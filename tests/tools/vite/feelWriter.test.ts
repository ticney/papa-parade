import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEL_WRITER_MAX_BODY_BYTES } from '@shared/constants';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { feelProblems } from '../../../tools/vite/feelValidator.ts';
import {
  FEEL_FILE,
  type FeelWriteDeps,
  type FeelWriteRequest,
  handleFeelWrite,
  stringifyLike,
} from '../../../tools/vite/feelWrite.ts';
import { createBiomeFormatter } from '../../../tools/vite/feelWriterPlugin.ts';

// The fixture is a literal sample (`fixtures/feelSample.json`, laid out the way Biome writes it:
// one-line objects, one-line scalar arrays), not the live `content/feel.json`, which Geo reshapes
// freely. Every write goes to a temp directory. Only one « live file » test reads the real
// one, read-only. The HTTP layer is in `feelWriterHttp.test.ts`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sampleText = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feelSample.json'),
  'utf8',
);

let root: string;
let target: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-feel-writer-'));
  target = join(root, FEEL_FILE);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, sampleText, 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const deps = (overrides: Partial<FeelWriteDeps> = {}): FeelWriteDeps => ({
  root,
  readText: (path) => readFile(path, 'utf8'),
  writeText: (path, text) => writeFile(path, text, 'utf8'),
  validate: feelProblems,
  // The project's Biome, run from the repo so that its `biome.json` applies to the temp file's text.
  format: createBiomeFormatter(repoRoot),
  ...overrides,
});

const post = (body: unknown, method = 'POST') => ({
  method,
  bodyText: typeof body === 'string' ? body : JSON.stringify(body),
});
const onDisk = (): Promise<string> => readFile(target, 'utf8');
const sampleFeel = JSON.parse(sampleText) as {
  timing: { windowMs: number; perfectMs: number };
};

describe('handleFeelWrite › an accepted write', () => {
  it('merges the patch into the file and changes nothing else, byte for byte', async () => {
    const windowMs = sampleFeel.timing.windowMs + 25;
    const response = await handleFeelWrite(
      post({ file: FEEL_FILE, patch: { timing: { windowMs } } }),
      deps(),
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, changed: ['timing.windowMs'] });
    const expected = sampleText.replace(
      `"windowMs": ${sampleFeel.timing.windowMs},`,
      `"windowMs": ${windowMs},`,
    );
    expect(expected).not.toBe(sampleText);
    expect(await onDisk()).toBe(expected);
  });

  it('keeps "$schema" first, the key order, and the one-line objects and arrays of the file', async () => {
    await handleFeelWrite(
      post({
        file: FEEL_FILE,
        patch: {
          timing: { slowMoPerfect: { timeScale: 0.35 } },
          mama: { starThresholdPoints: [10, 20, 30, 40, 50] },
        },
      }),
      deps(),
    );
    const text = await onDisk();
    const after = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(after)).toEqual(Object.keys(JSON.parse(sampleText)));
    expect(Object.keys(after)[0]).toBe('$schema');
    expect(text).toMatch(
      /"slowMoPerfect": \{ "timeScale": 0\.35, "durationMs": \d+, "returnMs": \d+ \}/,
    );
    expect(text).toContain('"starThresholdPoints": [10, 20, 30, 40, 50],');
  });

  it('writes text that Biome leaves as it is: formatting the output again is a no-op', async () => {
    await handleFeelWrite(
      post({ file: FEEL_FILE, patch: { movement: { walkSpeedMps: 3.5 } } }),
      deps(),
    );
    const text = await onDisk();
    // Idempotence of the formatter on what was written, and the stringifier already agreed with it
    // (Biome had nothing to change in what stringifyLike produced).
    expect(await createBiomeFormatter(repoRoot)(text)).toBe(text);
    expect(text).toBe(stringifyLike(sampleText, JSON.parse(text)));
    expect(JSON.parse(text).movement.walkSpeedMps).toBe(3.5);
  });

  it('merges into the file, not into an effective feel: a patch of one leaf touches that leaf only', async () => {
    // The file says one thing; nothing else (a level override, the live feel) takes part in the merge.
    await handleFeelWrite(
      post({ file: FEEL_FILE, patch: { input: { earlyPress: 'guard' } } }),
      deps(),
    );
    const after = JSON.parse(await onDisk()) as { input: Record<string, unknown> };
    const before = JSON.parse(sampleText) as { input: Record<string, unknown> };
    expect(after.input.earlyPress).toBe('guard');
    expect({ ...after.input, earlyPress: before.input.earlyPress }).toEqual(before.input);
  });

  it('accepts the file given as an absolute path that resolves to the right file', async () => {
    const response = await handleFeelWrite(
      post({ file: join(root, FEEL_FILE), patch: { timing: { hitstopMs: 90 } } }),
      deps(),
    );
    expect(response.status).toBe(200);
  });

  it('accepts a patch that keeps the file as it is, and rewrites it identically', async () => {
    const response = await handleFeelWrite(
      post({ file: FEEL_FILE, patch: { timing: { windowMs: sampleFeel.timing.windowMs } } }),
      deps(),
    );
    expect(response.status).toBe(200);
    expect(await onDisk()).toBe(sampleText);
  });
});

describe('handleFeelWrite › refusals leave the file byte for byte as it was', () => {
  async function refused(request: FeelWriteRequest, status: number, message?: RegExp) {
    const response = await handleFeelWrite(request, deps());
    expect(response.status).toBe(status);
    expect(response.body.ok).toBe(false);
    if (message !== undefined) expect(response.body.message).toMatch(message);
    expect(await onDisk()).toBe(sampleText);
  }

  it('refuses any method but POST', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      await refused(post({ file: FEEL_FILE, patch: {} }, method), 405);
    }
    await refused({ method: undefined, bodyText: '{}' }, 405);
  });

  it('refuses every file but content/feel.json: other files, traversal, absolute paths', async () => {
    const files = [
      'content/level.json',
      'content/levels/salon_crawler.json',
      'package.json',
      '../package.json',
      '../../etc/passwd',
      'content/../package.json',
      'content/feel.json/../../package.json',
      '/etc/passwd',
      join(root, 'package.json'),
      'content//feel.json.bak',
      'content/feel.json\0.png',
      '',
    ];
    for (const file of files) {
      await refused(
        post({ file, patch: { timing: { windowMs: 400 } } }),
        403,
        /content\/feel\.json only/,
      );
    }
  });

  it('writes no other file when the target is refused', async () => {
    await refused(post({ file: 'package.json', patch: { a: 1 } }), 403);
    await expect(readFile(join(root, 'package.json'), 'utf8')).rejects.toThrow();
  });

  it('refuses a patch that makes the feel invalid, naming the paths', async () => {
    await refused(
      post({ file: FEEL_FILE, patch: { timing: { windowMs: -1 } } }),
      400,
      /timing\.windowMs/,
    );
    await refused(
      post({ file: FEEL_FILE, patch: { timing: { perfectMs: 1e6 } } }),
      400,
      /perfectMs/,
    );
    await refused(post({ file: FEEL_FILE, patch: { timing: { nope: 1 } } }), 400, /nope/);
    await refused(post({ file: FEEL_FILE, patch: { nope: { deeper: 1 } } }), 400, /nope/);
    await refused(post({ file: FEEL_FILE, patch: { timing: { windowMs: 'x' } } }), 400, /windowMs/);
  });

  it('refuses the keys that reach the prototype', async () => {
    await refused(
      post('{"file":"content/feel.json","patch":{"__proto__":{"polluted":true}}}'),
      400,
      /forbidden key __proto__/,
    );
    await refused(
      post({ file: FEEL_FILE, patch: { timing: { constructor: { prototype: 1 } } } }),
      400,
      /forbidden key constructor/,
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a body over the limit, however well formed', async () => {
    const big = {
      file: FEEL_FILE,
      patch: { timing: { windowMs: 300 } },
      pad: 'x'.repeat(FEEL_WRITER_MAX_BODY_BYTES),
    };
    await refused(post(big), 413);
    // Counted in bytes, not characters.
    const wide = { file: FEEL_FILE, patch: {}, pad: 'é'.repeat(FEEL_WRITER_MAX_BODY_BYTES / 2) };
    await refused(post(wide), 413);
  });

  it('refuses a body that is not the request shape', async () => {
    await refused(post('not json'), 400, /not JSON/);
    await refused(post('[]'), 400, /must be/);
    await refused(post({ patch: {} }), 400, /must be/);
    await refused(post({ file: FEEL_FILE }), 400, /must be/);
    await refused(post({ file: FEEL_FILE, patch: [] }), 400, /must be/);
    await refused(post({ file: FEEL_FILE, patch: 'timing' }), 400, /must be/);
    await refused(post({ file: 5, patch: {} }), 400, /must be/);
  });

  it('answers 500 and leaves the file when it cannot be read, formatted or written', async () => {
    const request = post({ file: FEEL_FILE, patch: { timing: { windowMs: 400 } } });
    const unreadable = await handleFeelWrite(
      request,
      deps({ readText: () => Promise.reject(new Error('EACCES')) }),
    );
    expect(unreadable.status).toBe(500);
    expect(unreadable.body.message).toContain('EACCES');
    const notJson = await handleFeelWrite(request, deps({ readText: async () => '{ nope' }));
    expect(notJson.status).toBe(500);
    const unformatted = await handleFeelWrite(
      request,
      deps({ format: () => Promise.reject(new Error('no biome')) }),
    );
    expect(unformatted.status).toBe(500);
    const unwritten = await handleFeelWrite(
      request,
      deps({ writeText: () => Promise.reject(new Error('disk full')) }),
    );
    expect(unwritten.status).toBe(500);
    expect(unwritten.body.message).toContain('disk full');
    expect(await onDisk()).toBe(sampleText);
  });

  it('writes nothing when the formatter returns an empty, garbled or different text', async () => {
    const request = post({ file: FEEL_FILE, patch: { timing: { windowMs: 400 } } });
    const outputs: [string, RegExp][] = [
      ['', /not JSON/],
      ['{ "timing": ', /not JSON/],
      ['{}', /invalid feel/],
      // Valid for the schema, but not the feel that was validated.
      [
        JSON.stringify({ ...sampleFeel, timing: { ...sampleFeel.timing, windowMs: 401 } }),
        /differs from the merge/,
      ],
    ];
    for (const [output, message] of outputs) {
      const writes: string[] = [];
      const response = await handleFeelWrite(
        request,
        deps({
          format: async () => output,
          writeText: async (_path, text) => void writes.push(text),
        }),
      );
      expect(response.status).toBe(500);
      expect(response.body.message).toMatch(message);
      expect(writes).toEqual([]);
    }
    expect(await onDisk()).toBe(sampleText);
  });
});

describe('stringifyLike', () => {
  it('gives the sample feel.json back byte for byte', () => {
    expect(stringifyLike(sampleText, JSON.parse(sampleText))).toBe(sampleText);
  });

  it('gives the live content/feel.json back byte for byte (read only)', async () => {
    const live = await readFile(join(repoRoot, FEEL_FILE), 'utf8');
    expect(stringifyLike(live, JSON.parse(live))).toBe(live);
  });

  it('expands an object the original wrote expanded, and collapses one it wrote on a line', () => {
    const original = '{\n  "a": { "x": 1, "y": 2 },\n  "b": {\n    "x": 1\n  }\n}\n';
    expect(stringifyLike(original, { a: { x: 1, y: 3 }, b: { x: 2 } })).toBe(
      '{\n  "a": { "x": 1, "y": 3 },\n  "b": {\n    "x": 2\n  }\n}\n',
    );
  });

  it('writes a key the original did not have on its own lines, and keeps nested containers expanded', () => {
    const out = stringifyLike('{\n  "a": 1\n}\n', { a: 1, b: { c: [1, 2], d: [{ e: 1 }] } });
    expect(out).toBe(
      '{\n  "a": 1,\n  "b": {\n    "c": [1, 2],\n    "d": [\n      {\n        "e": 1\n      }\n    ]\n  }\n}\n',
    );
  });

  it('handles strings with escapes and quotes in the original', () => {
    const original = '{\n  "a": "say \\"hi\\" { [",\n  "b": { "c": 1 }\n}\n';
    expect(stringifyLike(original, { a: 'say "hi" { [', b: { c: 2 } })).toBe(
      '{\n  "a": "say \\"hi\\" { [",\n  "b": { "c": 2 }\n}\n',
    );
  });

  it('writes empty containers as {} and []', () => {
    expect(stringifyLike('{}', { a: {}, b: [] })).toBe('{\n  "a": {},\n  "b": []\n}\n');
  });
});
