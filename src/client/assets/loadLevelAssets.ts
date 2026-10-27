import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { LEVEL_FETCH_TIMEOUT_MS } from '@shared/constants';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import type { Group } from 'three';

/** Everything the client needs to build one level's scene. */
export interface LevelAssets {
  id: string;
  geometry: LevelGeometry;
  /** The loaded `.glb` scene, still holding the `COL_`/`NAV_`/`ZONE_`/`ANCHOR_` nodes. Mutable: not shared across loads (D7). */
  model: Group;
}

export interface LoadLevelDeps {
  /** The bytes of a file; rejects on a network error, a non-2xx status or a timeout. Default: `fetchBytesWithTimeout`. */
  fetchBytes?(url: string): Promise<Uint8Array>;
  /** The text of `content/levels/<id>.geometry.json`; rejects when it cannot be had. Default: the lazy glob below. */
  loadGeometryText?(id: string): Promise<string>;
  /** Parses a `.glb`. Default: `gltf.ts`, imported on demand. */
  parseModel?(bytes: Uint8Array, baseUrl: string): Promise<Group>;
  /** Default: `import.meta.env.BASE_URL` (`./` in builds, `/` in dev). Never write `/assets/…`. */
  baseUrl?: string;
}

const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46]; // "glTF"

// One lazy chunk per level (D5): requested over the network when the level loads, not inlined in
// the main bundle like the other content files.
const GEOMETRY_FILES = import.meta.glob<string>('../../../content/levels/*.geometry.json', {
  query: '?raw',
  import: 'default',
});

/**
 * The bytes of `url`. Rejects on a network error, a non-2xx status, or when the response (headers
 * and body) takes longer than `timeoutMs`: a stalled connection must reach « Oups », not hang.
 */
export async function fetchBytesWithTimeout(
  url: string,
  timeoutMs: number = LEVEL_FETCH_TIMEOUT_MS,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function defaultLoadGeometryText(id: string): Promise<string> {
  const load = GEOMETRY_FILES[`../../../content/levels/${id}.geometry.json`];
  if (load === undefined) return Promise.reject(new Error('not in the build'));
  return load();
}

async function defaultParseModel(bytes: Uint8Array, baseUrl: string): Promise<Group> {
  const { parseGlb } = await import('./gltf.ts');
  return parseGlb(bytes, baseUrl);
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const fail = (message: string, cause?: unknown): Result<never, AppError> =>
  err({ kind: 'assets', message, cause });

async function loadModel(
  id: string,
  deps: Required<LoadLevelDeps>,
): Promise<Result<Group, AppError>> {
  const file = `${id}.glb`;
  const url = `${deps.baseUrl}assets/levels/${file}`;
  let bytes: Uint8Array;
  try {
    bytes = await deps.fetchBytes(url);
  } catch (cause) {
    return fail(`cannot fetch ${file}: ${reasonOf(cause)}`, cause);
  }
  // A single-page fallback answers a missing file with HTML and a 200: look at the magic.
  if (GLB_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    return fail(`${file} is not a glTF binary (it does not start with "glTF")`);
  }
  try {
    return ok(await deps.parseModel(bytes, `${deps.baseUrl}assets/levels/`));
  } catch (cause) {
    return fail(`cannot parse ${file}: ${reasonOf(cause)}`, cause);
  }
}

async function loadGeometry(
  id: string,
  deps: Required<LoadLevelDeps>,
): Promise<Result<LevelGeometry, AppError>> {
  const file = `${id}.geometry.json`;
  let text: string;
  try {
    text = await deps.loadGeometryText(id);
  } catch (cause) {
    return fail(`cannot load ${file}: ${reasonOf(cause)}`, cause);
  }
  const parsed = parseContentFile(`content/levels/${file}`, text, LevelGeometrySchema);
  if (!parsed.ok) {
    const [first] = parsed.error;
    const more = parsed.error.length - 1;
    const head = first === undefined ? 'invalid' : formatContentProblem(first);
    return fail(`${file} is invalid: ${head}${more > 0 ? ` (+${more} more)` : ''}`, parsed.error);
  }
  if (parsed.value.id !== id) {
    return fail(`${file} is invalid: its id is "${parsed.value.id}", expected "${id}"`);
  }
  return ok(parsed.value);
}

/**
 * Loads the `.glb` and the geometry of level `id` in parallel. Never throws: a rejected fetch, a
 * non-OK status, an HTML body served as the `.glb`, a bad geometry and a bad glb are each an `err`
 * of kind `assets` whose message names the file. It logs the `warn` itself, with the level id.
 * The `.glb` is reported before the geometry when both fail.
 */
export async function loadLevelAssets(
  id: string,
  deps: LoadLevelDeps = {},
): Promise<Result<LevelAssets, AppError>> {
  const resolved: Required<LoadLevelDeps> = {
    fetchBytes: deps.fetchBytes ?? fetchBytesWithTimeout,
    loadGeometryText: deps.loadGeometryText ?? defaultLoadGeometryText,
    parseModel: deps.parseModel ?? defaultParseModel,
    baseUrl: deps.baseUrl ?? import.meta.env.BASE_URL,
  };
  const [model, geometry] = await Promise.all([
    loadModel(id, resolved),
    loadGeometry(id, resolved),
  ]);
  const failure = !model.ok ? model.error : !geometry.ok ? geometry.error : null;
  if (failure !== null) {
    log.warn('assets', 'level load failed', { id, error: failure });
    return err(failure);
  }
  if (!model.ok || !geometry.ok) return fail('unreachable'); // narrows the types
  return ok({ id, geometry: geometry.value, model: model.value });
}
