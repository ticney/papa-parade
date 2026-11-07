import { describe, expect, it } from 'vitest';
import { COMPACT_SURFACE_MAX_PX } from './constants.ts';
import type { LogChannel } from './log.ts';
import { surfaceFor } from './surface.ts';

function silent() {
  const warnings: string[] = [];
  return {
    warnings,
    logger: {
      warn: (_channel: LogChannel, message: string) => {
        warnings.push(message);
      },
    },
  };
}

describe('surfaceFor', () => {
  it('is compact just under the limit and regular at it, on the short side', () => {
    expect(surfaceFor(844, COMPACT_SURFACE_MAX_PX - 1)).toBe('compact');
    expect(surfaceFor(844, COMPACT_SURFACE_MAX_PX)).toBe('regular');
  });

  it('does not depend on the orientation', () => {
    expect(surfaceFor(390, 844)).toBe('compact');
    expect(surfaceFor(844, 390)).toBe('compact');
    expect(surfaceFor(1024, 768)).toBe('regular');
    expect(surfaceFor(768, 1024)).toBe('regular');
  });

  it.each([
    [Number.NaN, 400],
    [800, Number.POSITIVE_INFINITY],
    [0, 400],
    [800, -1],
  ])('answers regular and warns for %s x %s', (width, height) => {
    const { warnings, logger } = silent();
    expect(surfaceFor(width, height, logger)).toBe('regular');
    expect(warnings).toHaveLength(1);
  });
});
