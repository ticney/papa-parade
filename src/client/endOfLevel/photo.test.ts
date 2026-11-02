import { err, ok } from '@shared/result';
import { asRealMs } from '@shared/time';
import type { World } from '@sim';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestFeedback } from '../../../tests/support/testContent.ts';
import { createIsoCamera, fitIsoCamera } from '../render/isoCamera.ts';
import { PALETTE } from '../render/materials/palette.ts';
import {
  drawVignette,
  type EndPhotoDeps,
  placePhotoCamera,
  rgbaOf,
  takeEndPhoto,
  vignetteStopsOf,
} from './photo.ts';

const PHOTO = createTestFeedback().photo;
const PHOTO_CAMERA = createTestContent().feel.fx.photoCamera;
const ROOM = { widthM: 9.1, depthM: 6.2, heightM: 2.5, centerXM: 0.35, centerZM: -0.1 };
const ASPECT = PHOTO.widthPx / PHOTO.heightPx;

/** A 2D context double that records every call in order; `onFirstCall` runs when the first one lands. */
function makeContext(onFirstCall?: () => void) {
  const calls: unknown[][] = [];
  const stops: [number, string][] = [];
  let isFirstCall = true;
  const record = (...call: unknown[]): void => {
    if (isFirstCall) onFirstCall?.();
    isFirstCall = false;
    calls.push(call);
  };
  const gradient = {
    addColorStop: (offset: number, color: string) => {
      record('addColorStop', offset, color);
      stops.push([offset, color]);
    },
  };
  const context = {
    fillStyle: '' as unknown,
    save: () => record('save'),
    restore: () => record('restore'),
    scale: (x: number, y: number) => record('scale', x, y),
    createRadialGradient: (...args: number[]) => {
      record('createRadialGradient', ...args);
      return gradient;
    },
    fillRect: (...args: number[]) => record('fillRect', ...args),
  };
  return {
    context: context as unknown as CanvasRenderingContext2D,
    raw: context,
    calls,
    stops,
    gradient,
  };
}

describe('rgbaOf', () => {
  it('splits a 0xRRGGBB colour and writes the alpha as a fraction', () => {
    expect(rgbaOf(0x2a2140, 28)).toBe('rgba(42, 33, 64, 0.28)');
    expect(rgbaOf(0xffffff, 0)).toBe('rgba(255, 255, 255, 0)');
    expect(rgbaOf(0x6d3fe0, 100)).toBe('rgba(109, 63, 224, 1)');
  });
});

describe('vignetteStopsOf', () => {
  it('is clear out to vignetteFromPct of the radius, then ink at vignetteOpacityPct', () => {
    expect(vignetteStopsOf(PHOTO)).toEqual([
      { offset: PHOTO.vignetteFromPct / 100, color: rgbaOf(PALETTE.ink, 0) },
      { offset: 1, color: rgbaOf(PALETTE.ink, PHOTO.vignetteOpacityPct) },
    ]);
  });

  it('follows the numbers it is given, not literals', () => {
    const [clear, edge] = vignetteStopsOf({
      ...PHOTO,
      vignetteFromPct: 35,
      vignetteOpacityPct: 80,
    });
    expect(clear.offset).toBeCloseTo(0.35);
    expect(edge.color).toBe('rgba(42, 33, 64, 0.8)');
  });

  it("is the mockup's: ink #2A2140, clear to 60 %, 28 % at the edge, at the live values", () => {
    const [clear, edge] = vignetteStopsOf(PHOTO);
    expect(clear).toEqual({ offset: 0.6, color: 'rgba(42, 33, 64, 0)' });
    expect(edge).toEqual({ offset: 1, color: 'rgba(42, 33, 64, 0.28)' });
  });
});

