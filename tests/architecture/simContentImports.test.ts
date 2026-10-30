import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const simDir = join(here, '..', '..', 'src', 'sim');

/** Every non-test `.ts` file under `dir`. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/**
 * The `@content` imports of `source` that are not `import type`: the sim takes content's types and
 * the bundle it is handed, never its runtime (the schemas pull `zod`, which `sim` may not import).
 */
function runtimeContentImports(source: string): string[] {
  const found: string[] = [];
  const pattern = /\b(?:import|export)\s+(?!type\b)[^;'"`]*?\bfrom\s*(['"`])@content\/([^'"`]*)\1/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    found.push(`@content/${match[2]}`);
  }
  return found;
}

describe('the sim imports no runtime from @content', () => {
  it('src/sim holds only `import type` from @content', () => {
    const offenders = sourcesUnder(simDir).flatMap((file) =>
      runtimeContentImports(readFileSync(file, 'utf8')).map((specifier) => `${file}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it('flags a value import and lets a type import through', () => {
    expect(
      runtimeContentImports("import { sequenceDurationMs } from '@content/schemas/sequence';"),
    ).toEqual(['@content/schemas/sequence']);
    expect(
      runtimeContentImports("import type { SequenceDef } from '@content/schemas/sequence';"),
    ).toEqual([]);
    expect(runtimeContentImports("export { x } from '@content/schemas/sequence';")).toEqual([
      '@content/schemas/sequence',
    ]);
  });
});
