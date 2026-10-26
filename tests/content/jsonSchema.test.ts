import { readFileSync } from 'node:fs';
import { CONTENT_FILES } from '@content/contentFiles';
import { renderContentJsonSchema, toContentJsonSchema } from '@content/jsonSchema';
import { FeelSchema } from '@content/schemas/feel';
import { StringsSchema } from '@content/schemas/strings';
import { describe, expect, it } from 'vitest';

describe('content JSON Schemas', () => {
  it.each(CONTENT_FILES.map((entry) => [entry.schemaName, entry]))(
    'content/_schemas/%s.schema.json is up to date (run npm run content:schemas)',
    (name, entry) => {
      const onDisk = readFileSync(
        new URL(`../../content/_schemas/${name}.schema.json`, import.meta.url),
        'utf8',
      );
      expect(onDisk).toBe(renderContentJsonSchema(entry.schema));
    },
  );

  it('declares $schema as a property of an object schema, with a description', () => {
    const emitted = toContentJsonSchema(FeelSchema) as {
      properties: Record<string, { type?: string; description?: string }>;
      additionalProperties: boolean;
    };
    expect(emitted.properties.$schema?.type).toBe('string');
    expect(emitted.properties.$schema?.description).toBeTruthy();
    expect(emitted.additionalProperties).toBe(false);
  });

  it('leaves a record schema without properties untouched', () => {
    expect(toContentJsonSchema(StringsSchema)).not.toHaveProperty('properties');
  });

  it('is deterministic and free of $ref loops', () => {
    const first = renderContentJsonSchema(FeelSchema);
    expect(renderContentJsonSchema(FeelSchema)).toBe(first);
    expect(first).not.toContain('"$ref"');
  });

  it('points feel.json at its schema and leaves strings.fr.json alone', () => {
    const feel = JSON.parse(
      readFileSync(new URL('../../content/feel.json', import.meta.url), 'utf8'),
    );
    const strings = JSON.parse(
      readFileSync(new URL('../../content/strings.fr.json', import.meta.url), 'utf8'),
    );
    expect(feel.$schema).toBe('./_schemas/feel.schema.json');
    expect(strings).not.toHaveProperty('$schema');
  });
});
