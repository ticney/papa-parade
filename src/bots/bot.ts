import type { RoomBox } from '@shared/followCamera';
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
  /** The house chores of a level with stations (story 9.4), for `perfect` and `human`. */
  chores: {
    /** False: the bots never tap a station. */
    isEnabled: boolean;
    /** How long no threat must have been active before a chore is started or resumed, in ms. */
    quietMinMs: number;
  };
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
    /** Extra standard deviation of its aim at a window while Papa works at a chore's station, in ms (story 9.4). */
    backTurnedSdMs: number;
    /** The screen it plays a follow-camera level on, and what a bubble costs to read (story 9.8). */
    view: {
      widthPx: number;
      heightPx: number;
      /** The bottom of the HUD row, in px from the top of the canvas. */
      hudBottomPx: number;
      bubbleReadMs: number;
    };
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
   * The ids of the objects that are chore stations of the level (story 9.4), index-aligned with
   * `world.chores` (`Sim.chores`). Required like `releaseDefIds`: an empty list says "no station", and a
   * bot then draws and does nothing for chores.
   */
  choreObjectIds: readonly string[];
  /**
   * Whether the player is shown the chrono-ring (story 2.11) on a parry or a Firmness: the human bot times
   * its press with `readError.withChronoRing` if so, `readError.withoutChronoRing` if not. The game always
   * shows it; `npm run sim -- --chrono-ring off` replays the conditions of 2026-11-03. Required like
   * `releaseDefIds`; `perfect`, `random` and `idle` ignore it.
   */
  isChronoRingShown: boolean;
  /**
   * What the `human` bot can see of a follow-camera level (story 9.8), built by `botViewOf`. Required like
   * `isChronoRingShown`: `null` says « fixed camera, every active threat is seen », and the bot then plays
   * exactly as it did before the big room. `perfect`, `random` and `idle` ignore it.
   */
  view: BotView | null;
  /**
   * Where the `human` bot counts what it sees (story 9.8), for the sim report; absent: it counts into a
   * private object nobody reads. Filled by the bot, read by the runner after the game, never during it.
   */
  visibilityCounters?: VisibilityCounters;
  settings: BotOptions;
}

/** What a threat's marker stands on, as the client's `def.target` tells it (story 9.3). */
export type BotMarkerTarget = 'anchor' | 'papa' | 'baby' | 'station' | 'hiddenZone';

/**
 * The follow-camera level as the `human` bot sees it (story 9.8): the room's box, its screen, and the
 * points the markers stand on, from which it rebuilds the client's frame (`followCamera.ts`,
 * `followVisibility.ts`) with `feel.camera` read live from the world. Plain data, built by `botViewOf`.
 */
export interface BotView {
  /** The camera box of the room (`roomOf` of its geometry). */
  readonly room: RoomBox;
  /** The bot's screen: the canvas the client would measure. */
  readonly screen: {
    readonly widthPx: number;
    readonly heightPx: number;
    /** A phone-sized surface (the client's icon and bubble sizes). */
    readonly isCompact: boolean;
    readonly hudBottomPx: number;
  };
  /** Extra time to read a threat first seen through an off-screen bubble, in ms. */
  readonly bubbleReadMs: number;
  /** The level's anchors, by id: `positionM`, the point an anchored marker stands on. */
  readonly anchors: Readonly<Record<string, readonly [number, number, number]>>;
  /** What each threat def's marker stands on, by def id. A def the map lacks is anchored. */
  readonly targets: Readonly<Record<string, BotMarkerTarget>>;
  /** The height of the marker of a threat on the baby (a silence, a stealth alert), in metres. */
  readonly babyMarkerYM: number;
}

/**
 * How the `human` bot's sight went over a game, summed (story 9.8, the sim report's `visibility`). The bot
 * writes them, a runner reads them after the game: no event is read to count them.
 */
export interface VisibilityCounters {
  /** Threats telegraphed (cycles that were active while the bot played). */
  telegraphs: number;
  /** Threats first seen through an off-screen bubble. */
  seenOffscreen: number;
  /** Σ time a threat waited, in ms, for a bubble behind the cap of three. */
  cappedMs: number;
  /** Threats whose window closed before the bot saw them. */
  neverSeen: number;
  /** Threats seen after their telegraph began (late, or through a bubble). */
  seenLate: number;
  /** Σ over those of `seenAt − enteredAt`, in ms. */
  seenLateDelayMs: number;
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
