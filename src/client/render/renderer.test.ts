import { MAX_PIXEL_RATIO, PIXEL_RATIO_STEPS } from '@shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A WebGLRenderer double: the node environment has no WebGL, and only the pixel-ratio calls matter.
const gl = vi.hoisted(() => ({
  ratio: 1,
  setPixelRatio: vi.fn(),
  setSize: vi.fn(),
}));
vi.mock('three', () => ({
  WebGLRenderer: class {
    info = { render: { calls: 7, triangles: 70 }, memory: { geometries: 2, textures: 1 } };
    getPixelRatio = () => gl.ratio;
    setPixelRatio = (ratio: number) => {
      gl.ratio = ratio;
      gl.setPixelRatio(ratio);
    };
    setSize = gl.setSize;
    render = vi.fn();
    dispose = vi.fn();
  },
}));

const { createRenderer, pixelRatioFor } = await import('./renderer.ts');

describe('pixelRatioFor', () => {
  it.each([
    ['a ratio of 1', 1, 1],
    ['a ratio below the cap', 1.5, 1.5],
    ['a ratio at the cap', MAX_PIXEL_RATIO, MAX_PIXEL_RATIO],
    ['a ratio above the cap', MAX_PIXEL_RATIO + 1, MAX_PIXEL_RATIO],
    ['a ratio far above the cap', 10, MAX_PIXEL_RATIO],
  ])('caps %s', (_name, devicePixelRatio, expected) => {
    expect(pixelRatioFor(devicePixelRatio, MAX_PIXEL_RATIO)).toBe(expected);
  });

  it('takes the cap it is given', () => {
    expect(pixelRatioFor(3, 1.5)).toBe(1.5);
    expect(pixelRatioFor(3, 1)).toBe(1);
    expect(pixelRatioFor(1.25, 1.5)).toBe(1.25);
  });

  it.each([
    ['zero', 0],
    ['a negative number', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('falls back to 1 for %s, without throwing', (_name, devicePixelRatio) => {
    expect(pixelRatioFor(devicePixelRatio, MAX_PIXEL_RATIO)).toBe(1);
  });
});

describe('the renderer pixel-ratio cap', () => {
  const canvas = {
    clientWidth: 844,
    clientHeight: 390,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;

  function make() {
    const created = createRenderer(canvas);
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  }

  beforeEach(() => {
    gl.ratio = 1;
    gl.setPixelRatio.mockClear();
    gl.setSize.mockClear();
    vi.stubGlobal('window', { devicePixelRatio: 3 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts at the first cap, and a resize applies it', () => {
    const renderer = make();
    expect(renderer.resize()).toBeCloseTo(844 / 390);
    expect(gl.setPixelRatio).toHaveBeenLastCalledWith(PIXEL_RATIO_STEPS[0]);
    expect(gl.setSize).toHaveBeenLastCalledWith(844, 390, false);
    expect(renderer.stats().pixelRatio).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('setPixelRatioCap re-applies the ratio and the current size', () => {
    const renderer = make();
    renderer.resize();
    gl.setPixelRatio.mockClear();
    gl.setSize.mockClear();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    expect(gl.setPixelRatio).toHaveBeenCalledExactlyOnceWith(PIXEL_RATIO_STEPS[1]);
    expect(gl.setSize).toHaveBeenCalledExactlyOnceWith(844, 390, false);
    expect(renderer.stats().pixelRatio).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('does nothing when the ratio would not change', () => {
    const renderer = make();
    renderer.resize();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    gl.setPixelRatio.mockClear();
    gl.setSize.mockClear();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    // A device at ratio 1 sees no difference between any two caps.
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    renderer.resize();
    gl.setPixelRatio.mockClear();
    gl.setSize.mockClear();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[2]);
    expect(gl.setPixelRatio).not.toHaveBeenCalled();
    expect(gl.setSize).not.toHaveBeenCalled();
  });

  it('a resize after a step keeps the lowered cap', () => {
    const renderer = make();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[2]);
    gl.setPixelRatio.mockClear();
    renderer.resize();
    expect(gl.setPixelRatio).toHaveBeenLastCalledWith(PIXEL_RATIO_STEPS[2]);
  });

  it('skips the resize of the backing store while the canvas has no size', () => {
    const hidden = { ...canvas, clientWidth: 0, clientHeight: 0 } as unknown as HTMLCanvasElement;
    const created = createRenderer(hidden);
    if (!created.ok) throw new Error(created.error.message);
    created.value.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    expect(gl.setPixelRatio).toHaveBeenCalledWith(PIXEL_RATIO_STEPS[1]);
    expect(gl.setSize).not.toHaveBeenCalled();
  });
});
