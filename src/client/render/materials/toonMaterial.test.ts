import { Color, type DataTexture, type MeshToonMaterial, ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from './palette.ts';
import { colorKey, createToonMaterialCache, fourthToneOf, writeToonBands } from './toonMaterial.ts';

const TOON_TONES = [96, 178, 255];

describe('createToonMaterialCache', () => {
  it('shares one material per distinct colour', () => {
    const cache = createToonMaterialCache(TOON_TONES);
    const a = cache.get(new Color(0xff0000));
    const b = cache.get(new Color(0xff0000));
    const c = cache.get(new Color(0x00ff00));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(cache.size).toBe(2);
  });

  it('gives every material the same ramp, unfiltered', () => {
    const cache = createToonMaterialCache(TOON_TONES);
    const ramp = cache.get(new Color(0x123456)).gradientMap;
    const image = ramp?.image as { width: number; height: number };
    expect(image.width).toBe(3);
    expect(image.height).toBe(1);
    expect(cache.get(new Color(0xabcdef)).gradientMap).toBe(ramp);
  });

  it('builds its ramp from the tones it is given, in that order', () => {
    const ramp = createToonMaterialCache([40, 120, 200, 250]).get(new Color(0x123456)).gradientMap;
    const image = ramp?.image as { width: number; data: Uint8Array };
    expect(image.width).toBe(4);
    expect([...image.data]).toEqual([40, 120, 200, 250]);
  });

  it('copies the colour it is given', () => {
    const cache = createToonMaterialCache(TOON_TONES);
    const colour = new Color(0x2a2140);
    const material = cache.get(colour);
    colour.set(0xffffff);
    expect(material.color.getHex()).toBe(0x2a2140);
  });

  it('forgets everything on dispose', () => {
    const cache = createToonMaterialCache(TOON_TONES);
    cache.get(new Color(1));
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe('the characters toon cache (story 7.8, D10)', () => {
  const LOOK = { rimStrengthPct: 35, rimWidthPct: 30, isFourthToneOn: false, fourthTonePct: 24 };
  /** What three would hand `onBeforeCompile`: the toon program's sources and an empty uniform set. */
  const compile = (material: MeshToonMaterial) => {
    const shader = {
      vertexShader: ShaderLib.toon.vertexShader,
      fragmentShader: ShaderLib.toon.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    material.onBeforeCompile(shader as never, undefined as never);
    return shader;
  };

  it('draws the same 3 bands on a 12-texel ramp, and 4 with the 4th tone on, in place', () => {
    const cache = createToonMaterialCache(TOON_TONES, { isCharacters: true });
    const material = cache.get(new Color(0x6d3fe0));
    const ramp = material.gradientMap as DataTexture;
    const data = ramp.image.data as Uint8Array;
    expect(ramp.image.width).toBe(12);
    expect([...data]).toEqual([96, 96, 96, 96, 178, 178, 178, 178, 255, 255, 255, 255]);
    expect(cache.toneCount).toBe(3);
    const version = ramp.version;
    cache.setLook({ ...LOOK, isFourthToneOn: true });
    expect(cache.toneCount).toBe(4);
    // 24 % of white is 61: darker than the darkest of the three.
    expect([...data]).toEqual([61, 61, 61, 96, 96, 96, 178, 178, 178, 255, 255, 255]);
    expect(ramp.version).toBeGreaterThan(version);
    expect(material.gradientMap).toBe(ramp);
    cache.setLook({ ...LOOK, isFourthToneOn: true, fourthTonePct: 10 });
    expect(data[0]).toBe(26);
    cache.setLook(LOOK);
    expect([...data]).toEqual([96, 96, 96, 96, 178, 178, 178, 178, 255, 255, 255, 255]);
    // No new material for any of it.
    expect(cache.size).toBe(1);
  });

  it('rewrites nothing when the look did not change', () => {
    const cache = createToonMaterialCache(TOON_TONES, { isCharacters: true });
    const ramp = cache.get(new Color(1)).gradientMap as DataTexture;
    cache.setLook({ ...LOOK, isFourthToneOn: true });
    const version = ramp.version;
    cache.setLook({ ...LOOK, isFourthToneOn: true });
    cache.setLook({ ...LOOK, isFourthToneOn: true, rimStrengthPct: 50 });
    expect(ramp.version).toBe(version);
  });

  it('adds a rim in paper to every material through one program and one set of uniforms', () => {
    const cache = createToonMaterialCache(TOON_TONES, { isCharacters: true });
    cache.setLook(LOOK);
    const a = cache.get(new Color(0xff0000));
    const b = cache.get(new Color(0x00ff00));
    const shaderA = compile(a);
    const shaderB = compile(b);
    expect(shaderA.fragmentShader).toContain('uniform float rimStrength;');
    expect(shaderA.fragmentShader).toContain('1.0 - normalize( normal ).z');
    // The rim goes in before the output, once.
    expect(shaderA.fragmentShader.indexOf('rimStrength * smoothstep')).toBeLessThan(
      shaderA.fragmentShader.indexOf('#include <opaque_fragment>'),
    );
    expect(shaderA.fragmentShader.split('#include <opaque_fragment>')).toHaveLength(2);
    expect(shaderA.uniforms.rimStrength).toBe(shaderB.uniforms.rimStrength);
    expect(shaderA.uniforms.rimStrength?.value).toBeCloseTo(0.35, 12);
    expect(shaderA.uniforms.rimWidth?.value).toBeCloseTo(0.3, 12);
    expect((shaderA.uniforms.rimColor as { value: Color }).value.getHex()).toBe(PALETTE.paper);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    // A feel change reaches the program's uniforms at once, with no new material.
    cache.setLook({ ...LOOK, rimStrengthPct: 80, rimWidthPct: 10 });
    expect(shaderA.uniforms.rimStrength?.value).toBeCloseTo(0.8, 12);
    expect(shaderB.uniforms.rimWidth?.value).toBeCloseTo(0.1, 12);
    expect(cache.size).toBe(2);
  });

  it('leaves the room cache as it was: 3 texels, no rim, no look', () => {
    const room = createToonMaterialCache(TOON_TONES);
    const material = room.get(new Color(0x123456));
    expect((material.gradientMap as DataTexture).image.width).toBe(3);
    room.setLook({ ...LOOK, isFourthToneOn: true });
    expect(room.toneCount).toBe(3);
    expect([...((material.gradientMap as DataTexture).image.data as Uint8Array)]).toEqual(
      TOON_TONES,
    );
    expect(compile(material).fragmentShader).not.toContain('rimStrength');
  });

  it('gives the 4th tone as a share of white, and bands any ramp evenly', () => {
    expect(fourthToneOf(0)).toBe(0);
    expect(fourthToneOf(100)).toBe(255);
    expect(fourthToneOf(24)).toBe(61);
    const data = new Uint8Array(6);
    writeToonBands(data, [1, 2]);
    expect([...data]).toEqual([1, 1, 1, 2, 2, 2]);
  });
});

describe('colorKey', () => {
  it('is the same for equal colours and differs otherwise', () => {
    expect(colorKey(new Color(0x6d3fe0))).toBe(colorKey(new Color('#6d3fe0')));
    expect(colorKey(new Color(0x6d3fe0))).not.toBe(colorKey(new Color(0x6d3fe1)));
  });
});
