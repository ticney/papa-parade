import { describe, expect, it } from 'vitest';
import {
  checkStringReferences,
  findMissingStringKeys,
  findStringKeyReferences,
} from './stringRefs.ts';

describe('findStringKeyReferences', () => {
  it('collects string values under properties that end in Key', () => {
    expect(findStringKeyReferences({ id: 'outlet', verbKey: 'verb.lift' })).toEqual([
      { jsonPath: 'verbKey', key: 'verb.lift' },
    ]);
  });

  it('walks nested objects and arrays', () => {
    const value = { a: { labelKey: 'x.y' }, list: [{ nameKey: 'p.q' }, { other: 1 }] };
    expect(findStringKeyReferences(value)).toEqual([
      { jsonPath: 'a.labelKey', key: 'x.y' },
      { jsonPath: 'list[0].nameKey', key: 'p.q' },
    ]);
  });

  it('ignores non-string values and names that merely contain Key', () => {
    expect(
      findStringKeyReferences({
        verbKey: 3,
        labelKey: null,
        keyboard: 'k',
        Key: 'x',
        monkeys: 'y',
      }),
    ).toEqual([]);
  });

  it('returns nothing for scalars and null', () => {
    expect(findStringKeyReferences(null)).toEqual([]);
    expect(findStringKeyReferences('verbKey')).toEqual([]);
  });
});

describe('findMissingStringKeys', () => {
  it('keeps only the references that are absent from the strings', () => {
    const refs = [
      { jsonPath: 'a', key: 'present.key' },
      { jsonPath: 'b', key: 'absent.key' },
    ];
    expect(findMissingStringKeys(refs, { 'present.key': 'x' })).toEqual([refs[1]]);
  });

  it('does not find keys on the prototype', () => {
    expect(findMissingStringKeys([{ jsonPath: 'a', key: 'constructor' }], {})).toHaveLength(1);
  });
});

describe('checkStringReferences', () => {
  const strings = { 'verb.lift': 'SOULÈVE !' };

  it('returns no problem when every reference resolves', () => {
    const files = [{ file: 'content/threats/outlet.json', value: { verbKey: 'verb.lift' } }];
    expect(checkStringReferences(files, strings, 'content/strings.fr.json')).toEqual([]);
  });

  it('names the file, the JSON path and the missing key', () => {
    const files = [
      { file: 'content/threats/outlet.json', value: { steps: [{ verbKey: 'verb.zap' }] } },
    ];
    expect(checkStringReferences(files, strings, 'content/strings.fr.json')).toEqual([
      {
        file: 'content/threats/outlet.json',
        jsonPath: 'steps[0].verbKey',
        message: 'string key "verb.zap" is not in content/strings.fr.json',
      },
    ]);
  });
});
