import {
  OFFSCREEN_BUBBLE_HYSTERESIS_PX,
  OFFSCREEN_BUBBLE_MAX_COUNT,
  STEP_MS,
  THREAT_ICON_COMPACT_PX,
  THREAT_ICON_REGULAR_PX,
} from '@shared/constants';
import {
  createFollowFrame,
  createFollowState,
  type FollowFrame,
  fitFollowFrame,
  settleFollow,
  snapFollow,
  stepFollow,
  viewUM,
  viewVM,
} from '@shared/followCamera';
import {
  type FollowInsets,
  type FollowScreenPoint,
  followFramePointOf,
  isInFollowFrame,
} from '@shared/followVisibility';
import { compareUrgency, threatCloseAt } from '@shared/urgency';
import type { ThreatInstance, World } from '@sim';
import type { BotView, VisibilityCounters } from './bot.ts';

// What the `human` bot sees of a follow-camera level (story 9.8). It rebuilds, step by step and from
// Papa's position and `world.feel.camera`, the frame the client draws, then asks the client's own
// questions of it: is this threat's icon inside the frame (`isInFollowFrame`, with the client's insets
// and hysteresis), and, if not, is it among the `OFFSCREEN_BUBBLE_MAX_COUNT` most urgent threats outside
// it, which are the ones the client gives a bubble. Pure maths on the world: no draw, no clock.
//
// It follows Papa only: the client also aims at a judged threat during a slow-mo (D4, deferred), and
// zooms and leans on a perfect; none of that is in the bot's frame.

/** One cycle of one threat, as the sight remembers it. */
interface Sighting {
  /** The cycle: the threat's `windowOpenAt`, fixed at its telegraph. */
  readonly cycle: number;
  /** The first sim time the bot could act on it (a bubble's reading included), or null while unseen. */
  seenAt: number | null;
  /** The threat is outside the frame as of the last step (the hysteresis). */
  wasOutside: boolean;
  /** Its end was counted as « never seen ». */
  isClosed: boolean;
}

interface OutsideCandidate {
  sighting: Sighting;
  threat: Readonly<ThreatInstance>;
  closeAt: number;
}

export interface Sight {
  /** Looks at the world at its current step: moves the frame, finds what the bot sees now. Call once per `act`, first. */
  update(world: Readonly<World>): void;
  /**
   * When the bot first saw this cycle of `threat`, in sim ms (a reading of a bubble included), or null
   * while it has not (or never will: the window closed first). Valid after `update` of the same step.
   */
  seenAt(threat: Readonly<ThreatInstance>): number | null;
  /** The frame's centre in the view plane, as of the last `update` (what the tests compare with the client's). */
  readonly centreUM: number;
  readonly centreVM: number;
}

