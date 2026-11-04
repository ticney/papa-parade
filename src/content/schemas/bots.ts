import { z } from 'zod';

// Every key of content/bots.json lives here: how the automatic players (`src/bots`) behave. It is
// not part of `feel.json` on purpose: the sim never reads it, so retuning a bot never invalidates a
// recorded journal. Same rules as the other schemas: strict, camelCase, units in the names, no
// `.default()`, `.optional()` or `.transform()`.

const ReadErrorSchema = z
  .strictObject({
    offsetMs: z
      .number()
      .describe(
        "Where the human bot aims relative to the window's centre on this display, in ms (negative = early, 0 = dead centre).",
      ),
    sdMs: z
      .number()
      .min(0)
      .max(2000)
      .describe(
        "Standard deviation of the human bot's press (or release) around that aim, in ms (Gaussian); capped so that a press stays in its cycle.",
      ),
  })
  .describe('How well the human bot times a response that has a chrono-ring.');

const BotHumanSchema = z
  .strictObject({
    reactionMeanMs: z
      .number()
      .min(0)
      .describe(
        'Mean time the human bot needs to react to a sight or a signal, in ms: its press is never before the telegraph plus a draw around this.',
      ),
    reactionSdMs: z
      .number()
      .min(0)
      .describe(
        'Standard deviation of that reaction time, in ms (Gaussian, one draw per response; 0 takes no draw).',
      ),
    reactionMinMs: z
      .number()
      .min(0)
      .describe('Shortest reaction time the human bot can draw, in ms: nobody reacts faster.'),
    readError: z
      .strictObject({
        withChronoRing: ReadErrorSchema.describe(
          'The chrono-ring is shown (the game always shows it since story 2.11).',
        ),
        withoutChronoRing: ReadErrorSchema.describe(
          'The chrono-ring is hidden (the conditions of the 2026-11-03 playtest: `npm run sim -- --chrono-ring off`).',
        ),
      })
      .describe(
        'The timing error of a press on a parry or a Firmness, by what the player is shown.',
      ),
    aimOffsetMs: z
      .number()
      .describe(
        'Where the human bot aims on a rhythm or a signal with no chrono-ring (beats, wait, breath), in ms (negative = early, 0 = dead centre).',
      ),
    jitterSdMs: z
      .number()
      .min(0)
      .describe(
        "Standard deviation of the human bot's press on a rhythm or a signal, in ms (Gaussian).",
      ),
    missWhileBusyPct: z
      .number()
      .min(0)
      .max(100)
      .describe(
        'Chance, in %, that the human bot never answers a threat it first sees while busy elsewhere (finger down, another press planned, Papa asleep, drinking, on the phone or on the toilet); 0 = never.',
      ),
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
