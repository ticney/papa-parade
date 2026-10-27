import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toContentJsonSchema } from '../../src/content/jsonSchema.ts';
import { parseContentFile } from '../../src/content/parseContentFile.ts';
import { FeedbackTableSchema } from '../../src/content/schemas/feedback.ts';

// Tunable values are never pinned here (golden rule: Geo tunes them). Structure, ranges and
// cross-field rules only.

const FEEDBACK_URL = new URL('../../content/feedback.json', import.meta.url);
const real: Json = JSON.parse(readFileSync(FEEDBACK_URL, 'utf8'));

// Every numeric key of the file carries its unit: a percentage, a duration or a length in metres.
const UNIT_SUFFIX = /(?:Pct|Ms|M)$/;

type Json = Record<string, unknown>;

function parse(value: unknown) {
  return parseContentFile('content/feedback.json', JSON.stringify(value), FeedbackTableSchema);
}

/** A copy of the real file with the values at the given dotted paths replaced (`undefined` deletes). */
function mutated(...changes: [path: string, value: unknown][]) {
  const copy = structuredClone(real) as Json;
  for (const [path, value] of changes) {
    const names = path.split('.');
    const key = names.pop() as string;
    let node = copy;
    for (const name of names) {
      const next = node[name];
      if (typeof next !== 'object' || next === null) throw new Error(`no group ${name} in ${path}`);
      node = next as Json;
    }
    if (value === undefined) delete node[key];
    else node[key] = value;
  }
  return parse(copy);
}

