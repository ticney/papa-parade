import {
  DEFAULT_DIFFICULTY_TIER,
  DEFAULT_LEVEL_ID,
  DIFFICULTY_TIER_IDS,
  SIM_CLI_MAX_RUNS,
  SIM_CLI_MAX_UNTIL_MS,
} from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { parseSimArgs, SIM_HELP } from '../../../tools/sim/simArgs.ts';

function messageOf(argv: string[]): string {
  const parsed = parseSimArgs(argv);
  if (parsed.ok) throw new Error('expected an error');
  return parsed.error;
}

describe('parseSimArgs', () => {
  it('refuses a batch or a game beyond the caps, and an empty path', () => {
    expect(messageOf(['--bot', 'idle', '--runs', String(SIM_CLI_MAX_RUNS + 1)])).toContain(
      '--runs',
    );
    expect(messageOf(['--bot', 'idle', '--until-ms', String(SIM_CLI_MAX_UNTIL_MS + 1)])).toContain(
      '--until-ms',
    );
    expect(messageOf(['--bot', 'idle', '--out', ''])).toContain('--out');
    expect(messageOf(['--bot', 'idle', '--journals', ''])).toContain('--journals');
    expect(parseSimArgs(['--bot', 'idle', '--runs', String(SIM_CLI_MAX_RUNS)]).ok).toBe(true);
  });

  it('fills the defaults', () => {
    const parsed = parseSimArgs(['--bot', 'perfect']);
    expect(parsed).toEqual({
      ok: true,
      value: {
        levelId: DEFAULT_LEVEL_ID,
        botId: 'perfect',
        tier: DEFAULT_DIFFICULTY_TIER,
        seed: 1,
        runs: 1,
        untilSimMs: null,
        outPath: null,
        journalsDir: null,
        help: false,
      },
    });
  });

  it('reads every flag', () => {
    const parsed = parseSimArgs([
      '--level',
      'other_level',
      '--bot',
      'human',
      '--tier',
      'experienced',
      '--seed',
      '42',
      '--runs',
      '100',
      '--until-ms',
      '60000',
      '--out',
      'report.json',
      '--journals',
      'games',
    ]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        levelId: 'other_level',
        botId: 'human',
        tier: 'experienced',
        seed: 42,
        runs: 100,
        untilSimMs: 60_000,
        outPath: 'report.json',
        journalsDir: 'games',
        help: false,
      },
    });
  });

  it.each(DIFFICULTY_TIER_IDS)('accepts the %s tier', (tier) => {
    const parsed = parseSimArgs(['--bot', 'idle', '--tier', tier]);
    expect(parsed.ok && parsed.value.tier).toBe(tier);
  });

  it('refuses an unknown tier, naming the ones it knows', () => {
    const message = messageOf(['--bot', 'idle', '--tier', 'hard']);
    expect(message).toContain('--tier');
    for (const tier of DIFFICULTY_TIER_IDS) expect(message).toContain(tier);
  });

  it('documents --tier in the help', () => {
    expect(SIM_HELP).toContain('--tier');
  });

  it('rounds the run length up to the step grid', () => {
    const parsed = parseSimArgs(['--bot', 'idle', '--until-ms', '12345']);
    expect(parsed.ok && parsed.value.untilSimMs).toBe(12_350);
  });

  it('accepts the largest seed', () => {
    const parsed = parseSimArgs(['--bot', 'idle', '--seed', String(2 ** 32 - 1)]);
    expect(parsed.ok && parsed.value.seed).toBe(2 ** 32 - 1);
  });

  it('needs --bot, and names the choices', () => {
    expect(messageOf([])).toBe('--bot is required: choose perfect, human, random, idle');
  });

  it('names the choices of an unknown bot', () => {
    expect(messageOf(['--bot', 'genius'])).toBe(
      'unknown bot "genius": choose perfect, human, random, idle',
    );
  });

  it.each([
    [['--seed', 'abc'], '--seed must be a whole number, got "abc"'],
    [['--seed', '1.5'], '--seed must be a whole number, got "1.5"'],
    [['--seed', ''], '--seed must be a whole number, got ""'],
    [['--seed', '4294967296'], '--seed must be below 2**32, got 4294967296'],
    [['--runs', '0'], `--runs must be between 1 and ${SIM_CLI_MAX_RUNS}, got 0`],
    [['--runs', 'many'], '--runs must be a whole number, got "many"'],
    [['--until-ms', '0'], '--until-ms must be a number above 0, got "0"'],
    [['--until-ms', 'soon'], '--until-ms must be a number above 0, got "soon"'],
  ])('refuses %j', (flags, message) => {
    expect(messageOf(['--bot', 'perfect', ...flags])).toBe(message);
  });

  it('turns an unknown flag, a positional and a missing value into an error, not a throw', () => {
    expect(messageOf(['--bot', 'perfect', '--turbo'])).toContain('--turbo');
    expect(messageOf(['--bot', 'perfect', 'extra'])).toContain('extra');
    expect(messageOf(['--bot'])).toContain('--bot');
    expect(messageOf(['--bot', 'perfect', '--seed', '-1'])).toContain('--seed');
  });

  it('has no cap by default: a game lasts the level’s duration', () => {
    const parsed = parseSimArgs(['--bot', 'idle']);
    expect(parsed.ok && parsed.value.untilSimMs).toBeNull();
    expect(SIM_HELP).toContain("level's duration");
    // The ends of the games (story 3.2).
    for (const word of ['endsByReason', 'mamaWokeMeanAtMs', 'endReason', 'lostStars']) {
      expect(SIM_HELP).toContain(word);
    }
  });

  it('answers --help without a bot', () => {
    const parsed = parseSimArgs(['--help']);
    expect(parsed.ok && parsed.value.help).toBe(true);
    for (const flag of [
      '--level',
      '--bot',
      '--seed',
      '--runs',
      '--until-ms',
      '--out',
      '--journals',
    ]) {
      expect(SIM_HELP).toContain(flag);
    }
  });
});
