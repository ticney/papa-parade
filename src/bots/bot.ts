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
    /** Shortest time the human bot needs to react after the telegraph, in ms. */
    reactionMs: number;
    /** Where it aims relative to the window's centre, in ms. */
    aimOffsetMs: number;
    /** Standard deviation of its press around the aim, in ms. */
    jitterSdMs: number;
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