export function createSight(view: BotView, counters: VisibilityCounters): Sight {
  const { screen } = view;
  const aspect = screen.widthPx / screen.heightPx;
  const frame: FollowFrame = createFollowFrame();
  const state = createFollowState();
  const iconHalfPx = (screen.isCompact ? THREAT_ICON_COMPACT_PX : THREAT_ICON_REGULAR_PX) / 2;
  // The client's insets (offscreenHud.ts): the icon's half size on every side, the HUD row on top.
  const insets: FollowInsets = {
    leftPx: iconHalfPx,
    rightPx: iconHalfPx,
    bottomPx: iconHalfPx,
    topPx: Math.max(0, screen.hudBottomPx) + iconHalfPx,
  };
  const point: FollowScreenPoint = { xPx: 0, yPx: 0 };
  const sightings = new Map<number, Sighting>();
  // Reused every step: the threats outside the frame, most urgent first.
  const outside: OutsideCandidate[] = [];
  let fittedWidthM = Number.NaN;
  let fittedDepthM = Number.NaN;

  const closeIfUnseen = (sighting: Sighting): void => {
    if (sighting.seenAt === null && !sighting.isClosed) counters.neverSeen++;
    sighting.isClosed = true;
  };

  /** Where the threat's icon stands, in the view plane (the client's marker entry): false if it is on Papa. */
  const markerOf = (threat: Readonly<ThreatInstance>, out: { uM: number; vM: number }): boolean => {
    const target = view.targets[threat.defId] ?? 'anchor';
    if (target === 'papa') return false;
    if (target === 'baby' || target === 'hiddenZone') {
      out.uM = viewUM(threat.xM, threat.zM);
      out.vM = viewVM(threat.xM, view.babyMarkerYM, threat.zM);
      return true;
    }
    const anchor = view.anchors[threat.anchorId];
    const xM = anchor === undefined ? threat.xM : anchor[0];
    const yM = anchor === undefined ? 0 : anchor[1];
    const zM = anchor === undefined ? threat.zM : anchor[2];
    out.uM = viewUM(xM, zM);
    out.vM = viewVM(xM, yM, zM);
    return true;
  };
  const marker = { uM: 0, vM: 0 };

  /** The step at which a threat is first seen: its telegraph if the bot was there for it, else now. */
  const firstSightAt = (now: number, threat: Readonly<ThreatInstance>): number =>
    now < threat.enteredAt + STEP_MS ? threat.enteredAt : now;

  const see = (sighting: Sighting, threat: Readonly<ThreatInstance>, atMs: number): void => {
    sighting.seenAt = atMs;
    if (atMs > threat.enteredAt) {
      counters.seenLate++;
      counters.seenLateDelayMs += atMs - threat.enteredAt;
    }
  };

  return {
    get centreUM() {
      return state.centreUM;
    },
    get centreVM() {
      return state.centreVM;
    },
    update(world) {
      const now = world.time.sim;
      const params = world.feel.camera;
      const papaUM = viewUM(world.papa.xM, world.papa.zM);
      const papaVM = viewVM(world.papa.xM, 0, world.papa.zM);
      if (params.frameWidthM !== fittedWidthM || params.frameDepthM !== fittedDepthM) {
        fitFollowFrame(frame, view.room, params.frameWidthM, params.frameDepthM, aspect);
        // As the client's `fit`: behind the loading screen already on Papa, then settled on a resize.
        if (state.lastAtMs === null) {
          snapFollow(state, frame, params, papaUM, papaVM, papaUM, papaVM, 0);
          state.lastAtMs = null;
        } else {
          settleFollow(state, frame, params, papaUM, papaVM);
        }
        fittedWidthM = params.frameWidthM;
        fittedDepthM = params.frameDepthM;
      }
      stepFollow(state, frame, params, false, papaUM, papaVM, papaUM, papaVM, now);

      let outsideCount = 0;
      for (let i = 0; i < world.threats.length; i++) {
        const threat = world.threats[i] as Readonly<ThreatInstance>;
        let sighting = sightings.get(threat.id);
        const isActive =
          (threat.state === 'telegraph' || threat.state === 'windowOpen') &&
          threat.responseWindow !== null;
        if (!isActive) {
          if (sighting !== undefined) {
            closeIfUnseen(sighting);
            sighting.wasOutside = false;
          }
          continue;
        }
        if (sighting === undefined || sighting.cycle !== threat.windowOpenAt) {
          if (sighting !== undefined) closeIfUnseen(sighting);
          sighting = {
            cycle: threat.windowOpenAt,
            seenAt: null,
            wasOutside: false,
            isClosed: false,
          };
          sightings.set(threat.id, sighting);
          counters.telegraphs++;
        }
        let isInside = true;
        if (markerOf(threat, marker)) {
          followFramePointOf(
            frame,
            state.centreUM,
            state.centreVM,
            marker.uM,
            marker.vM,
            screen.widthPx,
            screen.heightPx,
            point,
          );
          isInside = isInFollowFrame(
            point.xPx,
            point.yPx,
            screen.widthPx,
            screen.heightPx,
            insets,
            sighting.wasOutside,
            OFFSCREEN_BUBBLE_HYSTERESIS_PX,
          );
        }
        sighting.wasOutside = !isInside;
        if (isInside) {
          if (sighting.seenAt === null) see(sighting, threat, firstSightAt(now, threat));
          continue;
        }
        // Outside the frame: it has a bubble if it is among the most urgent such threats.
        let candidate = outside[outsideCount];
        if (candidate === undefined) {
          candidate = { sighting, threat, closeAt: 0 };
          outside[outsideCount] = candidate;
        }
        candidate.sighting = sighting;
        candidate.threat = threat;
        candidate.closeAt = threatCloseAt(threat) ?? Number.POSITIVE_INFINITY;
        // Insertion sort by the client's urgency order (a handful of entries).
        let at = outsideCount;
        while (at > 0) {
          const before = outside[at - 1] as OutsideCandidate;
          if (
            compareUrgency(
              before.closeAt,
              before.threat.id,
              candidate.closeAt,
              candidate.threat.id,
            ) <= 0
          ) {
            break;
          }
          outside[at] = before;
          outside[at - 1] = candidate;
          at--;
        }
        outsideCount++;
      }
      for (let rank = 0; rank < outsideCount; rank++) {
        const { sighting, threat } = outside[rank] as OutsideCandidate;
        if (sighting.seenAt !== null) continue;
        if (rank >= OFFSCREEN_BUBBLE_MAX_COUNT) {
          counters.cappedMs += STEP_MS;
          continue;
        }
        counters.seenOffscreen++;
        see(sighting, threat, firstSightAt(now, threat) + view.bubbleReadMs);
      }
    },
    seenAt(threat) {
      const sighting = sightings.get(threat.id);
      return sighting === undefined || sighting.cycle !== threat.windowOpenAt
        ? null
        : sighting.seenAt;
    },
  };
}
