import { describe, expect, it } from 'vitest';
import { findDuplicateKeys } from './duplicateKeys.ts';

describe('findDuplicateKeys', () => {
  it('finds nothing in a clean document', () => {
    expect(findDuplicateKeys('{"a": 1, "b": {"a": 2}, "c": [{"a": 1}, {"a": 2}]}')).toEqual([]);
  });

  it('reports a repeated key at the root', () => {
    expect(findDuplicateKeys('{"a": 1, "a": 2}')).toEqual([{ jsonPath: 'a', key: 'a' }]);
  });

  it('reports the path of a nested duplicate', () => {
    const text = '{"timing": {"windowMs": 300, "windowMs": 200}}';
    expect(findDuplicateKeys(text)).toEqual([{ jsonPath: 'timing.windowMs', key: 'windowMs' }]);
  });

  it('reports duplicates inside arrays of objects, with the index', () => {
    const text = '{"list": [{"x": 1}, {"y": 1, "y": 2}]}';
    expect(findDuplicateKeys(text)).toEqual([{ jsonPath: 'list[1].y', key: 'y' }]);
  });

  it('quotes keys that contain dots in the path', () => {
    const text = '{"start.tap_to_start": "a", "start.tap_to_start": "b"}';
    expect(findDuplicateKeys(text)).toEqual([
      { jsonPath: '["start.tap_to_start"]', key: 'start.tap_to_start' },
    ]);
  });

  it('is not fooled by braces, commas and colons inside strings', () => {
    const text = '{"a": "}, \\"a\\": {", "b": ",{[", "c": "x: y"}';
    expect(findDuplicateKeys(text)).toEqual([]);
  });

  it('handles escaped quotes in keys and values', () => {
    const text = '{"q\\"uote": "\\"", "q\\"uote": 1}';
    expect(findDuplicateKeys(text)).toEqual([{ jsonPath: '["q\\"uote"]', key: 'q"uote' }]);
  });

  it('treats an escaped spelling as the same key', () => {
    expect(findDuplicateKeys('{"a": 1, "\\u0061": 2}')).toEqual([{ jsonPath: 'a', key: 'a' }]);
  });

  it('does not flag the same key in sibling objects', () => {
    expect(findDuplicateKeys('{"x": {"k": 1}, "y": {"k": 2}}')).toEqual([]);
  });

  it('does not throw on malformed input', () => {
    expect(() => findDuplicateKeys('{"a": 1, "a"')).not.toThrow();
    expect(() => findDuplicateKeys('}}]]"')).not.toThrow();
  });
});
