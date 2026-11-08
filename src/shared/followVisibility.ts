import type { FollowFrame } from './followCamera.ts';

// Whether a point of the room is inside the follow camera's frame (story 9.3, D2), as pure maths: no
// `three`, no DOM. The client decides with it which threats get an off-screen bubble; the `human` bot
// (`bots/botSight.ts`, story 9.8) decides with the very same test which threats it may react to, from
// the frame it rebuilds with `followCamera.ts`.
//
// The frame is the follow's own view at zoom 1 (its centre in the view plane and its half size): the
// perfect's zoom, lean and turn and the sequence framing are not in it. Screen points are CSS px from
// the top left of a `widthPx × heightPx` screen.

/** A point of the screen, in CSS px from the top left. */
export interface FollowScreenPoint {
  xPx: number;
  yPx: number;
}

/**
 * How far inside each edge of the screen a point must be to count as seen, in CSS px: the client's
 * icon half size on every side, plus the HUD row at the top (an icon under the gauges is not seen).
 */
export interface FollowInsets {
  readonly leftPx: number;
  readonly rightPx: number;
  readonly topPx: number;
  readonly bottomPx: number;
}

/**
 * Writes into `out` the screen point of the view-plane point `(uM, vM)` (`viewUM`, `viewVM` of a world
 * point) in the follow frame of half size `frame` centred on `(centreUM, centreVM)`, on a screen of
 * `widthPx × heightPx`. Allocates nothing.
 */
export function followFramePointOf(
  frame: Readonly<Pick<FollowFrame, 'halfWidthM' | 'halfHeightM'>>,
  centreUM: number,
  centreVM: number,
  uM: number,
  vM: number,
  widthPx: number,
  heightPx: number,
  out: FollowScreenPoint,
): void {
  out.xPx = (widthPx / 2) * (1 + (uM - centreUM) / frame.halfWidthM);
  out.yPx = (heightPx / 2) * (1 - (vM - centreVM) / frame.halfHeightM);
}

/**
 * True when the screen point `(xPx, yPx)` is inside the screen by at least `insets` on each side (a
 * point exactly on the line is inside). `wasOutside` is the answer the caller acted on last time
 * (a bubble is shown): such a point must then be `hysteresisPx` further inside to count as back, so
 * that a point on the line never flickers in and out while the camera settles.
 */
export function isInFollowFrame(
  xPx: number,
  yPx: number,
  widthPx: number,
  heightPx: number,
  insets: Readonly<FollowInsets>,
  wasOutside: boolean,
  hysteresisPx: number,
): boolean {
  const extraPx = wasOutside ? hysteresisPx : 0;
  return (
    xPx >= insets.leftPx + extraPx &&
    xPx <= widthPx - insets.rightPx - extraPx &&
    yPx >= insets.topPx + extraPx &&
    yPx <= heightPx - insets.bottomPx - extraPx
  );
}
