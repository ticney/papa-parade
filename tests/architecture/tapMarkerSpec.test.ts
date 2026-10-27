import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAP_MARKER_FADE_MS, TAP_MARKER_SCALE_FROM, TAP_MARKER_SCALE_TO } from '@shared/constants';
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
 * The tap marker's numbers are DESIGN.md component values, kept in `constants.ts` and not as CSS
 * literals. This is the drift test: change one side and it fails until the other follows.
 */
describe('tap-marker constants match DESIGN.md', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const marker = (frontmatter.components as YamlMap)['tap-marker'] as YamlMap;

  it('fades over fadeMs', () => {
    expect(marker.fadeMs).toBe(String(TAP_MARKER_FADE_MS));
  });

  it('scales from the start to the end of `scale`', () => {
    expect(marker.scale).toBe(`${TAP_MARKER_SCALE_FROM} → ${TAP_MARKER_SCALE_TO}`);
  });

  it('is built of the paper ring and the ink outline', () => {
    expect(marker.ringColor).toBe('{colors.paper}');
    expect(marker.outlineColor).toBe('{colors.ink}');
  });
});
