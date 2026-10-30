import { describe, expect, it } from 'vitest';
import { METRICS_HELP, parseMetricsArgs } from '../../../tools/playtest/metricsArgs.ts';

describe('parseMetricsArgs', () => {
  it('takes one folder and defaults everything else', () => {
    expect(parseMetricsArgs(['journals'])).toEqual({
      ok: true,
      value: {
        dir: 'journals',
        observationsPath: null,
        outPath: null,
        jsonPath: null,
        help: false,
      },
    });
  });

  it('reads every option', () => {
    expect(
      parseMetricsArgs(['--observations', 'n.csv', 'dir', '--out', 'r.md', '--json', 'r.json']),
    ).toEqual({
      ok: true,
      value: {
        dir: 'dir',
        observationsPath: 'n.csv',
        outPath: 'r.md',
        jsonPath: 'r.json',
        help: false,
      },
    });
  });

  it('does not need a folder for --help', () => {
    expect(parseMetricsArgs(['--help'])).toEqual({
      ok: true,
      value: { dir: null, observationsPath: null, outPath: null, jsonPath: null, help: true },
    });
    expect(METRICS_HELP).toContain('npm run playtest:metrics -- <dir>');
  });

  it('refuses a missing folder, pointing at --help', () => {
    expect(parseMetricsArgs([])).toEqual({
      ok: false,
      error:
        'the folder of tester journals is required: npm run playtest:metrics -- <dir> (see --help)',
    });
  });

  it('refuses two folders, naming them', () => {
    expect(parseMetricsArgs(['a', 'b'])).toEqual({
      ok: false,
      error: 'expected one folder, got 2: "a", "b" (see --help)',
    });
  });

  it('refuses an unknown flag, pointing at --help', () => {
    const parsed = parseMetricsArgs(['dir', '--csv', 'x']);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('--csv');
      expect(parsed.error).toContain('(see --help)');
    }
  });

  it('refuses a flag with no value and an empty path', () => {
    expect(parseMetricsArgs(['dir', '--out']).ok).toBe(false);
    expect(parseMetricsArgs(['dir', '--json', ''])).toEqual({
      ok: false,
      error: '--json needs a file path, got an empty string',
    });
    expect(parseMetricsArgs([''])).toEqual({
      ok: false,
      error: 'the folder of tester journals cannot be an empty string',
    });
  });
});
