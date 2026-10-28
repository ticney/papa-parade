import { LEVEL_PAYLOAD_MAX_BYTES } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { parseCheckDistArgs } from '../../../tools/build/checkDist.ts';
import {
  type DistFile,
  type DistInput,
  type DistManifest,
  inspectDist,
} from '../../../tools/build/inspectDist.ts';

const GOOD_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self'; object-src 'none'; base-uri 'self'";
const headers = (csp: string): string => `/*\n  Content-Security-Policy: ${csp}\n`;

const file = (path: string, bytes: number, gzipBytes = bytes): DistFile => ({
  path,
  bytes,
  gzipBytes,
});

const PROD_MANIFEST: DistManifest = {
  'index.html': {
    file: 'assets/index-a.js',
    src: 'index.html',
    isEntry: true,
    dynamicImports: ['rapier.mjs', 'src/client/assets/gltf.ts'],
    css: ['assets/index-a.css'],
  },
  'rapier.mjs': { file: 'assets/rapier-a.js', src: 'rapier.mjs' },
  'src/client/assets/gltf.ts': {
    file: 'assets/gltf-a.js',
    src: 'src/client/assets/gltf.ts',
    imports: ['index.html'],
  },
};

const PLAYTEST_MANIFEST: DistManifest = {
  ...PROD_MANIFEST,
  'index.html': {
    ...(PROD_MANIFEST['index.html'] as DistManifest[string]),
    dynamicImports: [
      'rapier.mjs',
      'src/client/assets/gltf.ts',
      'src/debug/testApi.ts',
      'src/debug/autoplay.ts',
      'src/debug/perfHud.ts',
    ],
  },
  'src/debug/testApi.ts': { file: 'assets/testApi-a.js', src: 'src/debug/testApi.ts' },
  'src/debug/autoplay.ts': { file: 'assets/autoplay-a.js', src: 'src/debug/autoplay.ts' },
  'src/debug/perfHud.ts': { file: 'assets/perfHud-a.js', src: 'src/debug/perfHud.ts' },
};

const FILES: DistFile[] = [
  file('index.html', 1000, 480),
  file('assets/index-a.js', 800_000, 240_000),
  file('assets/index-a.css', 22_000, 4500),
  file('assets/rapier-a.js', 4_000_000, 1_600_000),
  file('assets/gltf-a.js', 70_000, 20_000),
  file('assets/testApi-a.js', 3000, 1400),
  file('assets/autoplay-a.js', 5000, 2400),
  file('assets/perfHud-a.js', 2000, 900),
  file('assets/levels/salon_crawler.glb', 21_000),
  file('assets/audio/pop.m4a', 100_000),
  file('assets/audio/laugh.m4a', 150_000),
  file('fonts/baloo.woff2', 30_000),
];

const JS_PROD = new Map([
  ['assets/index-a.js', 'const game = 1;'],
  ['assets/rapier-a.js', 'wasm'],
]);
const JS_PLAYTEST = new Map([
  ...JS_PROD,
  ['assets/testApi-a.js', 'window.__PP__ = api; installTestApi'],
  ['assets/autoplay-a.js', 'installAutoplay'],
  ['assets/perfHud-a.js', 'installPerfHud'],
]);

const prodInput = (over: Partial<DistInput> = {}): DistInput => ({
  manifest: PROD_MANIFEST,
  files: FILES.filter((f) => !/testApi|autoplay|perfHud/.test(f.path)),
  jsText: JS_PROD,
  indexHtml:
    '<script type="module" src="./assets/index-a.js"></script><link href="./assets/index-a.css">',
  headersText: headers(GOOD_CSP),
  levelIds: ['salon_crawler'],
  ...over,
});

const playtestInput = (over: Partial<DistInput> = {}): DistInput => ({
  ...prodInput(),
  manifest: PLAYTEST_MANIFEST,
  files: FILES,
  jsText: JS_PLAYTEST,
  ...over,
});

