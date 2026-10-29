import { log } from '@shared/log';
import { beforeAll, describe, expect, it } from 'vitest';
import { guarded } from './guard.ts';

beforeAll(() => {
  log.setLevel('error');
});

describe('guarded', () => {
  it('passes the arguments through', () => {
    const seen: number[] = [];
    guarded('probe', (a: number, b: number) => seen.push(a, b))(1, 2);
    expect(seen).toEqual([1, 2]);
  });

  it('swallows a throw and logs it as a warning that names the listener', () => {
    const cause = new Error('boom');
    expect(() =>
      guarded('guard probe listener', () => {
        throw cause;
      })(),
    ).not.toThrow();
    const entry = log
      .buffer()
      .reverse()
      .find((candidate) => candidate.message === 'guard probe listener failed');
    expect(entry?.level).toBe('warn');
    expect(entry?.channel).toBe('debug');
    expect(entry?.data).toBe(cause);
  });
});
