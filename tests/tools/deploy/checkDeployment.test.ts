import { describe, expect, it } from 'vitest';
import {
  checkDeployment,
  cspProblems,
  type FetchLike,
  parseDeployUrl,
} from '../../../tools/deploy/checkDeployment.ts';

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self'; object-src 'none'; base-uri 'self'";
const HEADERS = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' };
const BASE = 'https://papa.example.dev/';
const PAGE = '<script type="module" src="./assets/index-a.js"></script>';

describe('cspProblems', () => {
  it('accepts the expected policy, whatever the spacing and the order', () => {
    expect(cspProblems(CSP, CSP)).toEqual([]);
    expect(cspProblems(CSP, `font-src   'self' ;${CSP}`)).toEqual([]);
  });

  it('accepts a host that adds its own directives', () => {
    expect(cspProblems(CSP, `${CSP}; upgrade-insecure-requests`)).toEqual([]);
  });

  it('accepts the same sources in another order', () => {
    const reordered = CSP.replace("'self' 'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'self'");
    expect(cspProblems(CSP, reordered)).toEqual([]);
  });

  it('judges a directive written twice by its first occurrence, as a browser does', () => {
    const weakFirst = `script-src 'self' 'unsafe-eval'; ${CSP}`;
    expect(cspProblems(CSP, weakFirst)).toEqual([
      `CSP "script-src" should be "'self' 'wasm-unsafe-eval'", got "'self' 'unsafe-eval'"`,
    ]);
  });

  it('fails a missing header', () => {
    expect(cspProblems(CSP, null)).toEqual(['no Content-Security-Policy header']);
  });

  it('fails a missing and a changed directive, each with its own message', () => {
    const weak =
      "default-src 'self'; script-src 'self' 'unsafe-eval'; object-src 'none'; base-uri 'self'";
    expect(cspProblems(CSP, weak)).toEqual([
      `CSP "script-src" should be "'self' 'wasm-unsafe-eval'", got "'self' 'unsafe-eval'"`,
      `CSP "font-src" should be "'self'", got nothing`,
    ]);
  });
});

describe('parseDeployUrl', () => {
  it('takes one https URL and makes sure it ends with a slash', () => {
    expect(parseDeployUrl(['https://a.dev'])).toEqual({ ok: true, value: 'https://a.dev/' });
    expect(parseDeployUrl(['https://a.dev/x'])).toEqual({ ok: true, value: 'https://a.dev/x/' });
  });

  it.each([[[]], [['a', 'b']], [['not a url']], [['http://a.dev']], [['ftp://a.dev']]])(
    'rejects %j',
    (argv) => {
      expect(parseDeployUrl(argv).ok).toBe(false);
    },
  );
});

/** A host that answers by path; anything not in `routes` is a 404. */
function fakeHost(routes: Record<string, Response | (() => Response) | Error>): FetchLike {
  return async (url) => {
    const route = routes[new URL(url).pathname];
    if (route instanceof Error) throw route;
    if (route === undefined) return new Response('Not found', { status: 404 });
    return typeof route === 'function' ? route() : route.clone();
  };
}

const goodRoutes = (): Record<string, Response> => ({
  '/': new Response(PAGE, { status: 200, headers: HEADERS }),
  '/assets/index-a.js': new Response('export{}', { status: 200, headers: HEADERS }),
});

describe('checkDeployment', () => {
  it('passes a deployment that serves the page and the entry with the policy, and hides _headers', async () => {
    expect(await checkDeployment(BASE, CSP, fakeHost(goodRoutes()))).toEqual([]);
  });

  it('accepts a single-page host that answers /_headers with the page', async () => {
    const routes = { ...goodRoutes(), '/_headers': new Response(PAGE, { status: 200 }) };
    expect(await checkDeployment(BASE, CSP, fakeHost(routes))).toEqual([]);
  });

  it('fails a deployment that publishes _headers as a file', async () => {
    const routes = {
      ...goodRoutes(),
      '/_headers': new Response(`/*\n  Content-Security-Policy: ${CSP}\n`, { status: 200 }),
    };
    const problems = await checkDeployment(BASE, CSP, fakeHost(routes));
    expect(problems).toEqual(['/_headers is published as a file: it must stay a host-only file']);
  });

  it('fails a page that is not a 200, and stops looking for the entry', async () => {
    const routes = { '/': new Response('Boom', { status: 503, headers: HEADERS }) };
    expect(await checkDeployment(BASE, CSP, fakeHost(routes))).toEqual([
      `GET ${BASE} answered 503, not 200`,
    ]);
  });

  it('fails a page that redirects (a 301 to another host is not a 200)', async () => {
    const routes = {
      '/': new Response(null, { status: 301, headers: { location: 'https://elsewhere.dev/' } }),
    };
    expect(await checkDeployment(BASE, CSP, fakeHost(routes))).toEqual([
      `GET ${BASE} answered 301, not 200`,
    ]);
  });

  it('fails an entry script that is not a 200', async () => {
    const routes = { ...goodRoutes() } as Record<string, Response>;
    delete routes['/assets/index-a.js'];
    const problems = await checkDeployment(BASE, CSP, fakeHost(routes));
    expect(problems).toEqual([`GET ${BASE}assets/index-a.js answered 404, not 200`]);
  });

  it('fails a page with no CSP and no nosniff, naming the page', async () => {
    const routes = { ...goodRoutes(), '/': new Response(PAGE, { status: 200 }) };
    expect(await checkDeployment(BASE, CSP, fakeHost(routes))).toEqual([
      `${BASE}: no Content-Security-Policy header`,
      `${BASE}: X-Content-Type-Options should be "nosniff"`,
    ]);
  });

  it('fails an entry script that carries a weaker CSP', async () => {
    const weak = { ...HEADERS, 'content-security-policy': "default-src 'self'" };
    const routes = {
      ...goodRoutes(),
      '/assets/index-a.js': new Response('export{}', { status: 200, headers: weak }),
    };
    const problems = await checkDeployment(BASE, CSP, fakeHost(routes));
    expect(problems.every((problem) => problem.startsWith(`${BASE}assets/index-a.js: CSP`))).toBe(
      true,
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('fails a page that loads no script', async () => {
    const routes = {
      ...goodRoutes(),
      '/': new Response('<p>hi</p>', { status: 200, headers: HEADERS }),
    };
    expect(await checkDeployment(BASE, CSP, fakeHost(routes))).toEqual([
      `${BASE}: no <script src> in the page`,
    ]);
  });

  it('reports an unreachable host instead of throwing', async () => {
    const routes = { '/': new Error('getaddrinfo ENOTFOUND papa.example.dev') };
    const problems = await checkDeployment(BASE, CSP, fakeHost(routes));
    expect(problems[0]).toBe(`GET ${BASE} failed: getaddrinfo ENOTFOUND papa.example.dev`);
  });
});
