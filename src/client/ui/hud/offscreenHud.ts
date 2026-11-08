import {
  OFFSCREEN_BUBBLE_CHIP_HEIGHT_PX,
  OFFSCREEN_BUBBLE_CHIP_WIDTH_PX,
  OFFSCREEN_BUBBLE_HYSTERESIS_PX,
  OFFSCREEN_BUBBLE_ICON_COMPACT_PX,
  OFFSCREEN_BUBBLE_ICON_REGULAR_PX,
  OFFSCREEN_BUBBLE_MAX_COUNT,
  THREAT_ICON_COMPACT_PX,
  THREAT_ICON_REGULAR_PX,
} from '@shared/constants';
import { type FollowFrame, viewUM, viewVM } from '@shared/followCamera';
import { type FollowInsets, followFramePointOf, isInFollowFrame } from '@shared/followVisibility';
import { threatCloseAt } from '@shared/urgency';
import type { ThreatInstance } from '@sim';
import type { OffscreenBubbles } from '../world/offscreenBubble.ts';
import {
  createOffscreenCandidate,
  createOffscreenObstacle,
  createOffscreenSlots,
  createOffscreenViewport,
  layoutOffscreen,
  type OffscreenCandidate,
  type OffscreenChipPlace,
  type OffscreenObstacle,
  type OffscreenSlot,
  offscreenBubbleRadii,
  placeOffscreenChip,
} from '../world/offscreenLayout.ts';
import type { ThreatMarkerEntry } from '../world/threatMarkers.ts';

// The off-screen bubbles' frame (story 9.3): which active threats of a follow level are outside the
// follow frame (`followVisibility.ts`, D2), where their bubbles go (`offscreenLayout.ts`, D3), and the
// DOM (`offscreenBubble.ts`). Boot calls `update` once per frame, after the markers' update; a fixed
// level costs nothing. The screen is measured on the first frame after `invalidate` (a resize, a new
// level), never per frame.

/** No inset at all: « drawn on screen » for Papa's gaze (story 7.8), not « seen past the HUD ». */
const NO_INSETS: FollowInsets = { leftPx: 0, rightPx: 0, topPx: 0, bottomPx: 0 };

/** The screen as the HUD sees it, in CSS px from the HUD root's top left. Written by `OffscreenHudDeps.measure`. */
export interface OffscreenScreen {
  /** The HUD root's top left on the page: a pointer's client point minus it is a HUD point. */
  hudLeftPx: number;
  hudTopPx: number;
  widthPx: number;
  heightPx: number;
  /** The HUD row: its left and right insets, and its bottom. */
  insetLeftPx: number;
  insetRightPx: number;
  hudBottomPx: number;
  /** The canvas box, in the HUD root's px: the follow frame is drawn there. */
  canvasLeftPx: number;
  canvasTopPx: number;
  canvasWidthPx: number;
  canvasHeightPx: number;
  isCompact: boolean;
}

export interface OffscreenHudDeps {
  readonly bubbles: OffscreenBubbles;
  /** The follow camera's base frame (`followRig`): its mode, its half size and its centre. */
  readonly follow: Readonly<{
    mode: 'fixed' | 'follow';
    frame: Readonly<FollowFrame>;
    centreUM: number;
    centreVM: number;
  }>;
  /** Measures the screen into `out`; false when it has no size yet. Called once after each `invalidate`. */
  measure(out: OffscreenScreen): boolean;
  /**
   * Writes the box of the silence bubble and its ring, in HUD px (D8), into `out`: called when the
   * silence bubble shows and after a measure while it shows, never per frame.
   */
  silenceBox(out: OffscreenObstacle): void;
}