describe('drawVignette', () => {
  it('fills a unit square scaled to the photo, with the mockup gradient, and puts the state back', () => {
    const { context, raw, calls, gradient } = makeContext();
    drawVignette(context, 570, 360, PHOTO);
    expect(calls).toEqual([
      ['save'],
      ['scale', 570, 360],
      ['createRadialGradient', 0.5, 0.5, 0, 0.5, 0.5, 0.7],
      ['addColorStop', 0.6, 'rgba(42, 33, 64, 0)'],
      ['addColorStop', 1, 'rgba(42, 33, 64, 0.28)'],
      ['fillRect', 0, 0, 1, 1],
      ['restore'],
    ]);
    // The gradient itself is what fills, not some other style.
    expect(raw.fillStyle).toBe(gradient);
  });

  it('takes its radius from vignetteRadiusPct, a share of the photo, not from a literal', () => {
    const { context, calls } = makeContext();
    drawVignette(context, 570, 360, { ...PHOTO, vignetteRadiusPct: 45 });
    const gradientCall = calls.find((call) => call[0] === 'createRadialGradient');
    expect(gradientCall?.slice(1, 4)).toEqual([0.5, 0.5, 0]);
    expect(gradientCall?.[6]).toBeCloseTo(0.45);
  });
});

describe('placePhotoCamera', () => {
  const degrees = (radians: number) => (radians * 180) / Math.PI;

  it("looks from the feel's yaw and pitch, not the game camera's", () => {
    const camera = createIsoCamera();
    placePhotoCamera(camera, { room: ROOM }, ASPECT, PHOTO_CAMERA);
    const centre = new Vector3(ROOM.centerXM, ROOM.heightM / 2, ROOM.centerZM);
    const fromCentre = camera.position.clone().sub(centre);
    expect(degrees(Math.atan2(fromCentre.x, fromCentre.z))).toBeCloseTo(PHOTO_CAMERA.yawDeg, 6);
    expect(degrees(Math.asin(fromCentre.y / fromCentre.length()))).toBeCloseTo(
      PHOTO_CAMERA.pitchDeg,
      6,
    );
  });

  it('frames the room at the aspect of the photo', () => {
    const camera = createIsoCamera();
    placePhotoCamera(camera, { room: ROOM }, ASPECT, PHOTO_CAMERA);
    expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(ASPECT, 9);
  });

  it('is the plain fit when the zoom is 0: the camera zoom is 1', () => {
    const camera = createIsoCamera();
    placePhotoCamera(camera, { room: ROOM }, ASPECT, { ...PHOTO_CAMERA, zoomPct: 0 });
    expect(camera.zoom).toBe(1);
  });

  it('zooms in by zoomPct on top of the fit, and a tune changes the picture', () => {
    const plain = createIsoCamera();
    placePhotoCamera(plain, { room: ROOM }, ASPECT, { ...PHOTO_CAMERA, zoomPct: 0 });
    const zoomed = createIsoCamera();
    placePhotoCamera(zoomed, { room: ROOM }, ASPECT, { ...PHOTO_CAMERA, zoomPct: 25 });
    expect(zoomed.zoom).toBeCloseTo(1.25);
    // The frustum is the fitted one; the zoom is in the projection.
    expect([zoomed.left, zoomed.right, zoomed.top, zoomed.bottom]).toEqual([
      plain.left,
      plain.right,
      plain.top,
      plain.bottom,
    ]);
    expect(zoomed.projectionMatrix.toArray()).not.toEqual(plain.projectionMatrix.toArray());
  });

  it('does not touch the game camera', () => {
    const game = createIsoCamera();
    fitIsoCamera(game, ROOM, 844 / 390);
    const before = [game.position.toArray(), game.projectionMatrix.toArray(), game.zoom];
    const photo = createIsoCamera();
    placePhotoCamera(photo, { room: ROOM }, ASPECT, PHOTO_CAMERA);
    expect([game.position.toArray(), game.projectionMatrix.toArray(), game.zoom]).toEqual(before);
  });
});

