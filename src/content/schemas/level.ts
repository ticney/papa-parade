import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// `content/levels/<id>.json`: what a level plans, beside `<id>.geometry.json` (its room) and
// `assets/levels/<id>.glb` (its look). Minimal until story 1.18, which replaces `threats` with
// waves and adds the duration, the variant and the feel overrides. Story 1.17 adds `objects`, the
// interactive things (coffee machine, phone) Space or A can walk Papa to.

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

const LevelThreatEntrySchema = z
  .strictObject({
    def: idSchema('The id of a `content/threats/<def>.json`.'),
    anchor: idSchema('An anchor of the level geometry, without the `ANCHOR_` prefix.'),
    fromMs: z
      .number()
      .min(0)
      .describe('The director may target this threat from this sim time on, in sim ms.'),
  })
  .describe('One planned threat: what, where, and from when.');

const LevelObjectSchema = z
  .strictObject({
    id: idSchema('The object id, the `objectId` of `TapObject`; unique in the level.'),
    anchor: idSchema('An anchor of the level geometry, without the `ANCHOR_` prefix.'),
  })
  .describe('One interactive object: what Space or A can walk Papa to, and where it stands.');

export const LevelSchema = z
  .strictObject({
    id: idSchema('The level id; equals the file name and the id of its geometry.'),
    threats: z.array(LevelThreatEntrySchema).describe('The threats the level plans, in order.'),
    objects: z
      .array(LevelObjectSchema)
      .default([])
      .describe('The interactive objects of the level (story 1.17); none by default.'),
  })
  .describe('A level: the threats it plans and the objects it offers.');

export type Level = z.infer<typeof LevelSchema>;
export type LevelThreatEntry = z.infer<typeof LevelThreatEntrySchema>;
export type LevelObject = z.infer<typeof LevelObjectSchema>;
