import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// `content/levels/<id>.json`: what a level plans, beside `<id>.geometry.json` (its room) and
// `assets/levels/<id>.glb` (its look). Story 1.18 replaced the flat `threats` list with waves and
// added the variant, the duration and the feel overrides; story 1.17 added `objects`, the
// interactive things (coffee machine, phone) Space or A can walk Papa to. Story 1.20 adds
// `disruptions` to a wave.

/** The level variants the game has. Each one has its own timer icon (`client/ui/hud/timerHud.ts`). */
export const LEVEL_VARIANTS = ['nap'] as const;
export type LevelVariant = (typeof LEVEL_VARIANTS)[number];

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

const LevelWaveThreatSchema = z
  .strictObject({
    def: idSchema('The id of a `content/threats/<def>.json`.'),
    anchor: idSchema('An anchor of the level geometry, without the `ANCHOR_` prefix.'),
  })
  .describe('One threat a wave adds: what, and where. An anchor is planned once in the level.');

const LevelWaveSchema = z
  .strictObject({
    fromMs: z
      .number()
      .min(0)
      .describe(
        'The wave starts at this sim time, in sim ms. Strictly increasing from wave to wave.',
      ),
    maxSimultaneous: z
      .number()
      .int()
      .min(1)
      .describe('At most this many threats announced or open at once, a count of at least 1.'),
    gapMinMs: z
      .number()
      .min(0)
      .describe('Shortest sim time between two telegraphs of this wave, in sim ms.'),
    gapMaxMs: z
      .number()
      .min(0)
      .describe(
        'Longest sim time between two telegraphs of this wave, in sim ms; at least `gapMinMs`.',
      ),
    lullMs: z
      .number()
      .min(0)
      .describe(
        'No new telegraph in the last stretch of the wave, in sim ms, so that it ends visibly. Below the wave length.',
      ),
    threats: z
      .array(LevelWaveThreatSchema)
      .default([])
      .describe(
        'The threats this wave adds to the pool. Waves are cumulative: wave `w` draws from waves `0..w`.',
      ),
  })
  .describe(
    'One wave of the escalation: from when, how many threats at once, how often, and what it adds.',
  );

const LevelObjectSchema = z
  .strictObject({
    id: idSchema('The object id, the `objectId` of `TapObject`; unique in the level.'),
    anchor: idSchema('An anchor of the level geometry, without the `ANCHOR_` prefix.'),
  })
  .describe('One interactive object: what Space or A can walk Papa to, and where it stands.');

export const LevelSchema = z
  .strictObject({
    id: idSchema('The level id; equals the file name and the id of its geometry.'),
    variant: z
      .enum(LEVEL_VARIANTS)
      .describe('The kind of level: it picks the timer icon and name.'),
    durationMs: z
      .number()
      .int()
      .positive()
      .describe('The level lasts this long, in sim ms; the timer ends it.'),
    waves: z
      .array(LevelWaveSchema)
      .describe('The waves of the level, in order. None: the level plans no threat.'),
    objects: z
      .array(LevelObjectSchema)
      .default([])
      .describe('The interactive objects of the level (story 1.17); none by default.'),
    feelOverrides: z
      .record(z.string(), z.unknown())
      .default({})
      .describe('A partial `feel.json` merged over the base feel for this level only.'),
  })
  .superRefine((level, ctx) => {
    const planned = new Map<string, string>();
    level.waves.forEach((wave, w) => {
      const where = `waves[${w}]`;
      const next = level.waves[w + 1];
      const previous = level.waves[w - 1];
      if (previous !== undefined && wave.fromMs <= previous.fromMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['waves', w, 'fromMs'],
          message: `${where}: fromMs (${wave.fromMs}) must be after the previous wave's (${previous.fromMs})`,
        });
      }
      if (wave.fromMs >= level.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['waves', w, 'fromMs'],
          message: `${where}: fromMs (${wave.fromMs}) must be before the level's durationMs (${level.durationMs})`,
        });
      }
      if (wave.gapMinMs > wave.gapMaxMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['waves', w, 'gapMinMs'],
          message: `${where}: gapMinMs (${wave.gapMinMs}) must not be above gapMaxMs (${wave.gapMaxMs})`,
        });
      }
      const spanMs = (next?.fromMs ?? level.durationMs) - wave.fromMs;
      if (wave.lullMs >= spanMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['waves', w, 'lullMs'],
          message: `${where}: lullMs (${wave.lullMs}) must be below the wave's length (${spanMs} ms)`,
        });
      }
      // The first telegraph comes `gapMinMs` or more after `fromMs`; it must land before the lull.
      if (wave.lullMs < spanMs && wave.gapMinMs >= spanMs - wave.lullMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['waves', w, 'gapMinMs'],
          message: `${where}: no telegraph can land: gapMinMs (${wave.gapMinMs}) must be below the wave's length (${spanMs} ms) minus its lullMs (${wave.lullMs})`,
        });
      }
      wave.threats.forEach((threat, i) => {
        const earlier = planned.get(threat.anchor);
        if (earlier !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['waves', w, 'threats', i, 'anchor'],
            message: `${where}.threats[${i}]: the anchor "${threat.anchor}" is already planned by ${earlier}`,
          });
        }
        planned.set(threat.anchor, `${where}.threats[${i}]`);
      });
    });
  })
  .describe(
    'A level: its variant, its length, the waves of threats it plans and the objects it offers.',
  );

export type Level = z.infer<typeof LevelSchema>;
export type LevelWave = z.infer<typeof LevelWaveSchema>;
export type LevelWaveThreat = z.infer<typeof LevelWaveThreatSchema>;
export type LevelObject = z.infer<typeof LevelObjectSchema>;
