import { LEVEL_PAYLOAD_MAX_BYTES } from '@shared/constants';
import { cspDirectives, headersFor, parseHeaders } from '../serve/headers.ts';

export type DistFlavor = 'prod' | 'playtest';

/** One chunk of Vite's `.vite/manifest.json` (the keys the checks read). */
export interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
export type DistManifest = Record<string, ManifestChunk>;

/** A file of the built folder: its path under `dist/` (posix, no leading slash) and its sizes. */
export interface DistFile {
  path: string;
  bytes: number;
  gzipBytes: number;
}

/** Everything `inspectDist` reads, loaded by the CLI; the checks themselves touch no disk. */
export interface DistInput {
  manifest: DistManifest;
  files: readonly DistFile[];
  /** The text of each JS file, by path under `dist/`. */
  jsText: ReadonlyMap<string, string>;
  indexHtml: string;
  /** The text of `dist/_headers`, or `null` when there is none. */
  headersText: string | null;
  /** The ids of the levels in `content/levels/`. */
  levelIds: readonly string[];
}

export interface DistReport {
  problems: string[];
  /** For the level with the biggest payload: its `.glb` plus all the audio, in bytes. */
  levelPayloadBytes: number;
  /** Gzip bytes of what a first visit downloads (see {@link inspectDist}); printed, never asserted. */
  firstLoadGzipBytes: number;
}

/** The three directives of the epic, as `_headers` must write them (UX-DR1, architecture › Security). */
export const REQUIRED_CSP_DIRECTIVES: readonly (readonly [name: string, sources: string])[] = [
  ['default-src', "'self'"],
  ['script-src', "'self' 'wasm-unsafe-eval'"],
  ['font-src', "'self'"],
];

/** Names that only a debug build may hold: proof that a store bundle has no debug code. */
export const PROD_FORBIDDEN_MARKERS: readonly string[] = [
  '__PP__',
  'installTestApi',
  'installAutoplay',
  'installPerfHud',
  'copyLog',
];

/** The modules a playtest build must hold, so that the prod markers are known to be real. */
export const PLAYTEST_REQUIRED_SOURCES: readonly string[] = [
  'src/debug/testApi.ts',
  'src/debug/autoplay.ts',
  'src/debug/perfHud.ts',
];

const isDebugOnlySource = (src: string): boolean =>
  src.startsWith('src/debug/') || src.startsWith('src/bots/');

/** The chunks a visit may fetch with the entry: everything it reaches by an import, static or dynamic. */
function reachableChunks(manifest: DistManifest): Set<string> {
  const reached = new Set<string>();
  const queue = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry === true)
    .map(([key]) => key);
  while (queue.length > 0) {
    const key = queue.pop() as string;
    if (reached.has(key)) continue;
    reached.add(key);
    const chunk = manifest[key];
    for (const next of [...(chunk?.imports ?? []), ...(chunk?.dynamicImports ?? [])]) {
      if (next in manifest) queue.push(next);
    }
  }
  return reached;
}

function cspProblemsOf(headersText: string | null): string[] {
  if (headersText === null) return ['_headers is missing: the host would serve no CSP'];
  const rules = parseHeaders(headersText);
  if (!rules.ok) return [rules.error];
  const csp = headersFor(rules.value, '/')['content-security-policy'];
  if (csp === undefined) return ['_headers has no Content-Security-Policy for "/*"'];
  const directives = cspDirectives(csp);
  const problems: string[] = [];
  for (const [name, sources] of REQUIRED_CSP_DIRECTIVES) {
    const actual = directives.get(name);
    if (actual !== sources) {
      problems.push(
        `CSP: "${name}" must be "${sources}", got ${actual === undefined ? 'nothing' : `"${actual}"`}`,
      );
    }
  }
  for (const [name, sources] of directives) {
    if (sources.includes("'unsafe-inline'") || sources.includes("'unsafe-eval'")) {
      problems.push(`CSP: "${name}" must not allow unsafe-inline or unsafe-eval`);
    }
  }
  return problems;
}

