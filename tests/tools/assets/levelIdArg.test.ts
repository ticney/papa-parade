import { describe, expect, it } from 'vitest';
import { levelIdArg } from '../../../tools/assets/levelIdArg.ts';

describe('levelIdArg', () => {
  it('takes the one level the command line names', () => {
    expect(levelIdArg(['salon_kitchen'], 'assets:export')).toEqual({
      ok: true,
      value: 'salon_kitchen',
    });
  });

  it('refuses a bare run with the usage line, never a default level (story 9.8)', () => {
    const result = levelIdArg([], 'assets:extract');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('usage: npm run assets:extract -- <levelId>');
  });

  it('refuses a second argument and an id that is not lower_snake_case', () => {
    expect(levelIdArg(['salon_kitchen', 'chambre_night'], 'assets:export').ok).toBe(false);
    expect(levelIdArg(['../salon_kitchen'], 'assets:export').ok).toBe(false);
    expect(levelIdArg(['Salon'], 'assets:export').ok).toBe(false);
  });
});
