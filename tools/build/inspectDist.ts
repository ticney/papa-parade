import { LEVEL_PAYLOAD_MAX_BYTES } from '@shared/constants';
import {
  cspDirectives,
  headersFor,
  parseHeaders,
  sameSources,
  weakSourcesOf,
} from '../serve/headers.ts';

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

/**
 * Strings that only a debug build may hold (they survive minification: identifiers of the debug
 * entry points, a CSS class of the FPS counter). The manifest lists entry and dynamic-entry chunks
 * only, so a debug module merged into the main chunk is caught by these markers alone: the playtest
 * check requires every one of them to be present, so that none is vacuous.
 */
export const PROD_FORBIDDEN_MARKERS: readonly string[] = [
  '__PP__',
  'installTestApi',
  'installAutoplay',
  'installPerfHud',
  'copyLog',
  // Story 3.3: the playtest journal's entry point, and the kind of the file it exports (the schema
  // that holds it is imported by the debug chunk only). Both live in the playtest bundle.
  'installPlaytestJournal',
  'papa-parade.journal',
  'pp-debug-perf',
  // Story 2.1: the debug overlay's root CSS class, and the attribute Tweakpane's style sheet
  // carries (the feel panel's CSP workaround looks for it). Both live in the playtest bundle.
  'pp-debug-overlay',
  'data-tp-style',
];

/**
 * Strings that must be in no build at all, `playtest` included: they belong to code that only the
 * dev server runs (`import.meta.env.DEV`). The `feel-writer` endpoint is the case (story 2.1): the
 * panel's « Enregistrer » button, and so the string, is compiled out of the playtest build, so it
 * cannot be a {@link PROD_FORBIDDEN_MARKERS} entry (the playtest check requires those to be
 * present) but a build that does contain it would ship a button that posts to a dev-only endpoint.
 */
export const NEVER_SHIPPED_MARKERS: readonly string[] = ['__pp/feel-writer'];

/** The debug entry modules a playtest build must hold in its manifest (renamed? the prod check is blind). */
export const PLAYTEST_REQUIRED_SOURCES: readonly string[] = [
  'src/debug/testApi.ts',
  'src/debug/autoplay.ts',
  'src/debug/perfHud.ts',
  'src/debug/debugOverlay.ts',
  'src/debug/playtestJournal.ts',
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
  if (csp.includes(',')) {
    return ['CSP: several rules set a policy for "/": this check reads one policy, merge them'];
  }
  const directives = cspDirectives(csp);
  const problems: string[] = [];
  for (const [name, sources] of REQUIRED_CSP_DIRECTIVES) {
    const actual = directives.get(name);
    if (actual === undefined || !sameSources(actual, sources)) {
      problems.push(
        `CSP: "${name}" must be "${sources}", got ${actual === undefined ? 'nothing' : `"${actual}"`}`,
      );
    }
  }
  for (const [name, sources] of directives) {
    const weak = weakSourcesOf(sources);
    if (weak.length > 0) {
      problems.push(`CSP: "${name}" must not allow ${weak.join(', ')}`);
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
 * - both: no {@link NEVER_SHIPPED_MARKERS} (dev-server-only code) in any chunk.
 * - `prod`: no debug or bot module in the manifest, no debug marker in any chunk.
 * - `playtest`: the debug modules are in the manifest and every prod marker is in a chunk (so that
 *   the prod markers are proved real: a renamed module or identifier fails here first).
 *
 * The manifest lists the entry and dynamic-entry chunks only, not every source module: the prod
 * check by `src` sees a debug module that Vite kept as its own chunk, the markers see one that was
 * merged into another chunk.
 *
 * The first-load figure sums the gzip bytes of `index.html`, every chunk reached from the entry
 * (minus the debug and bot ones) and its CSS, the fonts, plus the level payload gzipped.
 */
export function inspectDist(input: DistInput, flavor: DistFlavor): DistReport {
  const problems = cspProblemsOf(input.headersText);

  for (const url of externalUrlsOf(input.indexHtml)) {
    problems.push(`index.html loads from another origin: ${url}`);
  }

  if (input.levelIds.length === 0) problems.push('no level found in content/levels/');
  const fileAt = new Map(input.files.map((file) => [file.path, file]));
  const audioFiles = input.files.filter((file) => file.path.startsWith('assets/audio/'));
  const audioBytes = audioFiles.reduce((sum, file) => sum + file.bytes, 0);
  if (audioFiles.length === 0) {
    problems.push(
      'no audio file under assets/audio/ in dist/ (moved? the audio budget would be vacuous)',
    );
  }
  const audioGzipBytes = audioFiles.reduce((sum, file) => sum + file.gzipBytes, 0);
  let levelPayloadBytes = audioBytes;
  let levelPayloadGzipBytes = audioGzipBytes;
  for (const id of input.levelIds) {
    const glbPath = `assets/levels/${id}.glb`;
    const glb = fileAt.get(glbPath);
    if (glb === undefined) {
      problems.push(`level "${id}": ${glbPath} is missing from dist/`);
      continue;
    }
    const payload = glb.bytes + audioBytes;
    levelPayloadBytes = Math.max(levelPayloadBytes, payload);
    levelPayloadGzipBytes = Math.max(levelPayloadGzipBytes, glb.gzipBytes + audioGzipBytes);
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
    for (const marker of PROD_FORBIDDEN_MARKERS) {
      const isPresent = [...input.jsText.values()].some((text) => text.includes(marker));
      if (!isPresent) {
        problems.push(
          `playtest bundle: no chunk contains "${marker}" (renamed? the prod check for it would be vacuous)`,
        );
      }
    }
  }

  for (const [path, text] of input.jsText) {
    for (const marker of NEVER_SHIPPED_MARKERS) {
      if (text.includes(marker)) {
        problems.push(`${flavor} bundle: ${path} contains "${marker}" (dev-server code)`);
      }
    }
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
  let firstLoadGzipBytes = levelPayloadGzipBytes;
  for (const path of firstLoadFiles) firstLoadGzipBytes += gzipOf.get(path) ?? 0;
  for (const file of input.files) {
    if (file.path.startsWith('fonts/')) firstLoadGzipBytes += file.gzipBytes;
  }

  return { problems, levelPayloadBytes, firstLoadGzipBytes };
}