function failedPaths(result: ReturnType<typeof parse>): string[] {
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/feedback.json', () => {
  it('parses against FeedbackTableSchema', () => {
    expect(parse(real)).toMatchObject({ ok: true });
  });

  it('points at its generated JSON Schema', () => {
    expect(real.$schema).toBe('./_schemas/feedback.schema.json');
  });

  it.each<[string, [string, unknown][], string[]]>([
    ['an unknown bus on a loop', [['loops.babble.bus', 'radio']], ['loops.babble.bus']],
    [
      'an unknown bus on a cue',
      [['cues.papa_bump.audio.bus', 'radio']],
      ['cues.papa_bump.audio.bus'],
    ],
    ['a bus gain of 101', [['buses.sfx.gainPct', 101]], ['buses.sfx.gainPct']],
    ['a bus gain of -1', [['buses.sfx.gainPct', -1]], ['buses.sfx.gainPct']],
    [
      'a cue gain of 101',
      [['cues.papa_bump.audio.gainPct', 101]],
      ['cues.papa_bump.audio.gainPct'],
    ],
    ['a bus missing', [['buses.ui', undefined]], ['buses.ui']],
    [
      'an unknown haptic kind on a cue',
      [['cues.papa_bump.haptic', 'strong']],
      ['cues.papa_bump.haptic'],
    ],
    ['an empty vibration pattern', [['haptics.light.patternMs', []]], ['haptics.light.patternMs']],
    [
      'a vibration pattern of nine items',
      [['haptics.light.patternMs', [1, 1, 1, 1, 1, 1, 1, 1, 1]]],
      ['haptics.light.patternMs'],
    ],
    ['a vibration of 0 ms', [['haptics.light.patternMs', [0]]], ['haptics.light.patternMs[0]']],
    ['a negative fade', [['loops.music.fadeMs', -1]], ['loops.music.fadeMs']],
    ['a cue with no member', [['cues.countdown_tick', {}]], ['cues.countdown_tick']],
    ['an unknown key at the top', [['bogus', 1]], ['bogus']],
    ['an unknown key in a bus', [['buses.sfx.bogusPct', 1]], ['buses.sfx.bogusPct']],
    ['an unknown key in a cue', [['cues.papa_bump.bogus', 1]], ['cues.papa_bump.bogus']],
    [
      'an unknown key in a sound wave',
      [['cues.papa_bump.visual.bogusM', 1]],
      ['cues.papa_bump.visual.bogusM'],
    ],
    ['a clip with no category', [['loops.babble.clip', 'bump']], ['loops.babble.clip']],
    [
      'a clip of an unknown category',
      [['cues.papa_bump.audio.clip', 'noise_bump']],
      ['cues.papa_bump.audio.clip'],
    ],
    ['a clip in camelCase', [['loops.babble.clip', 'baby_babbleLoop']], ['loops.babble.clip']],
    [
      'a sound wave of radius 0',
      [['cues.papa_bump.visual.maxRadiusM', 0]],
      ['cues.papa_bump.visual.maxRadiusM'],
    ],
    [
      'a sound wave wider than 3 m',
      [['cues.papa_bump.visual.maxRadiusM', 3.1]],
      ['cues.papa_bump.visual.maxRadiusM'],
    ],
    [
      'a sound wave of duration 0',
      [['cues.papa_bump.visual.durationMs', 0]],
      ['cues.papa_bump.visual.durationMs'],
    ],
    [
      'an unknown visual kind',
      [['cues.papa_bump.visual.kind', 'confetti']],
      ['cues.papa_bump.visual.kind'],
    ],
    [
      'a sound wave anchored on the sofa',
      [['cues.papa_bump.visual.anchor', 'sofa']],
      ['cues.papa_bump.visual.anchor'],
    ],
    [
      'an event pointing at an invalid cue id',
      [['events.PapaBlocked', 'Papa Bump']],
      ['events.PapaBlocked'],
    ],
    ['a cue id in camelCase', [['cues.papaBump', { haptic: 'light' }]], ['cues.papaBump']],
  ])('refuses %s', (_name, changes, expected) => {
    const failed = failedPaths(mutated(...changes));
    for (const path of expected) expect(failed).toContain(path);
  });

  it('accepts a shake camera effect and a cue with only a camera', () => {
    const result = mutated([
      'cues.countdown_tick',
      { camera: { kind: 'shake', amplitudeM: 0.05, durationMs: 200 } },
    ]);
    expect(result).toMatchObject({ ok: true });
  });

  it.each([
    ['a shake of amplitude 0', { kind: 'shake', amplitudeM: 0, durationMs: 100 }],
    ['a shake wider than half a metre', { kind: 'shake', amplitudeM: 0.6, durationMs: 100 }],
    ['a shake of duration 0', { kind: 'shake', amplitudeM: 0.1, durationMs: 0 }],
  ])('refuses %s', (_name, camera) => {
    expect(mutated(['cues.countdown_tick', { camera }])).toMatchObject({ ok: false });
  });

  it('gives every numeric key of the file a unit suffix', () => {
    const numericKeys: string[] = [];
    const walk = (node: unknown, key: string): void => {
      if (typeof node === 'number') numericKeys.push(key);
      else if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
        for (const [name, child] of Object.entries(node)) walk(child, name);
      }
    };
    walk(real, '');
    expect(numericKeys.length).toBeGreaterThan(0);
    for (const key of numericKeys) expect(key, `${key} has no unit suffix`).toMatch(UNIT_SUFFIX);
  });

  it('describes every key in the JSON Schema, with its unit where it has one', () => {
    const emitted = toContentJsonSchema(FeedbackTableSchema);
    const undescribed: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const schema = node as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown> | undefined;
      for (const [name, child] of Object.entries(properties ?? {})) {
        if (name === '$schema') continue;
        const described = (child as { description?: unknown }).description;
        if (typeof described !== 'string' || described === '') undescribed.push(`${path}${name}`);
        walk(child, `${path}${name}.`);
      }
      const additional = schema.additionalProperties;
      if (typeof additional === 'object' && additional !== null) walk(additional, `${path}*.`);
      for (const branch of [
        ...((schema.oneOf as unknown[]) ?? []),
        ...((schema.anyOf as unknown[]) ?? []),
      ]) {
        walk(branch, path);
      }
    };
    walk(emitted, '');
    expect(undescribed).toEqual([]);
  });
});
