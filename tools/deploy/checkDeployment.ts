import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEPLOY_FETCH_TIMEOUT_MS } from '@shared/constants';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { cspDirectives, headersFor, parseHeaders, sameSources } from '../serve/headers.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: npm run deploy:check -- <https url>';

/** The slice of `fetch` the check uses; a test passes a fake. */
export type FetchLike = (url: string) => Promise<Response>;

/**
 * What is wrong with a response's CSP against the one `public/_headers` promises: the header is
 * missing, or one of the expected directives is absent or different. Pure. Extra directives on the
 * host's side are not a problem here (a host may add its own); the weakening of a directive is.
 */
export function cspProblems(expected: string, actual: string | null): string[] {
  if (actual === null) return ['no Content-Security-Policy header'];
  const sent = cspDirectives(actual);
  const problems: string[] = [];
  for (const [name, sources] of cspDirectives(expected)) {
    const got = sent.get(name);
    if (got === undefined || !sameSources(got, sources)) {
      problems.push(
        `CSP "${name}" should be "${sources}", got ${got === undefined ? 'nothing' : `"${got}"`}`,
      );
    }
  }
  return problems;
}

/** The header problems of one response, prefixed with what was fetched. */
function headerProblems(what: string, response: Response, expectedCsp: string): string[] {
  const problems = cspProblems(expectedCsp, response.headers.get('content-security-policy'));
  if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
    problems.push('X-Content-Type-Options should be "nosniff"');
  }
  return problems.map((problem) => `${what}: ${problem}`);
}

/** The first module script `index.html` loads: the entry chunk. */
function entryScriptOf(html: string): string | null {
  const tag = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
  return tag?.[1] ?? null;
}

/**
 * Checks a deployed build (story 1.24): the page answers 200, `_headers` is not published as a
 * file, the entry script answers 200, and the page and the script carry the CSP of
 * `public/_headers` and `nosniff`. Returns every problem found, none stops the others. A host that
 * cannot be reached is a problem too, not a throw.
 */
export async function checkDeployment(
  baseUrl: string,
  expectedCsp: string,
  fetchImpl: FetchLike,
): Promise<string[]> {
  const problems: string[] = [];
  const get = async (url: string): Promise<Response | null> => {
    try {
      return await fetchImpl(url);
    } catch (cause) {
      problems.push(`GET ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      return null;
    }
  };

  const page = await get(baseUrl);
  let entryUrl: string | null = null;
  if (page !== null) {
    if (page.status !== 200) {
      problems.push(`GET ${baseUrl} answered ${page.status}, not 200`);
    } else {
      problems.push(...headerProblems(baseUrl, page, expectedCsp));
      const src = entryScriptOf(await page.text());
      if (src === null) problems.push(`${baseUrl}: no <script src> in the page`);
      else entryUrl = new URL(src, baseUrl).href;
    }
  }

  const headersFile = await get(new URL('_headers', baseUrl).href);
  if (headersFile !== null && headersFile.status === 200) {
    const text = await headersFile.text();
    // A host with a single-page fallback answers 200 with the page: only the rules file itself is a fault.
    if (/Content-Security-Policy\s*:/i.test(text) && /^\s*\/\*/m.test(text)) {
      problems.push('/_headers is published as a file: it must stay a host-only file');
    }
  }

  if (entryUrl !== null) {
    const entry = await get(entryUrl);
    if (entry !== null) {
      if (entry.status !== 200) problems.push(`GET ${entryUrl} answered ${entry.status}, not 200`);
      else problems.push(...headerProblems(entryUrl, entry, expectedCsp));
    }
  }
  return problems;
}

/** The CSP `public/_headers` promises for `/`. */
export async function readExpectedCsp(): Promise<Result<string, string>> {
  let text: string;
  try {
    text = await readFile(join(ROOT, 'public', '_headers'), 'utf8');
  } catch (cause) {
    return err(
      `cannot read public/_headers: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const rules = parseHeaders(text);
  if (!rules.ok) return rules;
  const csp = headersFor(rules.value, '/')['content-security-policy'];
  return csp === undefined ? err('public/_headers has no Content-Security-Policy') : ok(csp);
}

/** `<url>` must be an absolute `https:` URL; a missing trailing slash is added so paths resolve under it. */
export function parseDeployUrl(argv: readonly string[]): Result<string, string> {
  if (argv.length !== 1) return err(USAGE);
  let url: URL;
  try {
    url = new URL(argv[0] as string);
  } catch {
    return err(`"${argv[0]}" is not a URL. ${USAGE}`);
  }
  if (url.protocol !== 'https:') {
    return err(`the deployed build must be served over https:, got ${url.protocol}`);
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return ok(url.href);
}

async function main(): Promise<void> {
  const fail = (message: string): void => {
    log.error('assets', message);
    process.exitCode = 1;
  };
  const url = parseDeployUrl(process.argv.slice(2));
  if (!url.ok) return fail(url.error);
  const csp = await readExpectedCsp();
  if (!csp.ok) return fail(csp.error);
  const problems = await checkDeployment(url.value, csp.value, (target) =>
    // A redirect is a problem to report (a `301` to another host must not read as a 200), and a
    // host that never answers must not hang the check.
    fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(DEPLOY_FETCH_TIMEOUT_MS) }),
  );
  for (const problem of problems) log.error('assets', problem);
  if (problems.length > 0) return fail(`${problems.length} deployment problem(s) at ${url.value}`);
  log.info('assets', 'deployment OK', { url: url.value });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
