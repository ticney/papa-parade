import { COMPACT_SURFACE_MAX_PX } from '@shared/constants';
import type { LogChannel } from '@shared/log';
import { describe, expect, it } from 'vitest';
import { bindSurface, surfaceFor } from './surface.ts';

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

describe('bindSurface', () => {
  function setup(width: number, height: number) {
    const source = {
      innerWidth: width,
      innerHeight: height,
      listeners: new Set<() => void>(),
      addEventListener(_type: 'resize', listener: () => void) {
        this.listeners.add(listener);
      },
      removeEventListener(_type: 'resize', listener: () => void) {
        this.listeners.delete(listener);
      },
    };
    const root = { dataset: {} as Record<string, string | undefined> };
    return { source, root };
  }

  it('writes the surface at bind time and on every resize', () => {
    const { source, root } = setup(844, 390);
    bindSurface(source, root);
    expect(root.dataset.ppSurface).toBe('compact');
    source.innerWidth = 1024;
    source.innerHeight = 768;
    for (const listener of source.listeners) listener();
    expect(root.dataset.ppSurface).toBe('regular');
  });

  it('stops listening once unbound', () => {
    const { source, root } = setup(844, 390);
    const unbind = bindSurface(source, root);
    unbind();
    expect(source.listeners.size).toBe(0);
  });
});
