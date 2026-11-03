import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHRONO_RING_FINAL_ARC_STROKE_PX,
  CHRONO_RING_GAP_PX,
  CHRONO_RING_NOTCH_PX,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  TARGET_HIGHLIGHT_OUTLINE_PX,
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

const UI_CSS = join(here, '..', '..', 'src', 'client', 'ui', 'styles', 'ui.css');

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

  it('gives the target-highlight the same 2 px ink outline as the rings, from one constant', () => {
    // The constant feeds the footprint (`threatFootprint`) and the CSS reach: it must be the width the CSS draws.
    expect(TARGET_HIGHLIGHT_OUTLINE_PX).toBe(HOLD_RING_OUTLINE_PX);
    const css = readFileSync(UI_CSS, 'utf8');
    const rule = /\.pp-threat-highlight\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('border: var(--pp-highlight-stroke) solid var(--pp-color-alert)');
    expect(rule).toContain('0 0 0 var(--pp-highlight-outline) var(--pp-color-ink)');
    expect(rule).toContain('inset 0 0 0 var(--pp-highlight-outline) var(--pp-color-ink)');
    // No px literal sneaks in beside the two custom properties.
    expect(rule).not.toMatch(/\d+px\s+(solid|var)|0 0 0 \d+px/);
  });
});

describe('the silence ring takes no pixel literal of its own (story 2.11)', () => {
  const css = readFileSync(UI_CSS, 'utf8');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: (selector as string).trim(), body: body as string }),
  );

  it('sizes and places it from the bubble’s custom properties, and the band from the hold-ring’s constants', () => {
    const ringRules = rules.filter((rule) => /\.pp-silence-ring/.test(rule.selector));
    expect(ringRules.length).toBeGreaterThan(0);
    for (const { selector, body } of ringRules) {
      // The 0.5px is the anti-aliasing edge of a mask, not a size; 0px is the placeholder of an inline value.
      const literals = body.replace(/\b0(\.5)?px\b/g, '').match(/\b\d+(\.\d+)?px\b/g);
      expect(literals, selector).toBeNull();
    }
    // Written inline from the constants, never defaulted in CSS to a size (a copy would drift unpinned).
    expect(css).not.toMatch(/--pp-silence-ring-(stroke|outline):\s*[1-9]/);
  });
});
