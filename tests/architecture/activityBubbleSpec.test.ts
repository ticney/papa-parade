import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_BUBBLE_BORDER_PX,
  ACTIVITY_BUBBLE_COMPACT_PX,
  ACTIVITY_BUBBLE_REDUCED_BORDER_PX,
  ACTIVITY_BUBBLE_REFUSED_SHAKE_MS,
  ACTIVITY_BUBBLE_REGULAR_PX,
  HOLD_RING_OUTLINE_PX,
  HOLD_RING_STROKE_PX,
  THREAT_ICON_COMPACT_PX,
  THREAT_ICON_REGULAR_PX,
} from '@shared/constants';
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
const UI_CSS = join(here, '..', '..', 'src', 'client', 'ui', 'styles', 'ui.css');

/**
 * The activity bubble's pixel sizes and the refused shake are DESIGN.md component values, kept in
 * `constants.ts` and not as CSS literals (story 2.12). The drift test, like `holdRingSpec.test.ts`:
 * change one side and it fails until the other follows.
 */
describe('activity-bubble constants match DESIGN.md (story 2.12)', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const bubble = (frontmatter.components as YamlMap)['activity-bubble'] as YamlMap;

  it('is a paper disc with a 3 px ink border and an ink pictogram', () => {
    expect(bubble.backgroundColor).toBe('{colors.paper}');
    expect(bubble.borderColor).toBe('{colors.ink}');
    expect(bubble.borderWidth).toBe(`${ACTIVITY_BUBBLE_BORDER_PX}px`);
    expect(bubble.rounded).toBe('{rounded.full}');
    expect(bubble.pictogramColor).toBe('{colors.ink}');
  });

  it('is 48 px on the compact surface and 56 px on the regular one', () => {
    expect(bubble.sizeCompact).toBe(`${ACTIVITY_BUBBLE_COMPACT_PX}px`);
    expect(bubble.sizeRegular).toBe(`${ACTIVITY_BUBBLE_REGULAR_PX}px`);
  });

  it('has the hold-ring’s band and outline, and drains counter-clockwise', () => {
    expect(bubble.ring).toContain(`${HOLD_RING_STROKE_PX}px {colors.paper} on {colors.ring-track}`);
    expect(bubble.ring).toContain(`${HOLD_RING_OUTLINE_PX}px {colors.ink} outline`);
    expect(bubble.ring).toContain('counter-clockwise');
  });

  it('shakes for refusedShakeMs on a refused tap, with no tap marker, and moves the combo badge to its right', () => {
    expect(bubble.refusedShakeMs).toBe(String(ACTIVITY_BUBBLE_REFUSED_SHAKE_MS));
    expect(bubble.refusedTapMarker).toBe('none');
    expect(bubble.comboBadge).toContain('right of the bubble');
  });

  it('is never a threat colour', () => {
    const text = JSON.stringify(bubble);
    for (const colour of ['parry', 'dodge', 'alert'])
      expect(text).not.toContain(`colors.${colour}`);
  });

  it('thickens the border from 3 px to 5 px under reduced motion, as the gauge alert does', () => {
    expect(ACTIVITY_BUBBLE_REDUCED_BORDER_PX).toBeGreaterThan(ACTIVITY_BUBBLE_BORDER_PX);
    expect(ACTIVITY_BUBBLE_REDUCED_BORDER_PX).toBe(5);
  });
});

describe('the bubble’s stylesheet takes no pixel size of its own (story 2.12)', () => {
  const css = readFileSync(UI_CSS, 'utf8');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: (selector as string).trim(), body: body as string }),
  );

  it('sizes, places and widens it from custom properties the constants write', () => {
    const own = rules.filter((rule) => /\.pp-activity-(?!body--refused)/.test(rule.selector));
    expect(own.length).toBeGreaterThan(0);
    for (const { selector, body } of own) {
      // The 0.5px is a mask's anti-aliasing edge; 0px is the placeholder of an inline or root value.
      const literals = body.replace(/\b0(\.5)?px\b/g, '').match(/\b\d+(\.\d+)?px\b/g);
      expect(literals, selector).toBeNull();
    }
    // Written from the constants, never defaulted in CSS to a size (a copy would drift unpinned).
    expect(css).not.toMatch(/--pp-activity-[a-z-]+:\s*[1-9]\d*px/);
  });

  it('keeps the threat icon’s size at the constants the bubble’s layout is computed from', () => {
    expect(css).toMatch(new RegExp(`--pp-threat-size:\\s*${THREAT_ICON_REGULAR_PX}px`));
    const compact = /:root\[data-pp-surface="compact"\]\s*\{\s*--pp-threat-size:\s*(\d+)px/.exec(
      css,
    );
    expect(compact?.[1]).toBe(String(THREAT_ICON_COMPACT_PX));
  });

  it('never gives the bubble a threat colour', () => {
    const own = rules.filter((rule) => /\.pp-activity-/.test(rule.selector));
    for (const { selector, body } of own) {
      expect(body, selector).not.toMatch(/--pp-color-(parry|dodge|alert)/);
    }
  });
});