export interface OffscreenHud {
  /** A new level: its markers' entries (index-aligned with `world.threats`). Hides every bubble. */
  setLevel(entries: readonly ThreatMarkerEntry[]): void;
  /** The screen changed (a resize, a surface): measured again on the next frame. */
  invalidate(): void;
  /**
   * Once per frame, after the markers' update. `isLive` false (no live level, a fixed camera) hides the
   * bubbles. `isSilenceShown` is whether the silence bubble shows (its box is an obstacle). The bubble
   * of `targetedId` (keyboard, gamepad) or `pressedId` (a press) shows the target-highlight.
   */
  update(
    isLive: boolean,
    threats: readonly Readonly<ThreatInstance>[],
    targetedId: number | null,
    pressedId: number | null,
    isSilenceShown: boolean,
  ): void;
  /** Hides every bubble (a level left). */
  hide(): void;
  /** The threat whose bubble is under the page point, or null (the input mapper asks it first). */
  pick(clientX: number, clientY: number): number | null;
  /**
   * Where the glyph chip goes for `threatId`'s bubble: writes its centre (HUD px) and side, and the
   * bubble's outer radius; false when the threat has no bubble.
   */
  chipOf(threatId: number, out: OffscreenChip): boolean;
  /**
   * Whether the marker of `threatId` was off the follow frame at the last `update` (it has a bubble, or
   * waits behind the cap for one): Papa's gaze does not see it (story 7.8, D8). False in a fixed level.
   */
  isOffscreen(threatId: number): boolean;
  /**
   * Whether the room point (`xM`, `yM`, `zM`) is drawn inside the follow frame, with no inset (story 7.8:
   * is the baby on screen). True in a fixed level, and before the screen is measured.
   */
  isPointOnScreen(xM: number, yM: number, zM: number): boolean;
  /** The bubbles shown, `"<threatId>:<edge>:<x>:<y>:<angle>"` sorted by id, joined by `;` (the debug mirror). */
  mirrorText(): string;
  /** True when the bubbles shown changed in the last `update` (the mirror is rewritten only then). */
  readonly hasChanged: boolean;
}

/** The chip beside a bubble (D7): the bubble's centre (HUD px, and the canvas's NDC), its outer radius, and the side. */
export interface OffscreenChip extends OffscreenChipPlace {
  xPx: number;
  yPx: number;
  ndcX: number;
  ndcY: number;
  radiusPx: number;
}

