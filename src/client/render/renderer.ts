import { MAX_PIXEL_RATIO } from '@shared/constants';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import type { Camera, Scene } from 'three';
import { Vector4, WebGLRenderer } from 'three';
import { bufferRectOf, photoRectOf } from './captureRect.ts';

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
   * ratio and the current size, then draws the last frame again (resizing clears the canvas, which
   * would otherwise be presented blank). Does nothing when the ratio would not change.
   */
  setPixelRatioCap(cap: number): void;
  render(scene: Scene, camera: Camera): void;
  /**
   * Draws `scene` through `camera` into a centred rectangle of the drawing buffer of aspect `aspect`
   * (width / height), copies it to `target` with `drawImage` in the same task (the buffer is only valid
   * until the task ends: `preserveDrawingBuffer` stays off, story 3.6 D4), and puts the viewport and
   * the scissor back. `target` is filled whole. It does not remember the scene or the camera, so a
   * later pixel-ratio step redraws the game's last frame and not the photo's. A canvas with no size, or
   * a copy the browser refuses, returns an `err` of kind `render`; the game's next frame draws as usual.
   */
  capture(
    scene: Scene,
    camera: Camera,
    aspect: number,
    target: CanvasRenderingContext2D,
  ): Result<void, AppError>;
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
  // The last frame's scene and camera, to draw it again right after the backing store is resized.
  let lastScene: Scene | null = null;
  let lastCamera: Camera | null = null;
  // `capture` puts the viewport and the scissor back from these (reused, so it allocates nothing but once).
  const previousViewport = new Vector4();
  const previousScissor = new Vector4();

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
      if (width > 0 && height > 0) {
        renderer.setSize(width, height, false);
        if (lastScene !== null && lastCamera !== null) renderer.render(lastScene, lastCamera);
      }
    },
    render(scene, camera) {
      lastScene = scene;
      lastCamera = camera;
      renderer.render(scene, camera);
    },
    capture(scene, camera, aspect, target) {
      const canvasWidthPx = canvas.clientWidth;
      const canvasHeightPx = canvas.clientHeight;
      if (canvasWidthPx === 0 || canvasHeightPx === 0) {
        return err({ kind: 'render', message: 'cannot capture: the canvas has no size' });
      }
      if (!Number.isFinite(aspect) || aspect <= 0) {
        return err({ kind: 'render', message: `cannot capture: the aspect is ${aspect}` });
      }
      const rect = photoRectOf(canvasWidthPx, canvasHeightPx, aspect);
      renderer.getViewport(previousViewport);
      renderer.getScissor(previousScissor);
      const wasScissorTest = renderer.getScissorTest();
      try {
        renderer.setViewport(rect.xPx, rect.yPx, rect.widthPx, rect.heightPx);
        renderer.setScissor(rect.xPx, rect.yPx, rect.widthPx, rect.heightPx);
        renderer.setScissorTest(true);
        // Not `this.render`: the photo's scene and camera must not become the ones a cap change redraws.
        renderer.render(scene, camera);
        const source = bufferRectOf(rect, renderer.getPixelRatio(), canvas.height);
        target.drawImage(
          canvas,
          source.xPx,
          source.yPx,
          source.widthPx,
          source.heightPx,
          0,
          0,
          target.canvas.width,
          target.canvas.height,
        );
        return ok(undefined);
      } catch (cause) {
        return err({ kind: 'render', message: 'cannot capture the end photo', cause });
      } finally {
        // The scissor test too, or every later frame is drawn inside the photo's rectangle.
        renderer.setViewport(previousViewport);
        renderer.setScissor(previousScissor);
        renderer.setScissorTest(wasScissorTest);
      }
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
      lastScene = null;
      lastCamera = null;
      renderer.dispose();
    },
  });
}
