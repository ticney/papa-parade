/** A rectangle of the canvas, in CSS pixels, from its top-left corner (which is also its bottom-left offset: it is centred). */
export interface PhotoRect {
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** A rectangle of the drawing buffer, in buffer pixels, from its top-left corner (the origin `drawImage` reads). */
export interface BufferRect {
  readonly xPx: number;
  readonly yPx: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * The biggest rectangle of aspect `aspect` (width / height) that fits a canvas of
 * `canvasWidthPx` x `canvasHeightPx` CSS pixels, centred in it: where the end photo is drawn
 * (story 3.6, AC 6). Pure. A canvas wider than the aspect leaves bands left and right, a narrower
 * one above and below. Computed in CSS pixels because `setViewport` and `setScissor` take them (three
 * multiplies by the pixel ratio); {@link bufferRectOf} turns the result into what `drawImage` reads.
 */
export function photoRectOf(
  canvasWidthPx: number,
  canvasHeightPx: number,
  aspect: number,
): PhotoRect {
  const isWider = canvasWidthPx / canvasHeightPx > aspect;
  const heightPx = isWider ? canvasHeightPx : canvasWidthPx / aspect;
  const widthPx = isWider ? canvasHeightPx * aspect : canvasWidthPx;
  return {
    xPx: (canvasWidthPx - widthPx) / 2,
    yPx: (canvasHeightPx - heightPx) / 2,
    widthPx,
    heightPx,
  };
}

/**
 * The same rectangle in the drawing buffer, as the viewport three sets for it (`round(css * ratio)`)
 * and as `drawImage` reads it. GL counts `y` from the bottom of the buffer and `drawImage` from the
 * top, so the offset is turned over with the buffer's height. A centred rectangle hides the difference
 * (its top and bottom margins are equal), which is why this is spelled out and pinned with a pixel
 * ratio of 2 (story 3.6, Traps).
 */
export function bufferRectOf(
  rect: PhotoRect,
  pixelRatio: number,
  bufferHeightPx: number,
): BufferRect {
  const widthPx = Math.round(rect.widthPx * pixelRatio);
  const heightPx = Math.round(rect.heightPx * pixelRatio);
  const xPx = Math.round(rect.xPx * pixelRatio);
  const glYPx = Math.round(rect.yPx * pixelRatio);
  return { xPx, yPx: bufferHeightPx - glYPx - heightPx, widthPx, heightPx };
}
