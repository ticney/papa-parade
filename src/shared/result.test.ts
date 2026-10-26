import { type AppError, err, ok, type Result } from '@shared/result';
import { describe, expect, it } from 'vitest';

function parsePositive(input: number): Result<number> {
  return input > 0 ? ok(input) : err({ kind: 'invalid', message: 'not positive' });
}

describe('Result', () => {
  it('ok() wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err() wraps an error', () => {
    const error: AppError = { kind: 'io', message: 'boom' };
    expect(err(error)).toEqual({ ok: false, error });
  });

  it('narrows on the `ok` discriminant', () => {
    const good = parsePositive(3);
    if (good.ok) {
      expect(good.value).toBe(3);
    } else {
      expect.unreachable('expected an ok result');
    }

    const bad = parsePositive(-1);
    if (!bad.ok) {
      expect(bad.error.kind).toBe('invalid');
    } else {
      expect.unreachable('expected an error result');
    }
  });

  it('keeps the optional cause of an AppError', () => {
    const cause = new Error('root');
    const result = err<AppError>({ kind: 'io', message: 'wrapped', cause });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.cause).toBe(cause);
  });

  it('accepts a custom error type', () => {
    const result: Result<string, 'missing'> = err('missing');
    expect(result).toEqual({ ok: false, error: 'missing' });
  });
});
