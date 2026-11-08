import { describe, expect, it } from 'vitest';
import { bindSurface } from './surface.ts';

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
