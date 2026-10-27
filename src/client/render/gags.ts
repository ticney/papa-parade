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

/** What a gag shows on the provisional cubes. A flag is a stage effect the scene can play. */
export interface GagPresentation {
  /** The room's lights go out and come back (the lamp plugged into the outlet). */
  readonly lightsOff: boolean;
  /** Papa's hair stands on end. */
  readonly hair: boolean;
}

/**
 * `Record<GagId, …>`: a gag the sim knows with no presentation here is a type error (AC 5 of
 * story 1.11), so a new `GagId` cannot reach the player as nothing.
 */
export const GAG_PRESENTATIONS: Readonly<Record<GagId, GagPresentation>> = {
  outlet_hair: { lightsOff: true, hair: true },
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

export interface GagStage {
  /** Scales the room's lights: 1 is their normal intensity. */
  setLightsFactor(factor: number): void;
  /** Raises Papa's hair: 0 flat, 1 on end. */
  setHairAmount(amount: number): void;
}

export interface GagFx {
  /** Starts a gag's presentation at `startAt` (sim ms); a new one restarts the effects it lists. */
  start(gag: GagId, startAt: number): void;
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
  return {
    start(gag, startAt) {
      const presentation = GAG_PRESENTATIONS[gag];
      if (presentation.lightsOff) lightsStartAt = startAt;
      if (presentation.hair) hairStartAt = startAt;
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
    },
    reset() {
      lightsStartAt = null;
      hairStartAt = null;
      stage.setLightsFactor(1);
      stage.setHairAmount(0);
    },
  };
}
