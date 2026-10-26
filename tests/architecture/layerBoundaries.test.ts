import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOUNDARY_RULES, findImports, maskSource, scanLayerBoundaries } from './scanners.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'layers');

interface Case {
  fixture: string;
  rule: string;
  file: string;
  detail: string;
}

// One offending fixture per rule (several for the rules with several forbidden edges).
const CASES: Case[] = [
  { fixture: 'r1-shared-imports-client', rule: 'R1', file: 'src/shared/a.ts', detail: '@client/x' },
  { fixture: 'r1-shared-imports-package', rule: 'R1', file: 'src/shared/a.ts', detail: 'zod' },
  {
    fixture: 'r1-shared-imports-relative-escape',
    rule: 'R1',
    file: 'src/shared/a.ts',
    detail: '../sim/x',
  },
  { fixture: 'r2-content-imports-three', rule: 'R2', file: 'src/content/a.ts', detail: 'three' },
  { fixture: 'r2-content-imports-sim', rule: 'R2', file: 'src/content/a.ts', detail: '@sim' },
  {
    fixture: 'r2-content-imports-capacitor',
    rule: 'R2',
    file: 'src/content/a.ts',
    detail: '@capacitor/haptics',
  },
  {
    fixture: 'r2-content-imports-debug-static',
    rule: 'R2',
    file: 'src/content/a.ts',
    detail: '@debug/overlay',
  },
  {
    fixture: 'r3-sim-imports-client-relative',
    rule: 'R3',
    file: 'src/sim/a.ts',
    detail: '../client/x',
  },
  { fixture: 'r3-sim-imports-three', rule: 'R3', file: 'src/sim/a.ts', detail: 'three' },
  {
    fixture: 'r3-sim-imports-client-index',
    rule: 'R3',
    file: 'src/sim/a.ts',
    detail: '../client',
  },
  { fixture: 'r3-sim-requires-three', rule: 'R3', file: 'src/sim/a.ts', detail: 'three' },
  { fixture: 'r3-sim-mts-imports-three', rule: 'R3', file: 'src/sim/a.mts', detail: 'three' },
  {
    fixture: 'r3-sim-imports-capacitor',
    rule: 'R3',
    file: 'src/sim/a.ts',
    detail: '@capacitor/haptics',
  },
  {
    fixture: 'r3-sim-imports-platform',
    rule: 'R3',
    file: 'src/sim/a.ts',
    detail: '@platform/platform',
  },
  { fixture: 'r3-sim-imports-bots', rule: 'R3', file: 'src/sim/a.ts', detail: '@bots/perfect' },
  { fixture: 'r3-sim-imports-debug', rule: 'R3', file: 'src/sim/a.ts', detail: '@debug/overlay' },
  { fixture: 'r3b-sim-imports-log', rule: 'R3b', file: 'src/sim/a.ts', detail: '@shared/log' },
  {
    fixture: 'r4-sim-imports-rapier',
    rule: 'R4',
    file: 'src/sim/threats/a.ts',
    detail: '@dimforge/rapier3d-deterministic-compat',
  },
  ...['client', 'bots', 'platform', 'content'].map((zone) => ({
    fixture: `r4-${zone}-imports-rapier`,
    rule: 'R4',
    file: `src/${zone}/a.ts`,
    detail: '@dimforge/rapier3d-deterministic-compat',
  })),
  {
    fixture: 'r5-bots-imports-content',
    rule: 'R5',
    file: 'src/bots/a.ts',
    detail: '@content/schema',
  },
  {
    fixture: 'r5-bots-imports-sim-internals',
    rule: 'R5',
    file: 'src/bots/a.ts',
    detail: '../sim/world',
  },
  {
    fixture: 'r5-bots-imports-sim-deep-alias',
    rule: 'R5',
    file: 'src/bots/a.ts',
    detail: '@sim/world',
  },
  { fixture: 'r5-bots-imports-client', rule: 'R5', file: 'src/bots/a.ts', detail: '@client/x' },
  { fixture: 'r5-bots-imports-three', rule: 'R5', file: 'src/bots/a.ts', detail: 'three' },
  { fixture: 'r6-platform-imports-sim', rule: 'R6', file: 'src/platform/a.ts', detail: '@sim' },
  { fixture: 'r6-platform-imports-three', rule: 'R6', file: 'src/platform/a.ts', detail: 'three' },
  {
    fixture: 'r6-platform-imports-bots',
    rule: 'R6',
    file: 'src/platform/a.ts',
    detail: '@bots/perfect',
  },
  {
    fixture: 'r6-platform-imports-content',
    rule: 'R6',
    file: 'src/platform/a.ts',
    detail: '@content/schema',
  },
  {
    fixture: 'r7-client-imports-debug-static',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '@debug/overlay',
  },
  {
    fixture: 'r7-client-imports-debug-dynamic-outside-boot',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '@debug/overlay',
  },
  {
    fixture: 'r7-client-imports-bots-dynamic-outside-boot',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '@bots/perfect',
  },
  {
    fixture: 'r7-client-template-import-debug',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '@debug/',
  },
  {
    fixture: 'r7-client-globs-sim-internals',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '../sim/*.ts',
  },
  { fixture: 'r7-client-imports-sim-index', rule: 'R7', file: 'src/client/a.ts', detail: '../sim' },
  {
    fixture: 'r7-client-imports-sim-internals',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '@sim/world',
  },
  {
    fixture: 'r7-client-imports-sim-relative',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '../sim/index.ts',
  },
  {
    fixture: 'r7-client-imports-bots-static',
    rule: 'R7',
    file: 'src/client/a.ts',
    detail: '@bots/perfect',
  },
  { fixture: 'r8-src-imports-tools', rule: 'R8', file: 'src/client/a.ts', detail: '../../tools/x' },
  {
    fixture: 'r9-bots-imports-debug-static',
    rule: 'R9',
    file: 'src/bots/a.ts',
    detail: '@debug/overlay',
  },
  {
    fixture: 'r9-entry-imports-debug-static',
    rule: 'R9',
    file: 'src/main.ts',
    detail: '@debug/overlay',
  },
  {
    fixture: 'r9-platform-imports-debug-static',
    rule: 'R9',
    file: 'src/platform/a.ts',
    detail: '@debug/overlay',
  },
  { fixture: 'r10-sim-imports-entry', rule: 'R10', file: 'src/sim/a.ts', detail: '../main.ts' },
  { fixture: 'r10-client-imports-entry', rule: 'R10', file: 'src/client/a.ts', detail: '../main' },
  // Files and imports that no layer rule can place are refused instead of skipped.
  {
    fixture: 'layout-unknown-folder',
    rule: 'LAYOUT',
    file: 'src/clients/a.ts',
    detail: 'src/clients/a.ts',
  },
  {
    fixture: 'unresolved-import-unknown-folder',
    rule: 'UNRESOLVED',
    file: 'src/client/a.ts',
    detail: '../clients/x',
  },
  {
    fixture: 'unresolved-import-escapes-repo',
    rule: 'UNRESOLVED',
    file: 'src/client/a.ts',
    detail: '../../../x',
  },
  {
    fixture: 'unresolved-dynamic-template',
    rule: 'UNRESOLVED',
    file: 'src/client/a.ts',
    detail: '',
  },
];

