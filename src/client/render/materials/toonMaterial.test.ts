import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { colorKey, createToonMaterialCache, TOON_TONES } from './toonMaterial.ts';

describe('createToonMaterialCache', () => {
  it('shares one material per distinct colour', () => {
    const cache = createToonMaterialCache();
    const a = cache.get(new Color(0xff0000));
    const b = cache.get(new Color(0xff0000));
    const c = cache.get(new Color(0x00ff00));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(cache.size).toBe(2);
  });

  it('gives every material the same 3-tone ramp, unfiltered', () => {
    const cache = createToonMaterialCache();
    const ramp = cache.get(new Color(0x123456)).gradientMap;
    const image = ramp?.image as { width: number; height: number };
    expect(image.width).toBe(3);
    expect(image.height).toBe(1);
    expect(TOON_TONES).toHaveLength(3);
    expect([...TOON_TONES]).toEqual([...TOON_TONES].sort((x, y) => x - y));
    expect(cache.get(new Color(0xabcdef)).gradientMap).toBe(ramp);
  });

  it('copies the colour it is given', () => {
    const cache = createToonMaterialCache();
    const colour = new Color(0x2a2140);
    const material = cache.get(colour);
    colour.set(0xffffff);
    expect(material.color.getHex()).toBe(0x2a2140);
  });

  it('forgets everything on dispose', () => {
    const cache = createToonMaterialCache();
    cache.get(new Color(1));
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe('colorKey', () => {
  it('is the same for equal colours and differs otherwise', () => {
    expect(colorKey(new Color(0x6d3fe0))).toBe(colorKey(new Color('#6d3fe0')));
    expect(colorKey(new Color(0x6d3fe0))).not.toBe(colorKey(new Color(0x6d3fe1)));
  });
});
