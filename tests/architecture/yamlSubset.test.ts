import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractFrontmatter, parseYamlSubset } from './yamlSubset.ts';

const here = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(
  here,
  '..',
  '..',
  '_bmad-output',
  'planning-artifacts',
  'ux-designs',
  'ux-papa-parade-2026-10-26',
  'DESIGN.md',
);

describe('parseYamlSubset', () => {
  it('reads nested maps, bare and quoted scalars', () => {
    expect(
      parseYamlSubset(
        [
          'name: Papa Parade',
          'colors:',
          "  ink: '#2A2140'",
          '  paper: "#FFFFFF"',
          'typography:',
          '  display:',
          "    fontFamily: 'Baloo 2'",
          "    fontWeight: '800'",
          'rounded:',
          '  sm: 8px',
        ].join('\n'),
      ),
    ).toEqual({
      name: 'Papa Parade',
      colors: { ink: '#2A2140', paper: '#FFFFFF' },
      typography: { display: { fontFamily: 'Baloo 2', fontWeight: '800' } },
      rounded: { sm: '8px' },
    });
  });

  it('reads quoted keys, an escaped quote and a colon inside a quoted value', () => {
    expect(parseYamlSubset(['spacing:', "  '1': 4px", "text: 'it''s: fine'"].join('\n'))).toEqual({
      spacing: { '1': '4px' },
      text: "it's: fine",
    });
  });

  it('reads a list of scalars, then goes back out to the parent', () => {
    expect(
      parseYamlSubset(['sources:', '  - ../../a.md', "  - 'b: c'", 'name: x'].join('\n')),
    ).toEqual({
      sources: ['../../a.md', 'b: c'],
      name: 'x',
    });
  });

  it('ignores blank lines and comment lines', () => {
    expect(
      parseYamlSubset(['# note', 'a: 1', '', 'b:', '  # inside', '  c: 2'].join('\n')),
    ).toEqual({
      a: '1',
      b: { c: '2' },
    });
  });

  it.each([
    ['a tab', 'a:\n\tb: 1'],
    ['a flow map', 'a: { b: 1 }'],
    ['a flow list', 'a: [1, 2]'],
    ['an anchor', 'a: &x 1'],
    ['a block scalar', 'a: |\n  text'],
    ['an unquoted colon', 'a: b: c'],
    ['an empty value', 'a:\nb: 1'],
    ['a trailing empty value', 'a:'],
    ['a duplicate key', 'a: 1\na: 2'],
    ['a bad indentation', 'a:\n  b: 1\n   c: 2'],
    ['a list of maps', 'a:\n  - b: 1'],
    ['an unterminated quote', "a: 'b"],
    ['text after a quote', "a: 'b' c"],
  ])('throws on %s', (_name, text) => {
    expect(() => parseYamlSubset(text)).toThrow(/yamlSubset/);
  });
});

describe('extractFrontmatter', () => {
  it('returns the text between the two --- lines', () => {
    expect(extractFrontmatter('---\na: 1\n---\n# Title')).toBe('a: 1');
  });

  it('throws without an opening or a closing ---', () => {
    expect(() => extractFrontmatter('# Title')).toThrow(/start with/);
    expect(() => extractFrontmatter('---\na: 1')).toThrow(/closing/);
  });
});

describe('the real DESIGN.md frontmatter', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));

  it('parses, with the groups the token mirror needs', () => {
    for (const group of ['colors', 'typography', 'rounded', 'spacing', 'components']) {
      expect(frontmatter[group], group).toBeTypeOf('object');
    }
  });

  it('keeps values as the file writes them', () => {
    const colors = frontmatter.colors as Record<string, string>;
    const typography = frontmatter.typography as Record<string, Record<string, string>>;
    const spacing = frontmatter.spacing as Record<string, string>;
    expect(colors.ink).toBe('#2A2140');
    expect(colors.scrim).toBe('rgba(42,33,64,0.62)');
    expect(typography.display).toMatchObject({ fontFamily: 'Baloo 2', fontSize: '56px' });
    expect(spacing['1']).toBe('4px');
    expect(spacing['hud-inset']).toBe('max(12px, env(safe-area-inset-*))');
  });
});
