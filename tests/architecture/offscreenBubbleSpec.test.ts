import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HUD_MAX_DOM_NODES,
  OFFSCREEN_BUBBLE_BORDER_PX,
  OFFSCREEN_BUBBLE_ICON_COMPACT_PX,
  OFFSCREEN_BUBBLE_ICON_REGULAR_PX,
  OFFSCREEN_BUBBLE_MAX_COUNT,
  OFFSCREEN_BUBBLE_MAX_NODES,
  OFFSCREEN_BUBBLE_STACK_GAP_PX,
  TOUCH_TARGET_MIN_PX,
} from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { offscreenBubbleRadii } from '../../src/client/ui/world/offscreenLayout.ts';
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
const EXPERIENCE = join(dirname(DESIGN), 'EXPERIENCE.md');
const TOKENS_CSS = join(here, '..', '..', 'src', 'client', 'ui', 'styles', 'tokens.css');
const UI_CSS = join(here, '..', '..', 'src', 'client', 'ui', 'styles', 'ui.css');

/** The value of a `--pp-…: <n>px` token in `tokens.css`. */
function tokenPx(css: string, name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+)px`).exec(css);
  if (match === null) throw new Error(`${name} is not a px token in tokens.css`);
  return Number(match[1]);
}

/**
 * The off-screen bubble's sizes are DESIGN.md component values kept in `constants.ts`, not CSS
 * literals (story 9.3, D9). The drift test, like `activityBubbleSpec.test.ts`: change one side and it
 * fails until the other follows.
 */
describe('offscreen-bubble constants match DESIGN.md (story 9.3)', () => {
  const frontmatter = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));
  const bubble = (frontmatter.components as YamlMap)['offscreen-bubble'] as YamlMap;
  const tokens = readFileSync(TOKENS_CSS, 'utf8');

  it('is a paper disc with a 3 px ink border', () => {
    expect(bubble.backgroundColor).toBe('{colors.paper}');
    expect(bubble.borderColor).toBe('{colors.ink}');
    expect(bubble.borderWidth).toBe(`${OFFSCREEN_BUBBLE_BORDER_PX}px`);
    expect(bubble.rounded).toBe('{rounded.full}');
  });

  it('holds the icon at 40 px on the compact surface and 48 px on the regular one', () => {
    expect(bubble.iconSizeCompact).toBe(`${OFFSCREEN_BUBBLE_ICON_COMPACT_PX}px`);
    expect(bubble.iconSizeRegular).toBe(`${OFFSCREEN_BUBBLE_ICON_REGULAR_PX}px`);
  });

  it('holds the icon, its chrono-ring and an ink chevron', () => {
    expect(bubble.content).toContain('threat-icon (shape and colour kept)');
    expect(bubble.content).toContain('chrono-ring');
    expect(bubble.content).toContain('{colors.ink} chevron');
  });

  it('is at most 3, stacked a {spacing.2} apart, on the left, right and top edges', () => {
    expect(bubble.maxCount).toBe(String(OFFSCREEN_BUBBLE_MAX_COUNT));
    expect(bubble.stackGap).toBe('{spacing.2}');
    expect(OFFSCREEN_BUBBLE_STACK_GAP_PX).toBe(tokenPx(tokens, '--pp-spacing-2'));
    expect(bubble.edges).toBe('left, right, top; never the bottom third');
    expect(bubble.inset).toBe('{spacing.hud-inset}');
  });

  it('is at least the touch target on both surfaces', () => {
    expect(bubble.minSize).toBe('{spacing.touch-target-min}');
    expect(TOUCH_TARGET_MIN_PX).toBe(tokenPx(tokens, '--pp-spacing-touch-target-min'));
    for (const iconPx of [OFFSCREEN_BUBBLE_ICON_COMPACT_PX, OFFSCREEN_BUBBLE_ICON_REGULAR_PX]) {
      expect(offscreenBubbleRadii(iconPx).discPx * 2).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN_PX);
    }
  });

  it('leaves the silence to its own bubble', () => {
    expect(bubble.silence).toContain('silence-bubble, without arrow');
  });
});

describe('the HUD’s node budget (story 9.3, UX-DR26)', () => {
  it('is the one EXPERIENCE.md states, and holds the big room’s HUD with 3 bubbles', () => {
    const row = /\| HUD DOM nodes \| (\d+) or fewer/.exec(readFileSync(EXPERIENCE, 'utf8'));
    expect(Number(row?.[1])).toBe(HUD_MAX_DOM_NODES);
    // Measured in salon_kitchen (story 9.3, T0): 36 at rest, 3 for the silence ring, 3 for 3.16's face.
    const peakWithoutBubbles = 36 + 3 + 3;
    expect(
      peakWithoutBubbles + OFFSCREEN_BUBBLE_MAX_COUNT * OFFSCREEN_BUBBLE_MAX_NODES,
    ).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
  });
});

describe('the bubble’s stylesheet takes no pixel size of its own (story 9.3)', () => {
  const css = readFileSync(UI_CSS, 'utf8');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: (selector as string).trim(), body: body as string }),
  );
  const own = rules.filter((rule) => /\.pp-offscreen-/.test(rule.selector));

  it('sizes and places it from custom properties the constants write', () => {
    expect(own.length).toBeGreaterThan(0);
    for (const { selector, body } of own) {
      // The 0.5px is a mask's anti-aliasing edge; 0px is the placeholder of an inline or root value.
      const literals = body.replace(/\b0(\.5)?px\b/g, '').match(/\b\d+(\.\d+)?px\b/g);
      expect(literals, selector).toBeNull();
    }
    expect(css).not.toMatch(/--pp-offscreen-[a-z-]+:\s*[1-9]\d*px/);
  });

  it('never animates (it pops in and out), so it has no reduced-motion rule', () => {
    for (const { selector, body } of own) {
      expect(body, selector).not.toMatch(/\banimation\b|\btransition\b/);
      expect(selector).not.toContain('data-pp-motion');
    }
  });

  it('draws the chevron in ink, never in a threat colour', () => {
    const chevron = own.filter((rule) => rule.selector === '.pp-offscreen-bubble::after');
    expect(chevron).toHaveLength(1);
    for (const { selector, body } of chevron) {
      expect(body, selector).toContain('--pp-color-ink');
      expect(body, selector).not.toMatch(/--pp-color-(parry|dodge|alert)/);
    }
  });
});
