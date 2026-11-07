import { readFileSync } from 'node:fs';
import { formatContentProblem } from '@content/contentError';
import { MAMA_LINES_FILE } from '@content/contentFiles';
import { parseContentFile } from '@content/parseContentFile';
import { MAMA_LINE_MAX_CHARS } from '@content/schemas/mamaLines';
import { MAMA_REACTIONS } from '@shared/constants';
import { describe, expect, it } from 'vitest';

const FILE = 'content/mama-lines.json';

const parse = (lines: unknown[]) =>
  parseContentFile(FILE, JSON.stringify({ lines }), MAMA_LINES_FILE.schema);
const messagesOf = (lines: unknown[]): string => {
  const result = parse(lines);
  return result.ok ? '' : result.error.map(formatContentProblem).join('\n');
};
const line = (changes: Record<string, unknown> = {}) => ({
  id: 'laugh_any',
  reaction: 'laugh',
  text: 'Ha ha !',
  ...changes,
});

describe('MamaLinesSchema (story 3.8, AC 6)', () => {
  it('accepts the live file, with its $schema key, and every reaction has a generic line', () => {
    const text = readFileSync(new URL('../../content/mama-lines.json', import.meta.url), 'utf8');
    const result = parseContentFile(FILE, text, MAMA_LINES_FILE.schema);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const reaction of MAMA_REACTIONS) {
      expect(
        result.value.lines.some((entry) => entry.reaction === reaction && entry.when === undefined),
      ).toBe(true);
    }
  });

  it('accepts a line with and without a condition', () => {
    expect(
      parse([
        line(),
        line({
          id: 'stairs_again',
          text: '*Encore* l’escalier ?!',
          when: { tag: 'stairs_slide', minPrevious: 1 },
        }),
        line({ id: 'woke', when: { endReason: 'mamaWoke' } }),
        line({ id: 'both', when: { tag: 'stairs_slide', endReason: 'mamaWoke' } }),
      ]).ok,
    ).toBe(true);
  });

  it('needs at least one line', () => {
    expect(messagesOf([])).toContain('lines');
  });

  it('refuses an unknown key, at the file and at a line', () => {
    expect(parseContentFile(FILE, '{"lines":[],"extra":1}', MAMA_LINES_FILE.schema).ok).toBe(false);
    expect(messagesOf([line({ weight: 2 })])).toContain('weight');
    expect(messagesOf([line({ when: { tag: 'stairs_slide', weight: 2 } })])).toContain('weight');
  });

  it('refuses an id that is not lower_snake_case', () => {
    expect(messagesOf([line({ id: 'LaughAny' })])).toContain('lower_snake_case');
  });

  it('refuses an unknown reaction', () => {
    expect(messagesOf([line({ reaction: 'cry' })])).toContain('reaction');
  });

  describe('text', () => {
    it('refuses a blank text', () => {
      expect(messagesOf([line({ text: '   ' })])).toContain('blank');
      expect(messagesOf([line({ text: '' })])).toContain('empty');
    });

    it('refuses the vouvoiement', () => {
      expect(messagesOf([line({ text: 'Vous avez vu ça ?' })])).toContain('tutoiement');
    });

    it('refuses a word that names failure', () => {
      expect(messagesOf([line({ text: 'Quel échec !' })])).toContain('never name failure');
    });

    it(`allows ${MAMA_LINE_MAX_CHARS} characters and refuses one more`, () => {
      expect(parse([line({ text: 'a'.repeat(MAMA_LINE_MAX_CHARS) })]).ok).toBe(true);
      expect(messagesOf([line({ text: 'a'.repeat(MAMA_LINE_MAX_CHARS + 1) })])).toContain(
        `${MAMA_LINE_MAX_CHARS} characters`,
      );
    });

    it('refuses an odd number of asterisks and accepts pairs', () => {
      expect(messagesOf([line({ text: '*Encore l’escalier ?!' })])).toContain('pairs');
      expect(messagesOf([line({ text: '*Encore* *l’escalier* ?!' })])).toBe('');
      expect(messagesOf([line({ text: '*Encore* l’*escalier ?!' })])).toContain('pairs');
    });
  });

  describe('when', () => {
    it('refuses an empty when', () => {
      expect(messagesOf([line({ when: {} })])).toContain('at least one');
    });

    it('refuses minPrevious without a tag', () => {
      expect(messagesOf([line({ when: { minPrevious: 1 } })])).toContain('needs `tag`');
      expect(messagesOf([line({ when: { minPrevious: 1, endReason: 'timer' } })])).toContain(
        'needs `tag`',
      );
    });

    it('refuses a negative or fractional minPrevious and a tag that is not snake case', () => {
      expect(messagesOf([line({ when: { tag: 'stairs_slide', minPrevious: -1 } })])).toContain(
        'minPrevious',
      );
      expect(messagesOf([line({ when: { tag: 'stairs_slide', minPrevious: 0.5 } })])).toContain(
        'minPrevious',
      );
      expect(messagesOf([line({ when: { tag: 'Stairs-Slide' } })])).toContain('lower_snake_case');
    });
  });
});
