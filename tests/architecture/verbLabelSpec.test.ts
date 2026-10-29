import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THREAT_SHAPE_COLORS } from '@content/schemas/threat';
import { VERB_MIN_FONT_PX, VERB_STROKE_PX } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { extractFrontmatter, parseYamlSubset, type YamlMap } from './yamlSubset.ts';

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

/**
 * The verb label's pixel floor and stroke are DESIGN.md component values, kept in `constants.ts` and
 * not as CSS literals. This is the drift test (like `holdRingSpec.test.ts`): change one side and it
 * fails until the other follows. The verb's font sizes are `typography.verb` / `verb-compact`, already
 * tied to `tokens.css` by `designTokens.test.ts`: not repeated here.
 */
describe('verb-label and threat-icon constants match DESIGN.md', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const components = frontmatter.components as YamlMap;
  const label = components['verb-label'] as YamlMap;
  const icon = components['threat-icon'] as YamlMap;

  it('never goes below minFontSize', () => {
    expect(label.minFontSize).toBe(`${VERB_MIN_FONT_PX}px`);
  });

  it('has an ink outline of strokeWidth, painted under the fill', () => {
    expect(label.strokeWidth).toBe(`${VERB_STROKE_PX}px`);
    expect(label.paintOrder).toBe('stroke');
    expect(label.strokeColor).toBe('{colors.ink}');
  });

  it('is paper on ink, uppercase, with a hard ink shadow', () => {
    expect(label.textColor).toBe('{colors.paper}');
    expect(label.textTransform).toBe('uppercase');
    expect(label.shadow).toBe('hard, {colors.ink}');
  });

  it('uses the verb typography, and the compact one on the compact surface', () => {
    expect(label.typography).toBe('{typography.verb}');
    expect(label.typographyCompact).toBe('{typography.verb-compact}');
  });

  it("pairs parry with a circle and dodge with a triangle, as the threat schema's pairs do", () => {
    expect(icon.parryShape).toBe('circle');
    expect(icon.dodgeShape).toBe('triangle');
    expect(THREAT_SHAPE_COLORS.circle).toBe('parry');
    expect(THREAT_SHAPE_COLORS.triangle).toBe('dodge');
    expect(icon.parryColor).toBe('{colors.parry}');
    expect(icon.dodgeColor).toBe('{colors.dodge}');
  });
});
