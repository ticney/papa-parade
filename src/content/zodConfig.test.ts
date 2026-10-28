import { describe, expect, it, vi } from 'vitest';
import { config, z } from 'zod';
import './zodConfig.ts';

describe('zodConfig', () => {
  it('turns Zod jitless on, so a strict CSP sees no eval probe', () => {
    expect(config().jitless).toBe(true);
  });

  it('parses an object schema without ever building a Function (that is what CSP reports as eval)', () => {
    const constructed = vi.fn();
    const RealFunction = Function;
    vi.stubGlobal(
      'Function',
      new Proxy(RealFunction, {
        construct(target, args) {
          constructed(args);
          return Reflect.construct(target, args);
        },
        apply(target, thisArg, args) {
          constructed(args);
          return Reflect.apply(target, thisArg, args);
        },
      }),
    );
    try {
      const schema = z.object({ id: z.string(), count: z.number() });
      expect(schema.parse({ id: 'a', count: 1 })).toEqual({ id: 'a', count: 1 });
      expect(schema.safeParse({ id: 'a' }).success).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(constructed).not.toHaveBeenCalled();
  });
});