describe('layerBoundaries', () => {
  it('the repository respects every rule', () => {
    expect(scanLayerBoundaries(join(here, '..', '..'))).toEqual([]);
  });

  it('has an offending fixture for every rule', () => {
    const covered = new Set(CASES.map((c) => c.rule));
    expect(BOUNDARY_RULES.filter((r) => !covered.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  for (const { fixture, rule, file, detail } of CASES) {
    it(`${rule}: flags "${fixture}"`, () => {
      const violations = scanLayerBoundaries(join(fixtures, fixture));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ rule, file, detail });
    });
  }

  it('accepts every allowed edge', () => {
    expect(scanLayerBoundaries(join(fixtures, 'allowed'))).toEqual([]);
  });
});

describe('findImports', () => {
  it('finds static, type-only, re-export, side-effect and dynamic imports', () => {
    const source = `
      import a from 'a';
      import type { B } from "b";
      import { c,
        d } from '@shared/c';
      export * from './e.ts';
      export { f } from 'f';
      import 'g';
      const h = await import('h');
      const i = import(\`i\`);
    `;
    expect(findImports(source)).toEqual([
      { specifier: 'a', dynamic: false },
      { specifier: 'b', dynamic: false },
      { specifier: '@shared/c', dynamic: false },
      { specifier: './e.ts', dynamic: false },
      { specifier: 'f', dynamic: false },
      { specifier: 'g', dynamic: false },
      { specifier: 'h', dynamic: true },
      { specifier: 'i', dynamic: true },
    ]);
  });

  it('ignores imports inside comments and strings', () => {
    const source = `
      // import x from 'in-line-comment';
      /* import y from 'block-comment'; */
      const s = "import z from 'in-string'";
      const t = \`import w from 'in-template'\`;
      import real from 'real';
    `;
    expect(findImports(source)).toEqual([{ specifier: 'real', dynamic: false }]);
  });

  it('finds require() calls and the first pattern of import.meta.glob', () => {
    const source = `
      const a = require('a');
      const b = import.meta.glob('../client/*.ts');
      const c = import.meta.glob(['./c/*.ts', '!./c/skip.ts'], { eager: true });
      const d = import.meta.globEager('./d/*.ts');
      const notRequire = obj.require('nope');
    `;
    expect(findImports(source)).toEqual([
      { specifier: 'a', dynamic: false },
      { specifier: '../client/*.ts', dynamic: true },
      { specifier: './c/*.ts', dynamic: true },
      { specifier: './d/*.ts', dynamic: false },
    ]);
  });

  it('keeps the static start of a template import with a substitution', () => {
    const source = `
      const a = import(\`@client/\${name}\`);
      const b = import(\`\${name}\`);
      const c = import(\`./levels/\${id}.json\`);
    `;
    expect(findImports(source)).toEqual([
      { specifier: '@client/', dynamic: true, partial: true },
      { specifier: '', dynamic: true, partial: true },
      { specifier: './levels/', dynamic: true, partial: true },
    ]);
  });

  it('does not take an export without `from` for a re-export', () => {
    const source = `
      export const x = 1;
      export function y() {}
      import real from 'real';
    `;
    expect(findImports(source)).toEqual([{ specifier: 'real', dynamic: false }]);
  });

  it('finds an import used inside a template substitution', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
    const source = 'const a = `x ${await import("dyn")} y`;';
    expect(findImports(source)).toEqual([{ specifier: 'dyn', dynamic: true }]);
  });
});

describe('maskSource', () => {
  it('keeps the length and the newlines', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
    const source = "const a = 'x'; // c\n/* d\n e */ const b = `t${1}u`;\n";
    const { masked } = maskSource(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
  });

  it('blanks comments, string contents and regex literals but keeps code', () => {
    const { masked } = maskSource("const a = /Date/.test('Date'); // Date\nDate.now();");
    expect(masked.match(/Date/g)).toHaveLength(1);
  });

  it('treats a slash after an identifier as a division', () => {
    const { masked } = maskSource("const half = total / 2; const s = 'Date'; Date.now() / 2;");
    expect(masked.match(/Date/g)).toHaveLength(1);
  });

  it('treats a slash after a non-null assertion as a division', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test is a template literal
    const source = "const a = `${items[0]! / total} ${x! / 2}`; const s = 'Date'; Date.now();";
    expect(maskSource(source).masked.match(/Date/g)).toHaveLength(1);
  });

  it('still reads a slash after a negation as a regex', () => {
    const { masked } = maskSource(
      'const ok = !/Date/.test(s) && a && !/Date/.test(t); Date.now();',
    );
    expect(masked.match(/Date/g)).toHaveLength(1);
  });

  it('treats a slash after a keyword-named property as a division', () => {
    const { masked } = maskSource(
      "const a = o.of / 2; const s = 'Date'; const b = x.in / n; Date.now();",
    );
    expect(masked.match(/Date/g)).toHaveLength(1);
  });

  it('does not let an unterminated regex-looking slash swallow the rest of the line', () => {
    const { masked } = maskSource('const a = (b) /* c */ ; return /not closed; Date.now();');
    expect(masked.match(/Date/g)).toHaveLength(1);
  });
});
