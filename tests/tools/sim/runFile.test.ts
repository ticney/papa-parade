import { describe, expect, it } from 'vitest';
import { parseRunFile, runFileName, toRunFile } from '../../../tools/sim/runFile.ts';

const JOURNAL = { version: 3, entries: [] };
const file = () =>
  toRunFile({
    levelId: 'salon_crawler',
    bot: 'human',
    tier: 'normal',
    untilSimMs: 180_000,
    worldHash: 'abc',
    journal: JOURNAL as never,
  });

function parseWith(change: Record<string, unknown>) {
  return parseRunFile({ ...file(), ...change });
}

describe('runFile', () => {
  it('round-trips through JSON', () => {
    const parsed = parseRunFile(JSON.parse(JSON.stringify(file())));
    expect(parsed).toEqual({ ok: true, value: file() });
  });

  it('names a game after its level, bot and seed', () => {
    expect(runFileName('salon_crawler', 'human', 42)).toBe('salon_crawler_human_42.journal.json');
  });

  it('adds a tier other than normal to the name, so two tiers of one seed do not collide', () => {
    expect(runFileName('salon_crawler', 'human', 42, 'normal')).toBe(
      'salon_crawler_human_42.journal.json',
    );
    expect(runFileName('salon_crawler', 'human', 42, 'assistance')).toBe(
      'salon_crawler_human_42_assistance.journal.json',
    );
    expect(runFileName('salon_crawler', 'human', 42, 'experienced')).toBe(
      'salon_crawler_human_42_experienced.journal.json',
    );
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
  ])('refuses %s', (_label, value) => {
    expect(parseRunFile(value).ok).toBe(false);
  });

  it.each([
    [{ kind: 'something.else' }, 'kind'],
    [{ version: 2 }, 'version'],
    [{ levelId: '' }, 'levelId'],
    [{ levelId: 3 }, 'levelId'],
    [{ bot: undefined }, 'bot'],
    [{ worldHash: 12 }, 'worldHash'],
    [{ untilSimMs: 0 }, 'untilSimMs'],
    [{ untilSimMs: '180000' }, 'untilSimMs'],
    [{ untilSimMs: Number.POSITIVE_INFINITY }, 'untilSimMs'],
    [{ journal: null }, 'journal'],
    [{ journal: [] }, 'journal'],
  ])('refuses %j and names the field', (change, field) => {
    const parsed = parseWith(change);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(field);
  });
});

describe('runFile tier (story 2.8)', () => {
  it('reads a file written before the tiers as played at normal', () => {
    const { tier: _tier, ...old } = file();
    const parsed = parseRunFile(old);
    expect(parsed.ok && parsed.value.tier).toBe('normal');
  });

  it('refuses a tier it does not know', () => {
    const parsed = parseWith({ tier: 'hard' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('tier');
  });
});
