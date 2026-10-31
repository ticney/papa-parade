import { SLIDE_DIRECTION_MIN_M } from '@shared/constants';
import type { GagId } from '@sim';

// Art constants for the provisional gags (Geo tunes them here until the real animations, E7), named
// with their units. All on the sim clock: a pause freezes them.
/** The lights fade from full to `GAG_LIGHTS_MIN_PCT` over this long, in sim ms... */
export const GAG_LIGHTS_FADE_MS = 120;
/** ...stay at it this long, in sim ms... */
export const GAG_LIGHTS_DARK_MS = 600;
/** ...and fade back over `GAG_LIGHTS_FADE_MS`. The darkest the room gets, as a share of full light, in percent. */
export const GAG_LIGHTS_MIN_PCT = 25;
/** Papa's hair shoots up, holds and settles back over this long, in sim ms. */
export const GAG_HAIR_MS = 900;
/** The part of `GAG_HAIR_MS` the hair takes to stand on end, in percent. */
export const GAG_HAIR_RISE_PCT = 15;

/** The baby slides away from the stairs this far, in metres... */
export const GAG_SLIDE_M = 0.6;
/** ...out over this long, in sim ms (ease-out: it shoots off, then slows)... */
export const GAG_SLIDE_OUT_MS = 500;
/** ...stays there this long, in sim ms (« ravi »)... */
export const GAG_SLIDE_HOLD_MS = 500;
/** ...and is back at the stairs over this long, in sim ms. */
export const GAG_SLIDE_BACK_MS = 400;

/** What a gag shows on the provisional cubes. A flag is a stage effect the scene can play. */
export interface GagPresentation {
  /** The room's lights go out and come back (the lamp plugged into the outlet). */
  readonly lightsOff: boolean;
  /** Papa's hair stands on end. */
  readonly hair: boolean;
  /** The baby slides away from the threat and back (« en bas des marches », provisional until E7). */
  readonly babySlide: boolean;
}

/**
 * `Record<GagId, …>`: a gag the sim knows with no presentation here is a type error (AC 5 of
 * story 1.11), so a new `GagId` cannot reach the player as nothing.
 */
export const GAG_PRESENTATIONS: Readonly<Record<GagId, GagPresentation>> = {
  outlet_hair: { lightsOff: true, hair: true, babySlide: false },
  stairs_slide: { lightsOff: false, hair: false, babySlide: true },
  // The falling prop is its show (the sim pushes it): the stage has nothing to add.
  table_object_fall: { lightsOff: false, hair: false, babySlide: false },
  // Papa nodding off is drawn from the world (`papa.state === 'asleep'`: shut eyelids and a « Z »,
  // story 1.19), not played as an effect: the stage has nothing to add.
  papa_asleep: { lightsOff: false, hair: false, babySlide: false },
  // The surprise mischiefs of the suspicious silence (story 1.21): the gag cue's ring and sound are
  // the show until E7; the mess is `world.mess.mischiefs`.
  tissues_everywhere: { lightsOff: false, hair: false, babySlide: false },
  crayon_scribbles: { lightsOff: false, hair: false, babySlide: false },
  // The wail in Papa's arms (story 4.1): the gag cue and the baby's cry are the show.
  arms_wail: { lightsOff: false, hair: false, babySlide: false },
  // The eyes reopen in the bedtime duel (story 4.6): the gag cue and the retreat are the show until E7 draws the baby's eyes.
  baby_eyes_reopened: { lightsOff: false, hair: false, babySlide: false },
};

/** Total time the lights are off the full level, in sim ms. */
export const GAG_LIGHTS_TOTAL_MS = GAG_LIGHTS_FADE_MS * 2 + GAG_LIGHTS_DARK_MS;

/**
 * The light intensity factor, 1 (full) to `GAG_LIGHTS_MIN_PCT / 100`, `elapsedMs` after the gag
 * began: fade out, dark, fade in. Exactly 1 before it starts and once it is over.
 */
export function lightsFactorAt(elapsedMs: number): number {
  if (!(elapsedMs > 0 && elapsedMs < GAG_LIGHTS_TOTAL_MS)) return 1;
  const min = GAG_LIGHTS_MIN_PCT / 100;
  if (elapsedMs < GAG_LIGHTS_FADE_MS) return 1 - (1 - min) * (elapsedMs / GAG_LIGHTS_FADE_MS);
  const darkEnd = GAG_LIGHTS_FADE_MS + GAG_LIGHTS_DARK_MS;
  if (elapsedMs < darkEnd) return min;
  return min + (1 - min) * ((elapsedMs - darkEnd) / GAG_LIGHTS_FADE_MS);
}

/** How far Papa's hair stands, 0 (flat) to 1 (on end), `elapsedMs` after the gag began. */
export function hairAmountAt(elapsedMs: number): number {
  if (!(elapsedMs > 0 && elapsedMs < GAG_HAIR_MS)) return 0;
  const riseMs = (GAG_HAIR_MS * GAG_HAIR_RISE_PCT) / 100;
  if (elapsedMs < riseMs) return elapsedMs / riseMs;
  return 1 - (elapsedMs - riseMs) / (GAG_HAIR_MS - riseMs);
}

/** Total time the baby is away from the threat, in sim ms. */
export const GAG_SLIDE_TOTAL_MS = GAG_SLIDE_OUT_MS + GAG_SLIDE_HOLD_MS + GAG_SLIDE_BACK_MS;

