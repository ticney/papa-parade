import { readFileSync } from 'node:fs';
import type { ContentSource } from '@content/contentSource';
import { loadContent } from '@content/loadContent';
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

async function problemsOf(overrides: Record<string, string | null>) {
  const result = await loadContent(memorySource(overrides));
  if (result.ok) throw new Error('expected a failure');
  return result.error.problems;
}

function brokenFeel(change: (feel: Record<string, Record<string, unknown>>) => void): string {
  const feel = JSON.parse(readReal('feel.json'));
  change(feel);
  return JSON.stringify(feel);
}

describe('loadContent', () => {
  it('loads the real content into a bundle', async () => {
    const result = await loadContent(memorySource());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.feel.timing).toBeDefined();
      expect(result.value.strings['start.tap_to_start']).toBeTypeOf('string');
      expect(result.value.feedback.cues).toBeDefined();
    }
  });

  it('names the file and the JSON path of a broken feedback value', async () => {
    const feedback = JSON.parse(readReal('feedback.json'));
    feedback.buses.sfx.gainPct = 101;
    const problems = await problemsOf({ 'feedback.json': JSON.stringify(feedback) });
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/feedback.json', jsonPath: 'buses.sfx.gainPct' }),
    ]);
  });

  it('reports a feedback file the source cannot read', async () => {
    const problems = await problemsOf({ 'feedback.json': null });
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/feedback.json', jsonPath: '' }),
    ]);
  });

  it('names the file and the JSON path of a broken value', async () => {
    const text = brokenFeel((feel) => {
      (feel.timing as Record<string, unknown>).windowMs = 'x';
    });
    const problems = await problemsOf({ 'feel.json': text });
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/feel.json', jsonPath: 'timing.windowMs' }),
    ]);
  });

  it('puts the first problem and the count in the error message', async () => {
    const text = brokenFeel((feel) => {
      (feel.timing as Record<string, unknown>).windowMs = 'x';
      (feel.input as Record<string, unknown>).earlyPress = 'maybe';
      (feel.movement as Record<string, unknown>).glideMaxMs = -1;
    });
    const result = await loadContent(memorySource({ 'feel.json': text }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('content');
      expect(result.error.message).toMatch(
        /^content\/feel\.json › timing\.windowMs: .*\(\+2 more\)$/,
      );
    }
  });

  it('reports invalid JSON on the file root', async () => {
    const problems = await problemsOf({ 'feel.json': '{ "timing": ' });
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/feel.json', jsonPath: '' }),
    ]);
    expect(problems[0]?.message).toMatch(/not valid JSON/);
  });

  it('reports a file the source cannot read', async () => {
    const problems = await problemsOf({ 'strings.fr.json': null });
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/strings.fr.json', jsonPath: '' }),
    ]);
  });

  it('reports a duplicate key', async () => {
    // Repeat the entry whatever its value is: the test must not pin a tunable number.
    const text = readReal('feel.json').replace(
      /"windowMs":\s*[^,\s]+/,
      (entry) => `${entry}, ${entry}`,
    );
    const problems = await problemsOf({ 'feel.json': text });
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/feel.json', jsonPath: 'timing.windowMs' }),
    ]);
  });

  it('collects the problems of every file, not only the first', async () => {
    const problems = await problemsOf({ 'feel.json': '{}', 'strings.fr.json': '{"Bad Key": "x"}' });
    const files = new Set(problems.map((problem) => problem.file));
    expect(files).toEqual(new Set(['content/feel.json', 'content/strings.fr.json']));
  });

  it('returns an error Result when the source returns one', async () => {
    const source: ContentSource = {
      read: () => Promise.resolve(err({ kind: 'content', message: 'disk on fire' })),
    };
    const result = await loadContent(source);
    expect(result.ok).toBe(false);
  });

  it('does not throw when the source rejects', async () => {
    const source: ContentSource = { read: () => Promise.reject(new Error('disk on fire')) };
    const result = await loadContent(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.problems).toContainEqual(
        expect.objectContaining({ file: 'content/feel.json', message: 'disk on fire' }),
      );
    }
  });
});
