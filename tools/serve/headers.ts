import { err, ok, type Result } from '@shared/result';

/** One block of a `_headers` file: a URL pattern and the headers that go with it. */
export interface HeaderRule {
  /** The pattern as written (`/*`, `/assets/*`, `/index.html`). */
  pattern: string;
  /** What `pattern` matches, compiled: `*` is any run of characters (a splat), the rest is literal. */
  matcher: RegExp;
  /** Header name (as written) and value, in file order. */
  headers: readonly (readonly [name: string, value: string])[];
}

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parses a `_headers` file, the format Cloudflare Pages and Netlify both read from the published
 * folder: a URL pattern on a line of its own, then its headers indented, `Name: value` each.
 * Blank lines and `#` comments are skipped. A line that fits none of these is an `err` that names
 * its line number: a typo in the security headers must never be silently ignored.
 */
export function parseHeaders(text: string): Result<HeaderRule[], string> {
  const rules: { pattern: string; headers: [string, string][] }[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] as string;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const place = `_headers line ${index + 1}`;
    if (!/^\s/.test(raw)) {
      if (!trimmed.startsWith('/')) {
        return err(`${place}: a URL pattern starts with "/": ${trimmed}`);
      }
      rules.push({ pattern: trimmed, headers: [] });
      continue;
    }
    const current = rules.at(-1);
    if (current === undefined) return err(`${place}: a header comes before any URL pattern`);
    const colon = trimmed.indexOf(':');
    if (colon <= 0) return err(`${place}: expected "Name: value", got "${trimmed}"`);
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name) || value === '') {
      return err(`${place}: expected "Name: value", got "${trimmed}"`);
    }
    current.headers.push([name, value]);
  }
  return ok(
    rules.map(({ pattern, headers }) => ({
      pattern,
      matcher: new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`),
      headers,
    })),
  );
}

/**
 * The headers to send for `urlPath`, names in lower case. Every matching rule counts; when two
 * rules set the same header the values are joined with `, `, as Cloudflare Pages does.
 */
export function headersFor(rules: readonly HeaderRule[], urlPath: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (!rule.matcher.test(urlPath)) continue;
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase();
      merged[key] = key in merged ? `${merged[key]}, ${value}` : value;
    }
  }
  return merged;
}

/** A Content-Security-Policy as `directive name → its value` (the sources, whitespace collapsed). */
export function cspDirectives(csp: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const part of csp.split(';')) {
    const words = part
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '');
    const [name, ...sources] = words;
    if (name !== undefined) directives.set(name.toLowerCase(), sources.join(' '));
  }
  return directives;
}