describe('inspectDist: both flavours', () => {
  it('passes a clean prod tree and a clean playtest tree', () => {
    expect(inspectDist(prodInput(), 'prod').problems).toEqual([]);
    expect(inspectDist(playtestInput(), 'playtest').problems).toEqual([]);
  });

  it('reports the level payload (glb + all audio) and the first-load gzip total', () => {
    const report = inspectDist(prodInput(), 'prod');
    expect(report.levelPayloadBytes).toBe(21_000 + 100_000 + 150_000);
    // index.html + entry + css + rapier + gltf (gzip) + the font (gzip) + the raw payload.
    expect(report.firstLoadGzipBytes).toBe(
      480 + 240_000 + 4500 + 1_600_000 + 20_000 + 30_000 + 271_000,
    );
  });

  it('leaves the debug chunks out of the first-load total', () => {
    const prod = inspectDist(prodInput(), 'prod').firstLoadGzipBytes;
    const playtest = inspectDist(playtestInput(), 'playtest').firstLoadGzipBytes;
    expect(playtest).toBe(prod);
  });

  it('fails when _headers is missing', () => {
    const { problems } = inspectDist(prodInput({ headersText: null }), 'prod');
    expect(problems).toEqual(['_headers is missing: the host would serve no CSP']);
  });

  it('fails when _headers does not parse', () => {
    const { problems } = inspectDist(prodInput({ headersText: 'oops\n' }), 'prod');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('_headers line 1');
  });

  it('fails when there is no CSP for /*', () => {
    const { problems } = inspectDist(prodInput({ headersText: '/*\n  X-A: 1\n' }), 'prod');
    expect(problems).toEqual(['_headers has no Content-Security-Policy for "/*"']);
  });

  it.each([
    ['default-src', "script-src 'self' 'wasm-unsafe-eval'; font-src 'self'", 'default-src'],
    ['script-src', "default-src 'self'; font-src 'self'", 'script-src'],
    ['font-src', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'", 'font-src'],
    [
      'a weakened script-src',
      "default-src 'self'; script-src 'self'; font-src 'self'",
      'script-src" must be',
    ],
  ])('fails a CSP without %s, with its own message', (_label, csp, needle) => {
    const { problems } = inspectDist(prodInput({ headersText: headers(csp) }), 'prod');
    expect(problems.some((problem) => problem.includes(needle))).toBe(true);
  });

  it("fails a CSP that allows 'unsafe-inline' or 'unsafe-eval'", () => {
    const unsafe = headers(`${GOOD_CSP}; style-src 'self' 'unsafe-inline'`);
    const { problems } = inspectDist(prodInput({ headersText: unsafe }), 'prod');
    expect(problems).toEqual(['CSP: "style-src" must not allow unsafe-inline or unsafe-eval']);
  });

  it.each([
    ['https://cdn.example.com/x.js', '<script src="https://cdn.example.com/x.js"></script>'],
    ['//cdn.example.com/x.css', '<link rel="stylesheet" href="//cdn.example.com/x.css">'],
    ['http://example.com/', "<a href='http://example.com/'>x</a>"],
  ])('fails an index.html that loads %s', (url, indexHtml) => {
    const { problems } = inspectDist(prodInput({ indexHtml }), 'prod');
    expect(problems).toEqual([`index.html loads from another origin: ${url}`]);
  });

  it('fails a payload over the budget, naming the level', () => {
    const heavy = FILES.map((f) =>
      f.path === 'assets/audio/pop.m4a' ? file(f.path, LEVEL_PAYLOAD_MAX_BYTES) : f,
    );
    const { problems } = inspectDist(prodInput({ files: heavy }), 'prod');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('level "salon_crawler": payload is');
  });

  it('fails a level whose glb is missing', () => {
    const files = FILES.filter((f) => !f.path.endsWith('.glb'));
    const { problems } = inspectDist(prodInput({ files }), 'prod');
    expect(problems).toEqual([
      'level "salon_crawler": assets/levels/salon_crawler.glb is missing from dist/',
    ]);
  });

  it('fails when content/levels holds no level (nothing would be checked)', () => {
    const { problems } = inspectDist(prodInput({ levelIds: [] }), 'prod');
    expect(problems).toEqual(['no level found in content/levels/']);
  });
});

describe('inspectDist: prod', () => {
  it.each(['__PP__', 'installTestApi', 'installAutoplay', 'installPerfHud', 'copyLog'])(
    'fails a chunk that contains %s',
    (marker) => {
      const jsText = new Map(JS_PROD).set('assets/index-a.js', `x.${marker}=1`);
      const { problems } = inspectDist(prodInput({ jsText }), 'prod');
      expect(problems).toEqual([`prod bundle: assets/index-a.js contains "${marker}"`]);
    },
  );

  it.each([
    'src/debug/testApi.ts',
    'src/bots/perfectBot.ts',
    'node_modules/tweakpane/dist/tweakpane.js',
  ])('fails a manifest module %s', (src) => {
    const manifest = { ...PROD_MANIFEST, [src]: { file: 'assets/x.js', src } };
    const { problems } = inspectDist(prodInput({ manifest }), 'prod');
    expect(problems).toEqual([`prod bundle holds a debug-only module: ${src}`]);
  });
});

describe('inspectDist: playtest', () => {
  it('fails a tree that lacks the test API module', () => {
    const manifest = { ...PLAYTEST_MANIFEST };
    delete manifest['src/debug/testApi.ts'];
    const { problems } = inspectDist(playtestInput({ manifest }), 'playtest');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('playtest bundle lacks src/debug/testApi.ts');
  });

  it('fails a tree where no chunk contains __PP__', () => {
    const jsText = new Map(JS_PLAYTEST).set('assets/testApi-a.js', 'installTestApi');
    const { problems } = inspectDist(playtestInput({ jsText }), 'playtest');
    expect(problems).toEqual(['playtest bundle: no chunk contains "__PP__"']);
  });

  it('does not apply the prod markers to a playtest tree', () => {
    const { problems } = inspectDist(playtestInput(), 'playtest');
    expect(problems).toEqual([]);
  });
});

describe('parseCheckDistArgs', () => {
  it('reads the flavour and defaults the folder to dist', () => {
    expect(parseCheckDistArgs(['--flavor', 'prod'])).toEqual({
      ok: true,
      value: { flavor: 'prod', dir: 'dist' },
    });
    expect(parseCheckDistArgs(['--flavor', 'playtest', '--dir', 'out'])).toEqual({
      ok: true,
      value: { flavor: 'playtest', dir: 'out' },
    });
  });

  it.each([
    [[]],
    [['--flavor', 'staging']],
    [['--flavor']],
    [['--flavor', 'prod', '--dir']],
    [['--flavor', 'prod', '--nope']],
  ])('rejects %j', (argv) => {
    expect(parseCheckDistArgs(argv).ok).toBe(false);
  });
});
