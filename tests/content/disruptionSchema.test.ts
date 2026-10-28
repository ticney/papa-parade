import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import { DISRUPTION_KINDS, DisruptionDefSchema } from '@content/schemas/disruption';
import { describe, expect, it } from 'vitest';

const FILE = 'content/disruptions/phone.json';
const real: Record<string, unknown> = JSON.parse(
  readFileSync(new URL('../../content/disruptions/phone.json', import.meta.url), 'utf8'),
);

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), DisruptionDefSchema);
}

function pathsOf(value: unknown): string[] {
  const result = parse(value);
  return result.ok ? [] : result.error.map((problem) => problem.jsonPath);
}

describe('content/disruptions/phone.json', () => {
  it('parses against DisruptionDefSchema, as the phone', () => {
    const parsed = parse(real);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe('phone');
    expect(parsed.value.kind).toBe('phone');
  });

  it('keeps its numbers in the JSON, in ms and points, never in the code (D2)', () => {
    const parsed = parse(real);
    expect(parsed.ok && parsed.value.ringMaxMs).toBeGreaterThan(0);
    expect(parsed.ok && parsed.value.answerBusyMs).toBeGreaterThan(0);
    expect(parsed.ok && parsed.value.answerFatiguePoints).toBeGreaterThanOrEqual(0);
    for (const key of Object.keys(real).filter((candidate) => /^(ring|answer)/.test(candidate))) {
      expect(key, key).toMatch(/(Ms|Points)$/);
    }
  });

  it('lists the kinds the sim has a handler for', () => {
    expect([...DISRUPTION_KINDS]).toEqual(['phone']);
  });

  it.each<[string, unknown, string[]]>([
    ['an unknown kind', { ...real, kind: 'dog' }, ['kind']],
    ['a ringMaxMs of 0', { ...real, ringMaxMs: 0 }, ['ringMaxMs']],
    ['a fractional ringMaxMs', { ...real, ringMaxMs: 1500.5 }, ['ringMaxMs']],
    ['an answerBusyMs of 0', { ...real, answerBusyMs: 0 }, ['answerBusyMs']],
    ['negative fatigue points', { ...real, answerFatiguePoints: -1 }, ['answerFatiguePoints']],
    ['an id in camelCase', { ...real, id: 'phoneCall' }, ['id']],
    ['a stray key', { ...real, volume: 3 }, ['volume']],
    [
      'a feedback cue that is not an id',
      { ...real, feedback: { ring: 'Ring Tone', answer: 'papa_phone_answer' } },
      ['feedback.ring'],
    ],
    [
      'a feedback with no answer cue',
      { ...real, feedback: { ring: 'tel_phone_ring' } },
      ['feedback.answer'],
    ],
  ])('rejects %s', (_name, value, expected) => {
    expect(pathsOf(value)).toEqual(expected);
  });

  it('accepts free fatigue (0 points): answering costs nothing', () => {
    expect(parse({ ...real, answerFatiguePoints: 0 })).toMatchObject({ ok: true });
  });
});