/** The `src` and `href` values of `index.html` that leave the origin (`http:`, `https:`, `//`). */
function externalUrlsOf(indexHtml: string): string[] {
  const urls: string[] = [];
  for (const match of indexHtml.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
    const url = (match[1] as string).trim();
    if (/^(?:https?:)?\/\//i.test(url)) urls.push(url);
  }
  return urls;
}

/**
 * Checks a built `dist/` against the story-1.24 rules (the epic's « test sur dist/ »), for the
 * `prod` or the `playtest` flavour; pure, no disk. Every problem is listed, none stops the others.
 *
 * - both: the CSP of `_headers`; no cross-origin URL in `index.html`; each level's `.glb` plus all
 *   the audio within `LEVEL_PAYLOAD_MAX_BYTES`.
 * - `prod`: no debug or bot module in the manifest, no debug marker in any chunk.
 * - `playtest`: the debug modules are in the manifest and `__PP__` is in a chunk (so that the prod
 *   markers are proved real: a renamed module fails here first).
 *
 * The first-load figure sums the gzip bytes of `index.html`, every chunk reached from the entry
 * (minus the debug and bot ones) and its CSS, the fonts, plus the raw level payload.
 */
export function inspectDist(input: DistInput, flavor: DistFlavor): DistReport {
  const problems = cspProblemsOf(input.headersText);

  for (const url of externalUrlsOf(input.indexHtml)) {
    problems.push(`index.html loads from another origin: ${url}`);
  }

  if (input.levelIds.length === 0) problems.push('no level found in content/levels/');
  const sizeOf = new Map(input.files.map((file) => [file.path, file.bytes]));
  const audioBytes = input.files
    .filter((file) => file.path.startsWith('assets/audio/'))
    .reduce((sum, file) => sum + file.bytes, 0);
  let levelPayloadBytes = audioBytes;
  for (const id of input.levelIds) {
    const glbPath = `assets/levels/${id}.glb`;
    const glbBytes = sizeOf.get(glbPath);
    if (glbBytes === undefined) {
      problems.push(`level "${id}": ${glbPath} is missing from dist/`);
      continue;
    }
    const payload = glbBytes + audioBytes;
    levelPayloadBytes = Math.max(levelPayloadBytes, payload);
    if (payload > LEVEL_PAYLOAD_MAX_BYTES) {
      problems.push(
        `level "${id}": payload is ${payload} B (${glbPath} + all audio), over the ${LEVEL_PAYLOAD_MAX_BYTES} B budget`,
      );
    }
  }

  const sources = Object.values(input.manifest)
    .map((chunk) => chunk.src)
    .filter((src): src is string => src !== undefined);
  if (flavor === 'prod') {
    for (const src of sources) {
      if (isDebugOnlySource(src) || src.includes('node_modules/tweakpane')) {
        problems.push(`prod bundle holds a debug-only module: ${src}`);
      }
    }
    for (const [path, text] of input.jsText) {
      for (const marker of PROD_FORBIDDEN_MARKERS) {
        if (text.includes(marker)) problems.push(`prod bundle: ${path} contains "${marker}"`);
      }
    }
  } else {
    for (const required of PLAYTEST_REQUIRED_SOURCES) {
      if (!sources.includes(required)) {
        problems.push(
          `playtest bundle lacks ${required} (renamed? update PLAYTEST_REQUIRED_SOURCES and PROD_FORBIDDEN_MARKERS)`,
        );
      }
    }
    const hasTestApi = [...input.jsText.values()].some((text) => text.includes('__PP__'));
    if (!hasTestApi) problems.push('playtest bundle: no chunk contains "__PP__"');
  }

  const gzipOf = new Map(input.files.map((file) => [file.path, file.gzipBytes]));
  const reached = reachableChunks(input.manifest);
  const firstLoadFiles = new Set<string>(['index.html']);
  for (const key of reached) {
    const chunk = input.manifest[key] as ManifestChunk;
    if (chunk.src !== undefined && isDebugOnlySource(chunk.src)) continue;
    firstLoadFiles.add(chunk.file);
    for (const css of chunk.css ?? []) firstLoadFiles.add(css);
  }
  let firstLoadGzipBytes = levelPayloadBytes;
  for (const path of firstLoadFiles) firstLoadGzipBytes += gzipOf.get(path) ?? 0;
  for (const file of input.files) {
    if (file.path.startsWith('fonts/')) firstLoadGzipBytes += file.gzipBytes;
  }

  return { problems, levelPayloadBytes, firstLoadGzipBytes };
}
