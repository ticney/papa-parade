import { z } from 'zod';

// Every key of content/bots.json lives here: how the automatic players (`src/bots`) behave. It is
// not part of `feel.json` on purpose: the sim never reads it, so retuning a bot never invalidates a
// recorded journal. Same rules as the other schemas: strict, camelCase, units in the names, no
// `.default()`, `.optional()` or `.transform()`.

const BotHumanSchema = z
  .strictObject({
    reactionMs: z
      .number()
      .min(0)
      .describe(
        'Shortest time the human bot needs to react, in ms: it never presses before the telegraph plus this.',
      ),
    aimOffsetMs: z
      .number()
      .describe(
        "Where the human bot aims relative to the window's centre, in ms (negative = early, 0 = dead centre).",
      ),
    jitterSdMs: z
      .number()
      .min(0)
      .describe("Standard deviation of the human bot's press around its aim, in ms (Gaussian)."),
  })
  .describe('The `human` bot: a plausible attentive player.');

const BotRandomSchema = z
  .strictObject({
    actionsPerSec: z
      .number()
      .min(0)
      .max(100)
      .describe('How many actions the random bot starts per second of sim time, on average.'),
    floorReachM: z
      .number()
      .positive()
      .describe('How far from Papa the random bot may tap on the floor, in metres.'),
    maxHoldMs: z
      .number()
      .positive()
      .describe(
        'Longest the random bot holds a press, in ms; above `feel.input.holdMinMs` so that it also produces Firmness.',
      ),
  })
  .describe('The `random` bot: a fuzzer that exercises every command.');

export const BotsSchema = z
  .strictObject({
    tapMs: z
      .number()
      .positive()
      .describe(
        'How long the perfect and human bots hold a tap, in ms; must stay under `feel.input.holdMinMs` so the tap is a Parry.',
      ),
    human: BotHumanSchema,
    random: BotRandomSchema,
  })
  .describe('Settings of the automatic players used by `npm run sim` and the autoplay.');

export type BotSettings = z.infer<typeof BotsSchema>;
