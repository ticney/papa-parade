import { readFileSync } from 'node:fs';
import type { ContentSource } from '@content/contentSource';
import { loadLevelContent } from '@content/loadLevelContent';
import { err, ok } from '@shared/result';
import { describe, expect, it } from 'vitest';

function readReal(file: string): string {
  return readFileSync(new URL(`../../content/${file}`, import.meta.url), 'utf8');
}

/** In-memory source built from the real files; `overrides` replaces text, `null` makes a file unreadable. */
function memorySource(overrides: Record<string, string | null> = {}): ContentSource {
  return {
    async read(file) {
      const override = overrides[file];
      if (override === null) return err({ kind: 'content', message: `cannot read ${file}` });
      return ok(override ?? readReal(file));
    },
  };
}

const planning = (...defs: string[]): string =>
  JSON.stringify({
    id: 'salon_crawler',
    threats: defs.map((def, index) => ({ def, anchor: 'outlet_01', fromMs: index * 1000 })),
  });

async function problemsOf(overrides: Record<string, string | null>, levelId = 'salon_crawler') {
  const result = await loadLevelContent(memorySource(overrides), levelId);
  if (result.ok) throw new Error('expected a failure');
  return result.error.problems;
}

describe('loadLevelContent', () => {
  it('loads the live level, which plans the outlet and loads its def', async () => {
    const result = await loadLevelContent(memorySource(), 'salon_crawler');
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.level.id).toBe('salon_crawler');
    expect(result.value.level.threats.map((entry) => entry.def)).toContain('outlet');
    expect(Object.keys(result.value.threats)).toContain('outlet');
  });

  it('loads exactly the defs a level plans, once each, in order of first reference', async () => {
    const result = await loadLevelContent(
      memorySource({ 'levels/salon_crawler.json': planning('outlet', 'outlet') }),
      'salon_crawler',
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(Object.keys(result.value.threats)).toEqual(['outlet']);
    expect(result.value.threats.outlet?.gag).toBe('outlet_hair');
    expect(result.value.level.threats).toHaveLength(2);
  });

  it('names the level and the path of a def whose file does not exist', async () => {
    const problems = await problemsOf({
      'levels/salon_crawler.json': planning('outlet', 'missing'),
      'threats/missing.json': null,
    });
    expect(problems).toEqual([
      expect.objectContaining({
        file: 'content/levels/salon_crawler.json',
        jsonPath: 'threats[1].def',
      }),
    ]);
  });

  it('collects every problem instead of stopping at the first', async () => {
    const problems = await problemsOf({
      'levels/salon_crawler.json': planning('outlet', 'missing', 'bogus'),
      'threats/missing.json': null,
      'threats/bogus.json': '{ "id": "bogus" }',
    });
    expect(problems.length).toBeGreaterThan(2);
    expect(problems.map((problem) => problem.file)).toContain('content/threats/bogus.json');
    expect(problems.map((problem) => problem.jsonPath)).toContain('threats[1].def');
  });

  it('reports a level file that cannot be read, or that is not valid', async () => {
    expect(await problemsOf({ 'levels/salon_crawler.json': null })).toEqual([
      expect.objectContaining({ file: 'content/levels/salon_crawler.json', jsonPath: '' }),
    ]);
    expect(await problemsOf({ 'levels/salon_crawler.json': '{ nope' })).toEqual([
      expect.objectContaining({ file: 'content/levels/salon_crawler.json', jsonPath: '' }),
    ]);
  });

  it('refuses a level or a def whose id is not its file name', async () => {
    expect(
      await problemsOf({ 'levels/other.json': readReal('levels/salon_crawler.json') }, 'other'),
    ).toEqual([expect.objectContaining({ file: 'content/levels/other.json', jsonPath: 'id' })]);
    const renamed = JSON.stringify({ ...JSON.parse(readReal('threats/outlet.json')), id: 'plug' });
    expect(
      await problemsOf({
        'levels/salon_crawler.json': planning('outlet'),
        'threats/outlet.json': renamed,
      }),
    ).toEqual([expect.objectContaining({ file: 'content/threats/outlet.json', jsonPath: 'id' })]);
  });

  it('turns a source that rejects into a problem instead of throwing', async () => {
    const source: ContentSource = { read: () => Promise.reject(new Error('disk on fire')) };
    const result = await loadLevelContent(source, 'salon_crawler');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('disk on fire');
  });
});
