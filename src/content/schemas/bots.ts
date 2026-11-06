import { z } from 'zod';

// Every key of content/bots.json lives here: how the automatic players (`src/bots`) behave. It is
// not part of `feel.json` on purpose: the sim never reads it, so retuning a bot never invalidates a
// recorded journal. Same rules as the other schemas: strict, camelCase, units in the names, no
// `.default()`, `.optional()` or `.transform()`.

// A press must stay in its cycle: a longer delay, offset or spread than these is a typo. Mirrors `createBot`.
const READ_ERROR_SD_MAX_MS = 2000;
const HUMAN_TIMING_MAX_MS = 10_000;

const ReadErrorSchema = z
  .strictObject({
    offsetMs: z
      .number()
      .min(-HUMAN_TIMING_MAX_MS)
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        "Where the human bot aims relative to the window's centre on this display, in ms (negative = early, 0 = dead centre).",
      ),
    sdMs: z
      .number()
      .min(0)
      .max(READ_ERROR_SD_MAX_MS)
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
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        'Mean time the human bot needs to react to a sight or a signal, in ms: its press is never before the telegraph plus a draw around this.',
      ),
    reactionSdMs: z
      .number()
      .min(0)
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        'Standard deviation of that reaction time, in ms (Gaussian, one draw per response; 0 takes no draw).',
      ),
    reactionMinMs: z
      .number()
      .min(0)
      .max(HUMAN_TIMING_MAX_MS)
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
      .min(-HUMAN_TIMING_MAX_MS)
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        'Where the human bot aims on a rhythm or a signal with no chrono-ring (beats, wait, breath), in ms (negative = early, 0 = dead centre).',
      ),
    jitterSdMs: z
      .number()
      .min(0)
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        "Standard deviation of the human bot's press on a rhythm or a signal, in ms (Gaussian).",
      ),
    missWhileBusyPct: z
      .number()
      .min(0)
      .max(100)
      .describe(
        'Chance, in %, that the human bot never answers a threat it first sees while busy elsewhere (finger down, another press planned, Papa asleep, drinking, on the phone or on the toilet); 0 = never. A false alarm it misses is not braced for either: no held breath, no gasp.',
      ),
    backTurnedSdMs: z
      .number()
      .min(0)
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        "Extra standard deviation, in ms, of the human bot's aim at a threat's window while Papa works at a chore's station (story 9.4: his back is turned to the baby, he reads the room worse); 0 = none. Gaussian, added to the ring's read error, so the cost grows smoothly with the value: one more draw per response planned in a chore, none otherwise.",
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

const BotChoresSchema = z
  .strictObject({
    isEnabled: z
      .boolean()
      .describe(
        'The perfect and human bots do the house chores of a level that has stations (story 9.4). False: they never tap a station.',
      ),
    quietMinMs: z
      .number()
      .min(0)
      .max(HUMAN_TIMING_MAX_MS)
      .describe(
        'How long no threat must have been active before a bot starts or resumes a chore, in ms: chores are done in the lulls.',
      ),
  })
  .describe('How the perfect and human bots do the house chores (story 9.4).');

export const BotsSchema = z
  .strictObject({
    tapMs: z
      .number()
      .positive()
      .describe(
        'How long the perfect and human bots hold a tap, in ms; must stay under `feel.input.holdMinMs` so the tap is a Parry.',
      ),
    chores: BotChoresSchema,
    human: BotHumanSchema,
    random: BotRandomSchema,
  })
  .describe('Settings of the automatic players used by `npm run sim` and the autoplay.');

export type BotSettings = z.infer<typeof BotsSchema>;
