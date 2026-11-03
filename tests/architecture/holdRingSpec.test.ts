import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHRONO_RING_FINAL_ARC_STROKE_PX,
  CHRONO_RING_GAP_PX,
  CHRONO_RING_NOTCH_PX,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  TARGET_HIGHLIGHT_STROKE_PX,
} from '@shared/constants';
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

describe('breath-ring constants match DESIGN.md (story 4.9)', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const ring = (frontmatter.components as YamlMap)['breath-ring'] as YamlMap;

  it('is the hold-ring’s band and ink outline, with the same constants', () => {
    expect(ring.strokeWidth).toBe(`${HOLD_RING_STROKE_PX}px`);
    expect(ring.outerOutline).toBe(`${HOLD_RING_OUTLINE_PX}px {colors.ink}`);
    expect(ring.progress).toBe('{colors.paper}');
    expect(ring.track).toBe('{colors.ring-track}');
  });

  it("is told in the frozen feel's breathCapacityMs", () => {
    expect(ring.durationMs).toBe(String(createTestContent().feel.stealth.breathCapacityMs));
  });
});

describe('chrono-ring constants match DESIGN.md (story 2.11)', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const components = frontmatter.components as YamlMap;
  const ring = components['chrono-ring'] as YamlMap;

  it('is the hold-ring’s band and ink outline, outside it by a gap', () => {
    expect(ring.strokeWidth).toBe(`${HOLD_RING_STROKE_PX}px`);
    expect(ring.outerOutline).toBe(`${HOLD_RING_OUTLINE_PX}px {colors.ink}`);
    expect(ring.gapFromHoldRing).toBe(`${CHRONO_RING_GAP_PX}px`);
    expect(ring.placement).toBe('outside the hold-ring');
  });

  it('fills clockwise in paper over a ring-track', () => {
    expect(ring.direction).toBe('clockwise');
    expect(ring.progress).toBe('{colors.paper}');
    expect(ring.track).toBe('{colors.ring-track}');
  });

  it('lights an 8 px alert arc that grows outward, with a 2 px ink notch', () => {
    expect(ring.finalArc).toBe('{colors.alert}');
    expect(ring.finalArcStrokeWidth).toBe(`${CHRONO_RING_FINAL_ARC_STROKE_PX}px`);
    expect(ring.finalArcGrowth).toBe('outward');
    expect(ring.perfectNotch).toBe(`${CHRONO_RING_NOTCH_PX}px {colors.ink} tick`);
  });

  it('is never parry or dodge coloured, and has no ring on a Wait, a Do nothing or a feint', () => {
    expect(ring.never).toContain('{colors.parry}');
    expect(ring.never).toContain('{colors.dodge}');
    expect(ring.never).toContain('no ring on Wait, Do nothing or feints');
  });

  it('keeps the target-highlight’s ring at the constant the footprint is computed from', () => {
    const highlight = components['target-highlight'] as YamlMap;
    expect(highlight.outline).toBe(`${TARGET_HIGHLIGHT_STROKE_PX}px solid {colors.alert}`);
  });
});
