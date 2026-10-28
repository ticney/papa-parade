import { describe, expect, it } from 'vitest';
import {
  cspDirectives,
  headersFor,
  parseHeaders,
  sameSources,
  weakSourcesOf,
} from '../../../tools/serve/headers.ts';

const parsed = (text: string) => {
  const result = parseHeaders(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe('parseHeaders', () => {
  it('reads a pattern and its indented headers, skipping comments and blank lines', () => {
    const rules = parsed(
      [
        '# the security headers',
        '',
        '/*',
        '  X-A: one',
        '  # not this',
        '  X-B: two: three',
        '',
      ].join('\n'),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.pattern).toBe('/*');
    expect(rules[0]?.headers).toEqual([
      ['X-A', 'one'],
      ['X-B', 'two: three'],
    ]);
  });

  it('reads the real file shape (CRLF too)', () => {
    const rules = parsed("/*\r\n  Content-Security-Policy: default-src 'self'\r\n");
    expect(headersFor(rules, '/')).toEqual({ 'content-security-policy': "default-src 'self'" });
  });

  it.each([
    ['a header before any pattern', '  X-A: 1\n', 'line 1'],
    ['a pattern that does not start with a slash', 'assets/*\n', 'line 1'],
    ['an indented line with no colon', '/*\n  nonsense\n', 'line 2'],
    ['an empty header value', '/*\n  X-A:\n', 'line 2'],
    ['a header name with a space', '/*\n  X A: 1\n', 'line 2'],
  ])('rejects %s, naming the line', (_label, text, place) => {
    const result = parseHeaders(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(place);
  });
});

describe('headersFor', () => {
  const rules = parsed(
    [
      '/*',
      '  X-All: yes',
      '/assets/*',
      '  Cache-Control: immutable',
      '/index.html',
      '  X-Page: home',
    ].join('\n'),
  );

  it('applies a /* rule to every path', () => {
    expect(headersFor(rules, '/')).toEqual({ 'x-all': 'yes' });
    expect(headersFor(rules, '/deep/er/file.js')).toEqual({ 'x-all': 'yes' });
  });

  it('adds a specific rule on top of /*', () => {
    expect(headersFor(rules, '/assets/a.js')).toEqual({
      'x-all': 'yes',
      'cache-control': 'immutable',
    });
    expect(headersFor(rules, '/index.html')).toEqual({ 'x-all': 'yes', 'x-page': 'home' });
  });

  it('matches an exact pattern exactly, with dots literal', () => {
    expect(headersFor(rules, '/indexXhtml')).toEqual({ 'x-all': 'yes' });
    expect(headersFor(rules, '/index.html/more')).toEqual({ 'x-all': 'yes' });
  });

  it('joins the values of a header set by two matching rules', () => {
    const twice = parsed('/*\n  X-A: one\n/a*\n  X-A: two\n');
    expect(headersFor(twice, '/abc')).toEqual({ 'x-a': 'one, two' });
  });

  it('gives nothing when no rule matches', () => {
    expect(headersFor(parsed('/assets/*\n  X-A: 1\n'), '/')).toEqual({});
  });
});

describe('cspDirectives', () => {
  it('keeps the first of a directive written twice, as a browser does', () => {
    const directives = cspDirectives("script-src 'self'; script-src 'self' 'unsafe-eval'");
    expect([...directives]).toEqual([['script-src', "'self'"]]);
  });

  it('splits a policy into directives with their sources, whitespace collapsed', () => {
    const directives = cspDirectives(
      "default-src 'self';  script-src 'self'   'wasm-unsafe-eval' ;",
    );
    expect([...directives]).toEqual([
      ['default-src', "'self'"],
      ['script-src', "'self' 'wasm-unsafe-eval'"],
    ]);
  });

  it('is empty for an empty policy', () => {
    expect(cspDirectives('').size).toBe(0);
  });
});

describe('sameSources', () => {
  it('ignores order and spacing', () => {
    expect(sameSources("'self'  'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'self'")).toBe(true);
    expect(sameSources("'self'", "'self' 'unsafe-eval'")).toBe(false);
  });
});

describe('weakSourcesOf', () => {
  it('lists the sources that open a policy', () => {
    expect(weakSourcesOf("'self' https: * 'unsafe-inline'")).toEqual([
      'https:',
      '*',
      "'unsafe-inline'",
    ]);
    expect(weakSourcesOf("'self' 'wasm-unsafe-eval'")).toEqual([]);
  });
});
