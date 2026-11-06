import { SLIDE_DIRECTION_MIN_M } from '@shared/constants';
import type { GagId } from '@sim';

// Art constants for the gags' stage (provisional: the final slide stays open in deferred-work.md), named
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

/** The baby slides down the stairs this far, in metres... */
export const GAG_SLIDE_M = 0.6;
/** ...out over this long, in sim ms (ease-out: it shoots off, then slows) and stays there while the sim says he is downstairs (story 3.15)... */
export const GAG_SLIDE_OUT_MS = 500;
/** ...and is back at the stairs over this long, in sim ms, when he climbs back or is carried up. */
export const GAG_SLIDE_BACK_MS = 400;
/** He sits this much lower than the floor at the bottom of the stairs, in metres (the room has no stairwell to draw: provisional until E7). */
export const GAG_DOWNSTAIRS_DROP_M = 0.15;

/** What a gag shows. A flag is a stage effect the scene can play; a clip is a one-shot of that character's `.glb`. */
export interface GagPresentation {
  /** The room's lights go out and come back (the lamp plugged into the outlet). */
  readonly lightsOff: boolean;
  /** Papa's hair stands on end. */
  readonly hair: boolean;
  /** The baby goes down the stairs, out and stays while the sim keeps him `downstairs`, then back (story 3.15). */
  readonly babySlide: boolean;
  /** Papa's one-shot, or null. During a glide his squash plays instead: a gag never stops a glide. */
  readonly papaClip: string | null;
  /** The baby's one-shot, or null. */
  readonly babyClip: string | null;
}

/** A gag whose show is its clips alone. */
const NO_STAGE = { lightsOff: false, hair: false, babySlide: false } as const;

/**
 * `Record<GagId, …>`: a gag the sim knows with no presentation here is a type error (AC 5 of
 * story 1.11), so a new `GagId` cannot reach the player as nothing.
 */
export const GAG_PRESENTATIONS: Readonly<Record<GagId, GagPresentation>> = {
  outlet_hair: {
    lightsOff: true,
    hair: true,
    babySlide: false,
    papaClip: 'gag_shock',
    babyClip: 'gag_delight',
  },
  stairs_slide: {
    lightsOff: false,
    hair: false,
    babySlide: true,
    papaClip: 'gag_shock',
    babyClip: 'gag_delight',
  },
  // The falling prop is its show (the sim pushes it): the stage has nothing to add.
  table_object_fall: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: 'laugh' },
  // Papa nodding off is drawn from the world (`papa.state === 'asleep'`: shut eyelids and a « Z »,
  // story 1.19), not played as an effect: his `asleep` loop is the clip.
  papa_asleep: { ...NO_STAGE, papaClip: null, babyClip: 'laugh' },
  // The surprise mischiefs of the suspicious silence (story 1.21); the mess is `world.mess.mischiefs`.
  tissues_everywhere: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: 'gag_delight' },
  crayon_scribbles: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: 'gag_delight' },
  // The pot boils over (story 9.5): the purée on the floor is the decal, the smoke the gag cue's puff.
  pot_boiled_over: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: 'laugh' },
  // The wail in Papa's arms (story 4.1): the baby's cry is his own loop, `cryEndsAt` says so.
  arms_wail: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: null },
  // The eyes reopen in the bedtime duel (story 4.6): `babyLidsAfter` opens them, the clip wakes him.
  baby_eyes_reopened: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: 'wake' },
  // The baby sits up in the fake sleep (story 4.7).
  baby_sat_up: { ...NO_STAGE, papaClip: 'gag_shock', babyClip: 'sat_up' },
  // The baby wakes as he is laid down (story 4.8).
  baby_woke_on_drop: { ...NO_STAGE, papaClip: 'gag_shock', babyClip: 'wake' },
  baby_woke_by_touch: { ...NO_STAGE, papaClip: 'gag_hit', babyClip: 'wake' },
  baby_woke_crying: { ...NO_STAGE, papaClip: 'gag_shock', babyClip: 'wake' },
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

/**
 * How far the baby is from where the gag found him, 0 to `GAG_SLIDE_M` in metres, `elapsedMs` after
 * the stairs gag began: out (ease-out), then held as long as he is downstairs. `releasedAfterMs` is the
 * `elapsedMs` at which the sim brought him back (null while he is still down): from there he comes back
 * (ease-in) over `GAG_SLIDE_BACK_MS`, from wherever he had got to. Exactly 0 before it starts and once back.
 */