export function createOffscreenHud(deps: OffscreenHudDeps): OffscreenHud {
  const screen: OffscreenScreen = {
    hudLeftPx: 0,
    hudTopPx: 0,
    widthPx: 0,
    heightPx: 0,
    insetLeftPx: 0,
    insetRightPx: 0,
    hudBottomPx: 0,
    canvasLeftPx: 0,
    canvasTopPx: 0,
    canvasWidthPx: 0,
    canvasHeightPx: 0,
    isCompact: false,
  };
  const viewport = createOffscreenViewport();
  const insets: { -readonly [K in keyof FollowInsets]: number } = {
    leftPx: 0,
    rightPx: 0,
    topPx: 0,
    bottomPx: 0,
  };
  const obstacle = createOffscreenObstacle();
  const slots = createOffscreenSlots();
  /** The slots as last drawn: a change of any value rewrites the mirror. */
  const drawnSlots = createOffscreenSlots();
  let candidates: OffscreenCandidate[] = [];
  /** Per entry: the icon was outside the frame at the last frame (the hysteresis, D2). */
  let wasOutside: boolean[] = [];
  let entries: readonly ThreatMarkerEntry[] = [];
  let isMeasured = false;
  let isShown = false;
  let wasSilenceShown = false;
  let hasChanged = false;
  const point = { xPx: 0, yPx: 0 };

  const measure = (): boolean => {
    if (!deps.measure(screen)) return false;
    const radii = offscreenBubbleRadii(
      screen.isCompact ? OFFSCREEN_BUBBLE_ICON_COMPACT_PX : OFFSCREEN_BUBBLE_ICON_REGULAR_PX,
    );
    viewport.widthPx = screen.widthPx;
    viewport.heightPx = screen.heightPx;
    viewport.insetLeftPx = screen.insetLeftPx;
    viewport.insetRightPx = screen.insetRightPx;
    viewport.hudBottomPx = screen.hudBottomPx;
    viewport.radiusPx = radii.outerPx;
    viewport.centreXPx = screen.canvasLeftPx + screen.canvasWidthPx / 2;
    viewport.centreYPx = screen.canvasTopPx + screen.canvasHeightPx / 2;
    deps.bubbles.setDiscRadius(radii.discPx);
    // An icon is seen when its centre is half its size inside the canvas, and below the HUD row (D2).
    const iconHalfPx = (screen.isCompact ? THREAT_ICON_COMPACT_PX : THREAT_ICON_REGULAR_PX) / 2;
    insets.leftPx = iconHalfPx;
    insets.rightPx = iconHalfPx;
    insets.bottomPx = iconHalfPx;
    insets.topPx = Math.max(0, screen.hudBottomPx - screen.canvasTopPx) + iconHalfPx;
    return true;
  };

  const hide = (): void => {
    if (!isShown) return;
    isShown = false;
    deps.bubbles.hide();
    for (let i = 0; i < wasOutside.length; i++) wasOutside[i] = false;
    for (const slot of slots) slot.threatId = -1;
  };

  /** Whether the slots differ from the ones drawn last (then copies them). */
  const takeChange = (): boolean => {
    let isChanged = false;
    for (let i = 0; i < OFFSCREEN_BUBBLE_MAX_COUNT; i++) {
      const slot = slots[i] as OffscreenSlot;
      const drawn = drawnSlots[i] as OffscreenSlot;
      if (
        slot.threatId !== drawn.threatId ||
        (slot.threatId !== -1 &&
          (slot.xPx !== drawn.xPx ||
            slot.yPx !== drawn.yPx ||
            slot.angleDeg !== drawn.angleDeg ||
            slot.edge !== drawn.edge))
      ) {
        isChanged = true;
        drawn.threatId = slot.threatId;
        drawn.xPx = slot.xPx;
        drawn.yPx = slot.yPx;
        drawn.angleDeg = slot.angleDeg;
        drawn.edge = slot.edge;
      }
    }
    return isChanged;
  };

  return {
    setLevel(levelEntries) {
      hide();
      // What was drawn is gone with the level: a bubble that comes back identical is a change.
      takeChange();
      entries = levelEntries;
      candidates = levelEntries.map(() => createOffscreenCandidate());
      wasOutside = levelEntries.map(() => false);
      deps.bubbles.setLevel(levelEntries);
      isMeasured = false;
    },
    invalidate() {
      isMeasured = false;
    },
    hide() {
      hide();
      hasChanged = takeChange();
    },
    update(isLive, threats, targetedId, pressedId, isSilenceShown) {
      hasChanged = false;
      if (!isLive || deps.follow.mode !== 'follow') {
        hide();
        wasSilenceShown = false;
        obstacle.isSet = false;
        hasChanged = takeChange();
        return;
      }
      if (!isMeasured) {
        isMeasured = measure();
        if (!isMeasured) {
          // No screen to lay out on (the HUD is hidden): the bubbles drawn for the old one must not stay.
          hide();
          hasChanged = takeChange();
          return;
        }
        // A new screen: the silence's box moved with it.
        wasSilenceShown = false;
      }
      if (isSilenceShown !== wasSilenceShown) {
        wasSilenceShown = isSilenceShown;
        if (isSilenceShown) deps.silenceBox(obstacle);
        else obstacle.isSet = false;
      }
      const { frame, centreUM, centreVM } = deps.follow;
      let count = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i] as ThreatMarkerEntry;
        const threat = threats[i];
        const isActive =
          threat !== undefined &&
          threat.id === entry.threatId &&
          (threat.state === 'telegraph' || threat.state === 'windowOpen');
        if (!isActive) {
          wasOutside[i] = false;
          continue;
        }
        followFramePointOf(
          frame,
          centreUM,
          centreVM,
          viewUM(entry.xM, entry.zM),
          viewVM(entry.xM, entry.yM, entry.zM),
          screen.canvasWidthPx,
          screen.canvasHeightPx,
          point,
        );
        const isInside = isInFollowFrame(
          point.xPx,
          point.yPx,
          screen.canvasWidthPx,
          screen.canvasHeightPx,
          insets,
          wasOutside[i] === true,
          OFFSCREEN_BUBBLE_HYSTERESIS_PX,
        );
        wasOutside[i] = !isInside;
        if (isInside) continue;
        const candidate = candidates[count] as OffscreenCandidate;
        candidate.threatId = threat.id;
        candidate.xPx = point.xPx + screen.canvasLeftPx;
        candidate.yPx = point.yPx + screen.canvasTopPx;
        candidate.closeAt = threatCloseAt(threat) ?? Number.POSITIVE_INFINITY;
        count++;
      }
      layoutOffscreen(viewport, candidates, count, obstacle, slots);
      deps.bubbles.update(slots, targetedId, pressedId);
      isShown = count > 0;
      hasChanged = takeChange();
    },
    pick(clientX, clientY) {
      if (!isShown) return null;
      return deps.bubbles.pick(clientX - screen.hudLeftPx, clientY - screen.hudTopPx);
    },
    chipOf(threatId, out) {
      for (let i = 0; i < OFFSCREEN_BUBBLE_MAX_COUNT; i++) {
        const slot = slots[i] as OffscreenSlot;
        if (slot.threatId !== threatId || threatId === -1) continue;
        placeOffscreenChip(
          viewport,
          slots,
          i,
          OFFSCREEN_BUBBLE_CHIP_WIDTH_PX,
          OFFSCREEN_BUBBLE_CHIP_HEIGHT_PX,
          out,
        );
        // No side is free (a crowded small screen): toward the centre all the same, never no chip.
        if (out.side === null) {
          out.side = slot.edge === 'left' ? 'right' : slot.edge === 'right' ? 'left' : 'below';
        }
        out.xPx = slot.xPx;
        out.yPx = slot.yPx;
        out.ndcX = ((slot.xPx - screen.canvasLeftPx) / screen.canvasWidthPx) * 2 - 1;
        out.ndcY = 1 - ((slot.yPx - screen.canvasTopPx) / screen.canvasHeightPx) * 2;
        out.radiusPx = viewport.radiusPx;
        return true;
      }
      return false;
    },
    isOffscreen(threatId) {
      for (let i = 0; i < entries.length; i++) {
        if ((entries[i] as ThreatMarkerEntry).threatId === threatId) return wasOutside[i] === true;
      }
      return false;
    },
    isPointOnScreen(xM, yM, zM) {
      if (deps.follow.mode !== 'follow' || !isMeasured) return true;
      const { frame, centreUM, centreVM } = deps.follow;
      followFramePointOf(
        frame,
        centreUM,
        centreVM,
        viewUM(xM, zM),
        viewVM(xM, yM, zM),
        screen.canvasWidthPx,
        screen.canvasHeightPx,
        point,
      );
      return isInFollowFrame(
        point.xPx,
        point.yPx,
        screen.canvasWidthPx,
        screen.canvasHeightPx,
        NO_INSETS,
        false,
        0,
      );
    },
    mirrorText() {
      const shown = slots.filter((slot) => slot.threatId !== -1);
      shown.sort((a, b) => a.threatId - b.threatId);
      return shown
        .map((slot) => `${slot.threatId}:${slot.edge}:${slot.xPx}:${slot.yPx}:${slot.angleDeg}`)
        .join(';');
    },
    get hasChanged() {
      return hasChanged;
    },
  };
}
