import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLD_RING_OUTLINE_PX, HOLD_RING_STROKE_PX } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../support/testContent.ts';
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
 * The hold-ring's pixel sizes are DESIGN.md component values, kept in `constants.ts` and not as CSS
 * literals. This is the drift test (like `tapMarkerSpec.test.ts`): change one side and it fails
 * until the other follows. The fill duration is not a constant: it is `feel.input.holdMinMs`, which
 * Geo tunes, and DESIGN's `durationMs` is checked against the frozen test feel.
 */
describe('hold-ring constants match DESIGN.md', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const ring = (frontmatter.components as YamlMap)['hold-ring'] as YamlMap;

  it('has a progress band of strokeWidth', () => {
    expect(ring.strokeWidth).toBe(`${HOLD_RING_STROKE_PX}px`);
  });

  it('has an ink outer outline of outerOutline', () => {
    expect(ring.outerOutline).toBe(`${HOLD_RING_OUTLINE_PX}px {colors.ink}`);
  });

  it('fills paper over a ring-track, and closes solid paper', () => {
    expect(ring.progress).toBe('{colors.paper}');
    expect(ring.track).toBe('{colors.ring-track}');
    expect(ring.closed).toContain('{colors.paper}');
  });

  it("fills in the frozen feel's holdMinMs", () => {
    expect(ring.durationMs).toBe(String(createTestContent().feel.input.holdMinMs));
  });
});
