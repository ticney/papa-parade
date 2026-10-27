import {
  CONTENT_PATTERNS,
  CONTENT_SCHEMAS,
  LEVEL_GEOMETRY_PATTERN,
  LEVEL_PATTERN,
  matchContentPattern,
  THREAT_DEF_PATTERN,
} from '@content/contentFiles';
import { describe, expect, it } from 'vitest';

describe('matchContentPattern', () => {
  it.each([
    ['levels/salon_crawler.geometry.json', LEVEL_GEOMETRY_PATTERN, 'salon_crawler'],
    ['levels/salon_crawler.json', LEVEL_PATTERN, 'salon_crawler'],
    ['threats/outlet.json', THREAT_DEF_PATTERN, 'outlet'],
  ])('%s belongs to its pattern, with its id', (file, pattern, id) => {
    expect(matchContentPattern(file)).toEqual({ pattern, id });
  });

  it('never takes a geometry file for a level, whatever the order of the patterns', () => {
    const geometryFirst = [LEVEL_GEOMETRY_PATTERN, LEVEL_PATTERN];
    const levelFirst = [LEVEL_PATTERN, LEVEL_GEOMETRY_PATTERN];
    for (const patterns of [geometryFirst, levelFirst]) {
      expect(matchContentPattern('levels/salon_crawler.geometry.json', patterns)?.pattern).toBe(
        LEVEL_GEOMETRY_PATTERN,
      );
      expect(matchContentPattern('levels/salon_crawler.json', patterns)?.pattern).toBe(
        LEVEL_PATTERN,
      );
    }
  });

  it.each([
    'levels/Salon.json',
    'levels/.json',
    'levels/a/b.json',
    'levels/salon crawler.json',
    'threats/outlet.geometry.json',
    'threats/outlet.txt',
    'feel.json',
    'elsewhere/outlet.json',
  ])('%s matches nothing', (file) => {
    expect(matchContentPattern(file)).toBeUndefined();
  });

  it('gives every pattern a generated JSON Schema of its own', () => {
    const names = CONTENT_SCHEMAS.map((entry) => entry.schemaName);
    expect(new Set(names).size).toBe(names.length);
    for (const pattern of CONTENT_PATTERNS) expect(names).toContain(pattern.schemaName);
  });
});
