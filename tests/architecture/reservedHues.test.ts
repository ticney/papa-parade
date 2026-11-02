import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/client/render/materials/palette.ts';
import { expectedTokens } from './designTokens.ts';
import { extractFrontmatter, parseYamlSubset } from './yamlSubset.ts';

// `parry`, `dodge` and `alert` keep their signal meaning everywhere (DESIGN.md): in the 3D scene, the
// one element that draws with a reserved hue is the glow on the room's dangers (story 7.3, AC 4).

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER_DIR = join(root, 'src', 'client', 'render');
const THE_ONE_USER = 'vfx/dangerTint.ts';
const RESERVED_READ = /PALETTE\.(alert|parry|dodge)\b/;

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the reserved hues in the 3D scene', () => {
  it('PALETTE.alert is the alert of DESIGN.md', () => {
    const tokens = expectedTokens(
      parseYamlSubset(
        extractFrontmatter(
          readFileSync(
            join(
              root,
              '_bmad-output',
              'planning-artifacts',
              'ux-designs',
              'ux-papa-parade-2026-10-26',
              'DESIGN.md',
            ),
            'utf8',
          ),
        ),
      ),
    );
    const alert = tokens.find((token) => token.name === '--pp-color-alert');
    expect(alert?.value.toLowerCase()).toBe(`#${PALETTE.alert.toString(16).padStart(6, '0')}`);
  });

  it(`only ${THE_ONE_USER} names one`, () => {
    const users = sourcesUnder(RENDER_DIR)
      .filter((path) => RESERVED_READ.test(readFileSync(path, 'utf8')))
      .map((path) => relative(RENDER_DIR, path));
    expect(users).toEqual([THE_ONE_USER]);
  });
});
