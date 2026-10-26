import { z } from 'zod';

type JsonObject = Record<string, unknown>;

/**
 * The JSON Schema of a content file, for the editor (autocomplete, tooltips from `.describe()`).
 * Zod emits `additionalProperties: false` for strict objects, so the `$schema` key that a data
 * file uses to point at this very schema is declared as a property; the loader ignores it.
 */
export function toContentJsonSchema(schema: z.ZodType): JsonObject {
  const emitted = z.toJSONSchema(schema) as JsonObject;
  const properties = emitted.properties;
  if (typeof properties !== 'object' || properties === null) return emitted;
  return {
    ...emitted,
    properties: {
      $schema: {
        type: 'string',
        description: 'Path to this JSON Schema: editor autocomplete only, ignored by the loader.',
      },
      ...properties,
    },
  };
}

/** What `content/_schemas/<name>.schema.json` must contain: 2-space JSON, trailing newline. */
export function renderContentJsonSchema(schema: z.ZodType): string {
  return `${JSON.stringify(toContentJsonSchema(schema), null, 2)}\n`;
}
