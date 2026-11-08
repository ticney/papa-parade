import { wrapAngleRad } from './characterMotion.ts';

// Papa's gaze (story 7.8, D8). The screen decides what is seen (boot: the markers, the follow frame,
// the bubbles), the scene decides where he looks. Nothing here reads a threat: the candidates come with
// the per-mille their ring drew on screen, so a hidden answer cannot reach his head (GDD principle 5).
// Pure, no Three, nothing allocated.

/** What his head follows now. */
export type PapaGazeKind = 'baby' | 'threat' | 'ahead';

/** What the screen shows of the baby and of the threats, filled by boot each frame. */
export interface PapaGazeSight {
  /** The baby is drawn on screen and not in a suspicious silence. */
  isBabyShown: boolean;
  /** A threat whose ring is drawn on screen: the most advanced one is at (`threatXM`, `threatZM`). */
  hasThreat: boolean;
  threatXM: number;
  threatZM: number;
}

export function createPapaGazeSight(): PapaGazeSight {
  return { isBabyShown: false, hasThreat: false, threatXM: 0, threatZM: 0 };
}

/** One marker as boot hands it (a `ThreatMarkerEntry` fits). */
export interface GazeThreatEntry {
  readonly threatId: number;
  /** Its marker stands on Papa (the micro-sleep, the duel): never looked at, it is him. */
  readonly followsPapa: boolean;
  readonly xM: number;
  readonly zM: number;
}

/**
 * The baby is shown to the gaze: drawn on screen (`isOnScreen`: inside the follow frame, or a fixed
 * camera) and not in a suspicious silence, whose whole point is that he is not seen.
 */
export function isBabyShownForGaze(babyState: string, isOnScreen: boolean): boolean {
  return babyState !== 'mischiefSilent' && isOnScreen;
}

/**
 * Picks the threat the gaze may follow into `sight` (D8): among the markers whose chrono-ring is drawn
 * now (`permilleOf` is null for no ring or a ring not drawn: a `wait`, a hidden silence), not standing on
 * Papa and drawn on screen (no off-screen bubble), the one whose ring is the most advanced; ties go to the
 * lowest threat id. `permilleOf` and `isOnScreen` are boot's, made once. Allocates nothing.
 */
export function pickGazeThreat(
  entries: readonly GazeThreatEntry[],
  permilleOf: (threatId: number) => number | null,
  isOnScreen: (threatId: number) => boolean,
  sight: PapaGazeSight,
): void {
  let bestPermille = Number.NEGATIVE_INFINITY;
  let bestId = Number.POSITIVE_INFINITY;
  sight.hasThreat = false;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as GazeThreatEntry;
    if (entry.followsPapa) continue;
    const permille = permilleOf(entry.threatId);
    if (permille === null) continue;
    if (permille < bestPermille || (permille === bestPermille && entry.threatId > bestId)) {
      continue;
    }
    if (!isOnScreen(entry.threatId)) continue;
    bestPermille = permille;
    bestId = entry.threatId;
    sight.hasThreat = true;
    sight.threatXM = entry.xM;
    sight.threatZM = entry.zM;
  }
}

/** Where he looks, and his head's yaw relative to his body. */
export interface PapaGazeAim {
  kind: PapaGazeKind;
  /** The head's turn from his body, in radians (positive toward his left), clamped to ±`maxYawRad`. */
  yawRad: number;
}

export function createPapaGazeAim(): PapaGazeAim {
  return { kind: 'ahead', yawRad: 0 };
}

/** What the scene knows that the screen does not: where he and the baby are drawn, what he does. */
export interface PapaGazeInput {
  readonly papaXM: number;
  readonly papaZM: number;
  readonly bodyYawRad: number;
  readonly babyXM: number;
  readonly babyZM: number;
  /** He is responding (a glide, a `respond_*` pose): his eyes are on the job, not the baby. */
  readonly isResponding: boolean;
  /** Asleep, he looks ahead. */
  readonly isAsleep: boolean;
}

/** A point nearer him than this, in metres, has no direction: he looks ahead. */
const GAZE_MIN_DISTANCE_M = 0.05;

/**
 * The gaze, in this order (D8): the baby when he is shown and Papa is not responding; else the visible
 * threat whose ring is the most advanced; else ahead. Asleep, ahead. Writes `aim`.
 */
export function papaGazeOf(
  input: Readonly<PapaGazeInput>,
  sight: Readonly<PapaGazeSight>,
  maxYawRad: number,
  aim: PapaGazeAim,
): void {
  aim.kind = 'ahead';
  aim.yawRad = 0;
  if (input.isAsleep) return;
  let xM: number;
  let zM: number;
  if (sight.isBabyShown && !input.isResponding) {
    aim.kind = 'baby';
    xM = input.babyXM;
    zM = input.babyZM;
  } else if (sight.hasThreat) {
    aim.kind = 'threat';
    xM = sight.threatXM;
    zM = sight.threatZM;
  } else {
    return;
  }
  const dx = xM - input.papaXM;
  const dz = zM - input.papaZM;
  if (Math.hypot(dx, dz) < GAZE_MIN_DISTANCE_M) return;
  const relative = wrapAngleRad(Math.atan2(dx, dz) - input.bodyYawRad);
  aim.yawRad = Math.min(maxYawRad, Math.max(-maxYawRad, relative));
}
