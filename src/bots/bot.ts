import type { SimCommand, SimEvent, World } from '@sim';

export const BOT_IDS = ['perfect', 'human', 'random', 'idle'] as const;
export type BotId = (typeof BOT_IDS)[number];

/** What a threat asks for, as the sim names it (`'parry'` in E1). Derived from `@sim`, never from `@content`. */
export type BotResponse = Extract<SimEvent, { type: 'ResponseResolved' }>['response'];

/**
 * `content/bots.json`, field by field: a bot may not import `@content`, so the shape is declared
 * here and the CLI passes the content object (structural typing). `tests/bots/botContract.test.ts`
 * checks at compile time that `BotSettings` is assignable to it, so the two cannot drift.
 */
export interface BotOptions {
  /** How long a bot holds a tap, in ms; under `holdMinMs`. */
  tapMs: number;
  human: {
    /** Mean time the human bot needs to react to a sight or a signal, in ms. */
    reactionMeanMs: number;
    /** Standard deviation of that reaction time, in ms; 0 takes no draw. */
    reactionSdMs: number;
    /** Shortest reaction time it can draw, in ms. */
    reactionMinMs: number;
    /** Timing error on a response that has a chrono-ring, by what the player is shown. */
    readError: {
      withChronoRing: { offsetMs: number; sdMs: number };
      withoutChronoRing: { offsetMs: number; sdMs: number };
    };
    /** Where it aims on a rhythm or a signal (no ring) relative to the window's centre, in ms. */
    aimOffsetMs: number;
    /** Standard deviation of its press on a rhythm or a signal, in ms. */
    jitterSdMs: number;
    /** Chance, in %, of never answering a threat first seen while busy elsewhere. */
    missWhileBusyPct: number;
  };
  random: {
    /** Actions started per second of sim time, on average. */
    actionsPerSec: number;
    /** How far from Papa it may tap on the floor, in metres. */
    floorReachM: number;
    /** Longest it holds a press, in ms. */
    maxHoldMs: number;
  };
}

/** Everything a bot is told at creation. Plain data: the CLI fills it from the level and `content/bots.json`. */
export interface BotSetup {
  /** The run's seed; the bot salts it for its own RNG. */
  seed: number;
  /** `feel.input.holdMinMs`: a tap must be released before it to be a Parry. */
  holdMinMs: number;
  /** The response each threat def of the level asks for, by def id (`ThreatInstance.defId`). */
  responses: Readonly<Record<string, BotResponse>>;
  /**
   * The ids of the threat defs judged on a release (story 4.8: the bomb drop's `firm` with a `release`),
   * built beside `responses` by `releaseDefIdsOf`. Their response stays `firm` (`BotResponse` is derived
   * from the sim and gains no member for them); a bot that knows the ids presses early and releases at an
   * instant of its own. Required: an empty list says "none", while a missing one would play the drop as a plain `firm`.
   */
  releaseDefIds: readonly string[];
  /**
   * Where the level puts the baby down (story 4.10: the cycle bot cashes in there, `planCycleDrop`),
   * built by `safeSpotOf`. Required like `releaseDefIds`: null says the room has none.
   */
  safeSpot: { readonly xM: number; readonly zM: number } | null;
  /**
   * Whether the player is shown the chrono-ring (story 2.11) on a parry or a Firmness: the human bot times
   * its press with `readError.withChronoRing` if so, `readError.withoutChronoRing` if not. The game always
   * shows it; `npm run sim -- --chrono-ring off` replays the conditions of 2026-11-03. Required like
   * `releaseDefIds`; `perfect`, `random` and `idle` ignore it.
   */
  isChronoRingShown: boolean;
  settings: BotOptions;
}

export interface Bot {
  readonly id: BotId;
  /**
   * Called once before each `sim.step()`, with the world as it is at `now = world.time.sim`. Pushes
   * into `out` the commands to enqueue now, each with a `t` in `[now, now + STEP_MS)`. Never mutates
   * `world`, never touches `world.rng`.
   */
  act(world: Readonly<World>, out: SimCommand[]): void;
}
