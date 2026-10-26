import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseContentFile } from './parseContentFile.ts';

const Schema = z.strictObject({
  timing: z.strictObject({ windowMs: z.number().positive() }),
  list: z.array(z.number()),
});

const FILE = 'content/test.json';
const valid = '{"timing": {"windowMs": 300}, "list": [1, 2]}';

function problemsOf(text: string) {
  const result = parseContentFile(FILE, text, Schema);
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

describe('parseContentFile', () => {
  it('returns the parsed value of a valid file', () => {
    const result = parseContentFile(FILE, valid, Schema);
    expect(result).toEqual({ ok: true, value: { timing: { windowMs: 300 }, list: [1, 2] } });
  });

  it('strips a byte order mark', () => {
    expect(parseContentFile(FILE, `﻿${valid}`, Schema).ok).toBe(true);
  });

  it('ignores a top-level $schema key', () => {
    const text = `{"$schema": "./_schemas/test.schema.json", ${valid.slice(1)}`;
    expect(parseContentFile(FILE, text, Schema).ok).toBe(true);
  });

  it('reports invalid JSON on the file root', () => {
    const [problem, ...rest] = problemsOf('{"timing": ');
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ file: FILE, jsonPath: '' });
    expect(problem?.message).toMatch(/not valid JSON/);
  });

  it('reports the JSON path of a wrong value', () => {
    expect(problemsOf('{"timing": {"windowMs": "x"}, "list": []}')).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'timing.windowMs' }),
    ]);
  });

  it('reports the index of a wrong array item', () => {
    expect(problemsOf('{"timing": {"windowMs": 1}, "list": [1, "b"]}')).toEqual([
      expect.objectContaining({ jsonPath: 'list[1]' }),
    ]);
  });

  it('reports an unknown key with the key itself in the path', () => {
    const problems = problemsOf('{"timing": {"windowMs": 1, "bogusMs": 2}, "list": []}');
    expect(problems).toEqual([expect.objectContaining({ jsonPath: 'timing.bogusMs' })]);
    expect(problems[0]?.message).toMatch(/unknown key "bogusMs"/);
  });

  it('reports one problem per unknown key', () => {
    const paths = problemsOf('{"timing": {"windowMs": 1}, "list": [], "a": 1, "b": 2}').map(
      (problem) => problem.jsonPath,
    );
    expect(paths).toEqual(['a', 'b']);
  });

  it('reports a missing key', () => {
    expect(problemsOf('{"timing": {"windowMs": 1}}')).toEqual([
      expect.objectContaining({ jsonPath: 'list' }),
    ]);
  });

  it('reports a duplicate key even when the last value is valid', () => {
    const problems = problemsOf('{"timing": {"windowMs": 1, "windowMs": 2}, "list": []}');
    expect(problems).toEqual([expect.objectContaining({ jsonPath: 'timing.windowMs' })]);
    expect(problems[0]?.message).toMatch(/duplicate key/);
  });

  it('reports a root of the wrong type on the file root', () => {
    expect(problemsOf('[]')).toEqual([expect.objectContaining({ file: FILE, jsonPath: '' })]);
  });
});