/**
 * How far the baby is from where the gag found it, 0 to `GAG_SLIDE_M` in metres, `elapsedMs` after
 * the gag began: out (ease-out), held, back (ease-in). Exactly 0 before it starts and once it is over.
 */
export function slideOffsetAt(elapsedMs: number): number {
  if (!(elapsedMs > 0 && elapsedMs < GAG_SLIDE_TOTAL_MS)) return 0;
  if (elapsedMs < GAG_SLIDE_OUT_MS) {
    const left = 1 - elapsedMs / GAG_SLIDE_OUT_MS;
    return GAG_SLIDE_M * (1 - left * left);
  }
  const backStartMs = GAG_SLIDE_OUT_MS + GAG_SLIDE_HOLD_MS;
  if (elapsedMs < backStartMs) return GAG_SLIDE_M;
  const left = 1 - (elapsedMs - backStartMs) / GAG_SLIDE_BACK_MS;
  return GAG_SLIDE_M * left * left;
}

/**
 * The unit horizontal vector the baby slides along: from the threat to the baby, or, with the baby
 * on the threat (closer than `SLIDE_DIRECTION_MIN_M`: no direction), against its gaze (+z with no
 * gaze either). Written into `out`, no allocation.
 */
export function slideDirection(
  threatXM: number,
  threatZM: number,
  babyXM: number,
  babyZM: number,
  gazeX: number,
  gazeZ: number,
  out: { x: number; z: number },
): void {
  const dx = babyXM - threatXM;
  const dz = babyZM - threatZM;
  const lengthM = Math.sqrt(dx * dx + dz * dz);
  if (lengthM > SLIDE_DIRECTION_MIN_M) {
    out.x = dx / lengthM;
    out.z = dz / lengthM;
    return;
  }
  const gazeLength = Math.sqrt(gazeX * gazeX + gazeZ * gazeZ);
  if (gazeLength > 0) {
    out.x = -gazeX / gazeLength;
    out.z = -gazeZ / gazeLength;
  } else {
    out.x = 0;
    out.z = 1;
  }
}

export interface GagStage {
  /** Scales the room's lights: 1 is their normal intensity. */
  setLightsFactor(factor: number): void;
  /** Raises Papa's hair: 0 flat, 1 on end. */
  setHairAmount(amount: number): void;
  /** Offsets the baby's view from its sim position, in metres on the floor plane; (0, 0) puts it back. */
  setBabySlide(offsetXM: number, offsetZM: number): void;
}

export interface GagFx {
  /**
   * Starts a gag's presentation at `startAt` (sim ms); a new one restarts the effects it lists.
   * `isMotionReduced` (the player asked for fewer animations) keeps the lights, which carry the
   * gag, and drops the hair's snap and the baby's slide. `slideDirX` / `slideDirZ` is the unit
   * vector the baby slides along (`slideDirection`); only a gag with a slide reads it.
   */
  start(
    gag: GagId,
    startAt: number,
    isMotionReduced?: boolean,
    slideDirX?: number,
    slideDirZ?: number,
  ): void;
  /** Sets the stage for `clockMs` (sim ms). Writes only while an effect runs, and a last time when it ends. */
  update(clockMs: number): void;
  /** Ends the effects at once and puts the stage back (a restart, a stopped loop). */
  reset(): void;
}

/**
 * The gag effects of a level, on the sim clock. `stage` is what they move (the scene's lights and
 * Papa's hair); pure of Three so that it is tested with a double. Allocates nothing per frame.
 */
export function createGagFx(stage: GagStage): GagFx {
  let lightsStartAt: number | null = null;
  let hairStartAt: number | null = null;
  let slideStartAt: number | null = null;
  let slideDirX = 0;
  let slideDirZ = 0;
  return {
    start(gag, startAt, isMotionReduced = false, dirX = 0, dirZ = 0) {
      const presentation = GAG_PRESENTATIONS[gag];
      if (presentation.lightsOff) lightsStartAt = startAt;
      if (presentation.hair && !isMotionReduced) hairStartAt = startAt;
      if (presentation.babySlide && !isMotionReduced) {
        slideStartAt = startAt;
        slideDirX = dirX;
        slideDirZ = dirZ;
      }
    },
    update(clockMs) {
      if (lightsStartAt !== null) {
        const elapsedMs = clockMs - lightsStartAt;
        stage.setLightsFactor(lightsFactorAt(elapsedMs));
        if (elapsedMs >= GAG_LIGHTS_TOTAL_MS) lightsStartAt = null;
      }
      if (hairStartAt !== null) {
        const elapsedMs = clockMs - hairStartAt;
        stage.setHairAmount(hairAmountAt(elapsedMs));
        if (elapsedMs >= GAG_HAIR_MS) hairStartAt = null;
      }
      if (slideStartAt !== null) {
        const elapsedMs = clockMs - slideStartAt;
        const offsetM = slideOffsetAt(elapsedMs);
        stage.setBabySlide(slideDirX * offsetM, slideDirZ * offsetM);
        if (elapsedMs >= GAG_SLIDE_TOTAL_MS) slideStartAt = null;
      }
    },
    reset() {
      lightsStartAt = null;
      hairStartAt = null;
      slideStartAt = null;
      stage.setLightsFactor(1);
      stage.setHairAmount(0);
      stage.setBabySlide(0, 0);
    },
  };
}
