import { MAX_PIXEL_RATIO } from '@shared/constants';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import type { Camera, Scene } from 'three';
import { WebGLRenderer } from 'three';

/**
 * `min(devicePixelRatio, cap)`. A value that is not a positive finite number (some embedded
 * browsers report 0 or NaN) gives 1: this never throws.
 */
export function pixelRatioFor(devicePixelRatio: number, cap: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, cap);
}

/**
 * What the renderer drew in its last `render` call (budget: ≤ 100 draw calls, ≤ 100k triangles),
 * and what it holds on the GPU right now: a scene that was not disposed keeps its geometries and
 * textures here, which the draw calls (only the scene drawn last) cannot show.
 */
export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** The pixel ratio in force (`min(devicePixelRatio, cap)`): the adaptive cap may have lowered it. */
  pixelRatio: number;
}

export interface GameRenderer {
  /**
   * Re-reads the canvas CSS size and the device pixel ratio (CSS owns the canvas size). Returns
   * the new aspect ratio (width / height), or `null` while the canvas has no size (hidden).
   */
  resize(): number | null;
  /**
   * Lowers (or raises) the ceiling of the pixel ratio, and redraws the backing store at the new
   * ratio and the current size. Does nothing when the ratio would not change.
   */
  setPixelRatioCap(cap: number): void;
  render(scene: Scene, camera: Camera): void;
  /** The last frame's draw calls and triangles, and the GPU memory held: one object, rewritten by each call (no allocation). */
  stats(): Readonly<RenderStats>;
  dispose(): void;
}

/**
 * Creates the WebGL renderer on `canvas`. A browser that cannot give a WebGL context returns an
 * `err` of kind `render` instead of throwing: the caller decides what the player sees.
 */
export function createRenderer(canvas: HTMLCanvasElement): Result<GameRenderer, AppError> {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (cause) {
    return err({
      kind: 'render',
      message: 'cannot create a WebGL context',
      cause,
    });
  }

  const onContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    log.warn('render', 'webgl context lost');
  };
  const onContextRestored = (): void => {
    // three rebuilds its resources; the next frame redraws everything.
    log.warn('render', 'webgl context restored');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const stats: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    pixelRatio: 1,
  };
  // The adaptive cap (story 1.24); the resize path reads it too, so a resize never undoes a step.
  let pixelRatioCap: number = MAX_PIXEL_RATIO;

  return ok({
    resize() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return null;
      renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, pixelRatioCap));
      renderer.setSize(width, height, false);
      return width / height;
    },
    setPixelRatioCap(cap) {
      pixelRatioCap = cap;
      const ratio = pixelRatioFor(window.devicePixelRatio, cap);
      if (ratio === renderer.getPixelRatio()) return;
      renderer.setPixelRatio(ratio);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width > 0 && height > 0) renderer.setSize(width, height, false);
    },
    render(scene, camera) {
      renderer.render(scene, camera);
    },
    stats() {
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
      stats.geometries = renderer.info.memory.geometries;
      stats.textures = renderer.info.memory.textures;
      stats.pixelRatio = renderer.getPixelRatio();
      return stats;
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer.dispose();
    },
  });
}
