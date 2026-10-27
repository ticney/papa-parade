import { describe, expect, it } from 'vitest';
import { asRealMs, asSimMs, type RealMs, type SimMs } from './time.ts';

describe('SimMs / RealMs', () => {
  it('casts are identities at runtime', () => {
    expect(asSimMs(120)).toBe(120);
    expect(asRealMs(16.6)).toBe(16.6);
  });

  it('cannot be mixed at the type level', () => {
    const real: RealMs = asRealMs(5);
    // @ts-expect-error a RealMs is not a SimMs
    const sim: SimMs = real;
    expect(sim).toBe(5);
  });
});