describe('takeEndPhoto', () => {
  const NOW = asRealMs(1234);
  const WORLD = { time: { sim: 99 } } as unknown as World;
  const SCENE = new Scene();

  interface Harness {
    deps: EndPhotoDeps;
    log: string[];
    canvas: { width: number; height: number; getContext: (kind: string) => unknown };
    gameCamera: ReturnType<typeof createIsoCamera>;
    photoContext: ReturnType<typeof makeContext>;
    captured: { scene: unknown; camera: unknown; aspect: number; target: unknown }[];
  }

  function harness(options: { captureError?: boolean; hasContext?: boolean } = {}): Harness {
    const log: string[] = [];
    // The vignette's first call lands in `log`, beside `update` and `capture`, to read their order.
    const photoContext = makeContext(() => log.push('vignette'));
    const canvas = {
      width: 0,
      height: 0,
      getContext: (kind: string) => {
        log.push(`getContext:${kind}`);
        return options.hasContext === false ? null : photoContext.context;
      },
    };
    const captured: Harness['captured'] = [];
    const gameCamera = createIsoCamera();
    const level = {
      scene: SCENE,
      room: ROOM,
      update: (world: unknown, alpha: number, nowReal: unknown) => {
        log.push(`update:${(world as World) === WORLD}:${alpha}:${String(nowReal)}`);
      },
    } as unknown as EndPhotoDeps['level'];
    const deps: EndPhotoDeps = {
      renderer: {
        capture: (scene, camera, aspect, target) => {
          log.push('capture');
          captured.push({ scene, camera, aspect, target });
          return options.captureError === true
            ? err({ kind: 'render', message: 'no size' })
            : ok(undefined);
        },
      },
      level,
      camera: createIsoCamera(),
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    };
    return { deps, log, canvas, gameCamera, photoContext, captured };
  }

  const options = { photo: PHOTO, photoCamera: PHOTO_CAMERA };

  it('draws the snapshot world at alpha 1, captures it, then draws the vignette over the copy, in this order', () => {
    const { deps, log } = harness();
    takeEndPhoto(deps, WORLD, options, NOW);
    expect(log).toEqual(['getContext:2d', `update:true:1:${String(NOW)}`, 'capture', 'vignette']);
  });

  it('returns a 2D canvas of the size feedback.json says', () => {
    const { deps, canvas } = harness();
    const result = takeEndPhoto(deps, WORLD, options, NOW);
    expect(result).toEqual({ ok: true, value: canvas });
    expect(canvas.width).toBe(PHOTO.widthPx);
    expect(canvas.height).toBe(PHOTO.heightPx);
  });

  it("captures the level's scene through the photo's own camera at the photo's aspect, into its context", () => {
    const { deps, captured, photoContext } = harness();
    takeEndPhoto(deps, WORLD, options, NOW);
    expect(captured).toEqual([
      { scene: SCENE, camera: deps.camera, aspect: ASPECT, target: photoContext.context },
    ]);
    // Placed from the feel: zoom 1 + zoomPct / 100.
    expect(deps.camera.zoom).toBeCloseTo(1 + PHOTO_CAMERA.zoomPct / 100);
  });

  it('draws the vignette as one saved, scaled gradient fill (after the copy: see the order above)', () => {
    const { deps, photoContext } = harness();
    takeEndPhoto(deps, WORLD, options, NOW);
    expect(photoContext.calls.map((call) => call[0])).toEqual([
      'save',
      'scale',
      'createRadialGradient',
      'addColorStop',
      'addColorStop',
      'fillRect',
      'restore',
    ]);
  });

  it('is an err, with no vignette, when the capture fails', () => {
    const { deps, photoContext, log } = harness({ captureError: true });
    const result = takeEndPhoto(deps, WORLD, options, NOW);
    expect(result).toMatchObject({ ok: false, error: { kind: 'render' } });
    expect(photoContext.calls).toEqual([]);
    expect(log).not.toContain('vignette');
  });

  it('is an err, and captures nothing, when the canvas has no 2D context', () => {
    const { deps, log } = harness({ hasContext: false });
    const result = takeEndPhoto(deps, WORLD, options, NOW);
    expect(result).toMatchObject({ ok: false, error: { kind: 'render' } });
    expect(log).toEqual(['getContext:2d']);
  });

  it('reads the camera from the options it is given, so a tune applies to the next photo', () => {
    const first = harness();
    takeEndPhoto(first.deps, WORLD, options, NOW);
    const second = harness();
    takeEndPhoto(
      second.deps,
      WORLD,
      { ...options, photoCamera: { ...PHOTO_CAMERA, zoomPct: 30 } },
      NOW,
    );
    expect(second.deps.camera.zoom).toBeCloseTo(1.3);
    expect(second.deps.camera.zoom).not.toBeCloseTo(first.deps.camera.zoom);
  });
});
