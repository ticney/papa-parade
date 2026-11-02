import { MAX_PIXEL_RATIO, PIXEL_RATIO_STEPS } from '@shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A WebGLRenderer double: the node environment has no WebGL. The pixel-ratio calls, and the viewport
// and scissor `capture` moves and puts back (story 3.6), are what matter.
const gl = vi.hoisted(() => ({
  ratio: 1,
  setPixelRatio: vi.fn(),
  setSize: vi.fn(),
  render: vi.fn(),
  viewport: [0, 0, 844, 390],
  scissor: [0, 0, 844, 390],
  isScissorTest: false,
  /** Every state the viewport, the scissor and the test were in when `render` ran. */
  atRender: [] as { viewport: number[]; scissor: number[]; isScissorTest: boolean }[],
}));
vi.mock('three', () => ({
  Vector4: class {
    x = 0;
    y = 0;
    z = 0;
    w = 0;
    set(x: number, y: number, z: number, w: number) {
      [this.x, this.y, this.z, this.w] = [x, y, z, w];
      return this;
    }
    copy(other: { x: number; y: number; z: number; w: number }) {
      return this.set(other.x, other.y, other.z, other.w);
    }
  },
  WebGLRenderer: class {
    info = { render: { calls: 7, triangles: 70 }, memory: { geometries: 2, textures: 1 } };
    getPixelRatio = () => gl.ratio;
    setPixelRatio = (ratio: number) => {
      gl.ratio = ratio;
      gl.setPixelRatio(ratio);
    };
    setSize = gl.setSize;
    render = (scene: unknown, camera: unknown) => {
      gl.atRender.push({
        viewport: [...gl.viewport],
        scissor: [...gl.scissor],
        isScissorTest: gl.isScissorTest,
      });
      gl.render(scene, camera);
    };
    getViewport = (target: { set(...v: number[]): unknown }) => target.set(...gl.viewport);
    setViewport = (
      x: number | { x: number; y: number; z: number; w: number },
      ...rest: number[]
    ) => {
      gl.viewport = typeof x === 'number' ? [x, ...rest] : [x.x, x.y, x.z, x.w];
    };
    getScissor = (target: { set(...v: number[]): unknown }) => target.set(...gl.scissor);
    setScissor = (
      x: number | { x: number; y: number; z: number; w: number },
      ...rest: number[]
    ) => {
      gl.scissor = typeof x === 'number' ? [x, ...rest] : [x.x, x.y, x.z, x.w];
    };
    getScissorTest = () => gl.isScissorTest;
    setScissorTest = (isOn: boolean) => {
      gl.isScissorTest = isOn;
    };
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
    gl.render.mockClear();
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

  it('draws the last frame again after resizing the backing store (a resize clears the canvas)', () => {
    const renderer = make();
    const scene = {} as never;
    const camera = {} as never;
    renderer.resize();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    // No frame drawn yet: nothing to draw again.
    expect(gl.render).not.toHaveBeenCalled();
    renderer.render(scene, camera);
    gl.render.mockClear();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[2]);
    expect(gl.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
  });

  it('does nothing when the ratio would not change', () => {
    const renderer = make();
    renderer.resize();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    gl.setPixelRatio.mockClear();
    gl.setSize.mockClear();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[1]);
    // The same cap twice: the second call changes nothing.
    expect(gl.setPixelRatio).not.toHaveBeenCalled();
    expect(gl.setSize).not.toHaveBeenCalled();
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

describe('the renderer capture (story 3.6)', () => {
  /** A 400 x 300 CSS canvas at a ratio of 2: a 800 x 600 drawing buffer. */
  const canvas = {
    clientWidth: 400,
    clientHeight: 300,
    width: 800,
    height: 600,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;

  /** A 2D context double: the photo canvas is 200 x 100 and `drawImage` is recorded. */
  function makeTarget(drawImage: (...args: unknown[]) => void = () => {}) {
    const calls: unknown[][] = [];
    const target = {
      canvas: { width: 200, height: 100 },
      drawImage: (...args: unknown[]) => {
        calls.push(args);
        drawImage(...args);
      },
    } as unknown as CanvasRenderingContext2D;
    return { target, calls };
  }

  function make(source: HTMLCanvasElement = canvas) {
    const created = createRenderer(source);
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  }

  beforeEach(() => {
    gl.ratio = 2;
    gl.viewport = [0, 0, 400, 300];
    gl.scissor = [0, 0, 400, 300];
    gl.isScissorTest = false;
    gl.atRender = [];
    gl.render.mockClear();
    vi.stubGlobal('window', { devicePixelRatio: 2 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders into a centred rectangle of the aspect asked for, with the scissor on', () => {
    const renderer = make();
    const scene = {} as never;
    const camera = {} as never;
    const { target } = makeTarget();
    expect(renderer.capture(scene, camera, 2, target)).toEqual({ ok: true, value: undefined });
    expect(gl.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
    // 2:1 in 400 x 300 CSS pixels: 400 x 200, 50 above and 50 below (three multiplies by the ratio).
    expect(gl.atRender).toEqual([
      { viewport: [0, 50, 400, 200], scissor: [0, 50, 400, 200], isScissorTest: true },
    ]);
  });

  it('copies the rectangle with drawImage, in buffer pixels from the top, into the whole target', () => {
    const renderer = make();
    const { target, calls } = makeTarget();
    renderer.capture({} as never, {} as never, 2, target);
    // The buffer is 800 x 600 at a ratio of 2: the photo is 800 x 400, 100 down from the top.
    expect(calls).toEqual([[canvas, 0, 100, 800, 400, 0, 0, 200, 100]]);
  });

  it('copies in the same task: drawImage runs inside the call, after the render', () => {
    const renderer = make();
    const order: string[] = [];
    gl.render.mockImplementationOnce(() => order.push('render'));
    const { target } = makeTarget(() => order.push('drawImage'));
    renderer.capture({} as never, {} as never, 2, target);
    expect(order).toEqual(['render', 'drawImage']);
  });

  it('puts the viewport, the scissor and the scissor test back', () => {
    const renderer = make();
    gl.viewport = [0, 0, 400, 300];
    gl.scissor = [3, 4, 5, 6];
    gl.isScissorTest = false;
    renderer.capture({} as never, {} as never, 2, makeTarget().target);
    expect(gl.viewport).toEqual([0, 0, 400, 300]);
    expect(gl.scissor).toEqual([3, 4, 5, 6]);
    expect(gl.isScissorTest).toBe(false);
  });

  it('keeps a scissor test that was on', () => {
    const renderer = make();
    gl.isScissorTest = true;
    renderer.capture({} as never, {} as never, 2, makeTarget().target);
    expect(gl.isScissorTest).toBe(true);
  });

  it('puts everything back when the copy fails, and says so as an err', () => {
    const renderer = make();
    const cause = new Error('tainted');
    const { target } = makeTarget(() => {
      throw cause;
    });
    const result = renderer.capture({} as never, {} as never, 2, target);
    expect(result).toMatchObject({ ok: false, error: { kind: 'render', cause } });
    expect(gl.viewport).toEqual([0, 0, 400, 300]);
    expect(gl.scissor).toEqual([0, 0, 400, 300]);
    expect(gl.isScissorTest).toBe(false);
  });

  it('draws nothing on a canvas with no size', () => {
    const renderer = make({ ...canvas, clientWidth: 0, clientHeight: 0 } as HTMLCanvasElement);
    const { target, calls } = makeTarget();
    const result = renderer.capture({} as never, {} as never, 2, target);
    expect(result).toMatchObject({ ok: false, error: { kind: 'render' } });
    expect(gl.render).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'draws nothing for an aspect of %s',
    (aspect) => {
      const renderer = make();
      const { target, calls } = makeTarget();
      expect(renderer.capture({} as never, {} as never, aspect, target)).toMatchObject({
        ok: false,
        error: { kind: 'render' },
      });
      expect(gl.render).not.toHaveBeenCalled();
      expect(calls).toEqual([]);
    },
  );

  it('does not become the frame a pixel-ratio step redraws', () => {
    const renderer = make();
    renderer.resize();
    const gameScene = { id: 'game' } as never;
    const gameCamera = { id: 'game' } as never;
    renderer.render(gameScene, gameCamera);
    renderer.capture({ id: 'photo' } as never, { id: 'photo' } as never, 2, makeTarget().target);
    gl.render.mockClear();
    renderer.setPixelRatioCap(PIXEL_RATIO_STEPS[2]);
    expect(gl.render).toHaveBeenCalledExactlyOnceWith(gameScene, gameCamera);
  });
});