export function downstairsOffsetAt(elapsedMs: number, releasedAfterMs: number | null): number {
  const outAt = (ms: number): number => {
    if (!(ms > 0)) return 0;
    if (ms >= GAG_SLIDE_OUT_MS) return GAG_SLIDE_M;
    const left = 1 - ms / GAG_SLIDE_OUT_MS;
    return GAG_SLIDE_M * (1 - left * left);
  };
  if (releasedAfterMs === null || elapsedMs < releasedAfterMs) return outAt(elapsedMs);
  const sinceMs = elapsedMs - releasedAfterMs;
  if (sinceMs >= GAG_SLIDE_BACK_MS) return 0;
  const left = 1 - sinceMs / GAG_SLIDE_BACK_MS;
  return outAt(releasedAfterMs) * left * left;
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
  /**
   * Offsets the baby's view from its sim position, in metres on the floor plane, and lowers him by `dropM`
   * (story 3.15: « en bas des marches »); (0, 0, 0) puts it back.
   */
  setBabySlide(offsetXM: number, offsetZM: number, dropM: number): void;
}

export interface GagFx {
  /**
   * Starts a gag's presentation at `startAt` (sim ms); a new one restarts the effects it lists.
   * `isMotionReduced` (the player asked for fewer animations) keeps the lights, which carry the
   * gag, and drops the hair's snap; the baby is then put at the bottom of the stairs without the slide. `slideDirX` / `slideDirZ` is the unit
   * vector the baby slides along (`slideDirection`); only a gag with a slide reads it.
   */
  start(
    gag: GagId,
    startAt: number,
    isMotionReduced?: boolean,
    slideDirX?: number,
    slideDirZ?: number,
  ): void;
  /**
   * Sets the stage for `clockMs` (sim ms). Writes only while an effect runs, and a last time when it ends.
   * `isBabyDownstairs` (the sim's `baby.state`) keeps the baby down the stairs: out and stays while it is
   * true, back over `GAG_SLIDE_BACK_MS` once it is not. A baby found downstairs with no gag having started
   * (a restored game) is put there at once, along `fallbackDirX` / `fallbackDirZ`.
   */
  update(
    clockMs: number,
    isBabyDownstairs?: boolean,
    fallbackDirX?: number,
    fallbackDirZ?: number,
  ): void;
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
  /** The `elapsedMs` at which the baby left `downstairs`, or null while he is down. */
  let slideReleasedAfterMs: number | null = null;
  /** True when motion is reduced (or the slide was not seen): the pose without the movement. */
  let isSlideInstant = false;
  let slideDirX = 0;
  let slideDirZ = 0;
  return {
    start(gag, startAt, isMotionReduced = false, dirX = 0, dirZ = 0) {
      const presentation = GAG_PRESENTATIONS[gag];
      if (presentation.lightsOff) lightsStartAt = startAt;
      if (presentation.hair && !isMotionReduced) hairStartAt = startAt;
      if (presentation.babySlide) {
        slideStartAt = startAt;
        slideReleasedAfterMs = null;
        isSlideInstant = isMotionReduced;
        slideDirX = dirX;
        slideDirZ = dirZ;
      }
    },
    update(clockMs, isBabyDownstairs = false, fallbackDirX = 0, fallbackDirZ = 1) {
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
      if (slideStartAt === null && isBabyDownstairs) {
        // Found downstairs with no gag seen (a restored game): at the bottom at once.
        slideStartAt = clockMs - GAG_SLIDE_OUT_MS;
        slideReleasedAfterMs = null;
        isSlideInstant = true;
        slideDirX = fallbackDirX;
        slideDirZ = fallbackDirZ;
      }
      if (slideStartAt !== null) {
        const elapsedMs = clockMs - slideStartAt;
        if (!isBabyDownstairs && slideReleasedAfterMs === null) {
          slideReleasedAfterMs = Math.max(0, elapsedMs);
        }
        const releasedAfterMs = slideReleasedAfterMs;
        const offsetM = isSlideInstant
          ? releasedAfterMs === null
            ? GAG_SLIDE_M
            : 0
          : downstairsOffsetAt(elapsedMs, releasedAfterMs);
        stage.setBabySlide(
          slideDirX * offsetM,
          slideDirZ * offsetM,
          (offsetM / GAG_SLIDE_M) * GAG_DOWNSTAIRS_DROP_M,
        );
        const isBack =
          releasedAfterMs !== null &&
          (isSlideInstant || elapsedMs - releasedAfterMs >= GAG_SLIDE_BACK_MS);
        if (isBack) slideStartAt = null;
      }
    },
    reset() {
      lightsStartAt = null;
      hairStartAt = null;
      slideStartAt = null;
      slideReleasedAfterMs = null;
      stage.setLightsFactor(1);
      stage.setHairAmount(0);
      stage.setBabySlide(0, 0, 0);
    },
  };
}
