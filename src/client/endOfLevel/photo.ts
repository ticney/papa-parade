import type { PhotoSettings } from '@content/schemas/feedback';
import type { Feel } from '@content/schemas/feel';
import { type AppError, err, ok, type Result } from '@shared/result';
import type { RealMs } from '@shared/time';
import type { World } from '@sim';
import type { OrthographicCamera } from 'three';
import { fitIsoCamera } from '../render/isoCamera.ts';
import type { LevelScene } from '../render/levelScene.ts';
import { PALETTE } from '../render/materials/palette.ts';
import type { GameRenderer } from '../render/renderer.ts';

/** One colour stop of the photo's vignette: `offset` is a share of the radius, 0 to 1. */
export interface VignetteStop {
  readonly offset: number;
  readonly color: string;
}

/** `rgba(r, g, b, a)` of a `0xRRGGBB` colour at `alphaPct` percent. */
export function rgbaOf(hex: number, alphaPct: number): string {
  const red = (hex >> 16) & 0xff;
  const green = (hex >> 8) & 0xff;
  const blue = hex & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${alphaPct / 100})`;
}

/**
 * The vignette of the mockup (`key-result.html`, `#vig`): clear out to `vignetteFromPct` of the
 * radius, then `PALETTE.ink` at `vignetteOpacityPct` at the edge. Both stops are the same ink, so
 * the blend never goes through another colour. Pure: the numbers come from `feedback.json › photo`.
 */
export function vignetteStopsOf(photo: PhotoSettings): readonly [VignetteStop, VignetteStop] {
  return [
    { offset: photo.vignetteFromPct / 100, color: rgbaOf(PALETTE.ink, 0) },
    { offset: 1, color: rgbaOf(PALETTE.ink, photo.vignetteOpacityPct) },
  ];
}

/**
 * Draws the vignette over what is already on `context`. The gradient is drawn on a unit square scaled
 * to the photo, as the mockup's `objectBoundingBox` gradient is, so it is an ellipse that follows the
 * photo's aspect and reaches the same share of the way to each edge.
 */
export function drawVignette(
  context: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  photo: PhotoSettings,
): void {
  const [clear, edge] = vignetteStopsOf(photo);
  context.save();
  context.scale(widthPx, heightPx);
  const gradient = context.createRadialGradient(
    0.5,
    0.5,
    0,
    0.5,
    0.5,
    photo.vignetteRadiusPct / 100,
  );
  gradient.addColorStop(clear.offset, clear.color);
  gradient.addColorStop(edge.offset, edge.color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, 1);
  context.restore();
}

/**
 * Places the photo's own camera: the room fitted at the photo's aspect, from the angle the feel
 * gives (`feel.fx.photoCamera`), then zoomed in. Zoom is the camera's, not the fit's, so the
 * frustum stays the fitted one. Read at capture, so a `SetFeel` applies to the next photo.
 */
export function placePhotoCamera(
  camera: OrthographicCamera,
  level: Pick<LevelScene, 'room'>,
  aspect: number,
  photoCamera: Feel['fx']['photoCamera'],
): void {
  fitIsoCamera(camera, level.room, aspect, {
    yawDeg: photoCamera.yawDeg,
    pitchDeg: photoCamera.pitchDeg,
  });
  camera.zoom = 1 + photoCamera.zoomPct / 100;
  camera.updateProjectionMatrix();
}

/** What `takeEndPhoto` needs to take the picture. */
export interface EndPhotoDeps {
  readonly renderer: Pick<GameRenderer, 'capture'>;
  /** The level's scene (the frozen room stays in it behind the Result screen). */
  readonly level: Pick<LevelScene, 'scene' | 'room' | 'update'>;
  /** The photo's own camera, never the game's. */
  readonly camera: OrthographicCamera;
  /** Makes the 2D canvas of the picture (the page's `document.createElement('canvas')`). */
  createCanvas(): HTMLCanvasElement;
}

export interface EndPhotoOptions {
  readonly photo: PhotoSettings;
  readonly photoCamera: Feel['fx']['photoCamera'];
}

/**
 * The end photo (story 3.6, FR35): the frozen room seen from the photo camera, copied into a 2D
 * `<canvas>` of `photo.widthPx` by `photo.heightPx` with the vignette over it. It is a canvas and
 * never an image URL: the CSP (`default-src 'self'`, no `img-src`) would refuse a `data:` or `blob:`
 * image in the deployed build only.
 *
 * `world` is the snapshot's copy of the frozen world: it is drawn with `level.update(world, 1, nowReal)`
 * (no step runs, alpha 1 is the current pose), so the picture is the snapshot's and not a live read
 * of the sim. Once per level, outside play, so it may allocate. A failure (no 2D context, a canvas
 * with no size, a copy the browser refuses) is an `err` for the caller to log: the Result screen then
 * runs without a photo.
 */
export function takeEndPhoto(
  deps: EndPhotoDeps,
  world: Readonly<World>,
  options: EndPhotoOptions,
  nowReal: RealMs,
): Result<HTMLCanvasElement, AppError> {
  const { widthPx, heightPx } = options.photo;
  const canvas = deps.createCanvas();
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext('2d');
  if (context === null) {
    return err({ kind: 'render', message: 'cannot take the end photo: no 2D canvas context' });
  }
  const aspect = widthPx / heightPx;
  deps.level.update(world, 1, nowReal);
  placePhotoCamera(deps.camera, deps.level, aspect, options.photoCamera);
  const captured = deps.renderer.capture(deps.level.scene, deps.camera, aspect, context);
  if (!captured.ok) return err(captured.error);
  drawVignette(context, widthPx, heightPx, options.photo);
  return ok(canvas);
}
