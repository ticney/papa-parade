import type { InvariantContext, InvariantViolation } from '@shared/invariant';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { consumeFreeze, createFreezeState, requestFreeze } from './hitstop.ts';

function context(strictInvariants: boolean): InvariantContext & { events: InvariantViolation[] } {
  return { strictInvariants, t: asSimMs(0), events: [] };
}

describe('hitstop freeze state', () => {
  it('keeps the longest of overlapping requests', () => {
    const state = createFreezeState();
    const ctx = context(true);
    requestFreeze(state, ctx, 80);
    requestFreeze(state, ctx, 30);
    expect(state.remainingMs).toBe(80);
    requestFreeze(state, ctx, 120);
    expect(state.remainingMs).toBe(120);
  });

  it('consumes real time down to zero, never below', () => {
    const state = createFreezeState();
    requestFreeze(state, context(true), 80);
    consumeFreeze(state, 30);
    expect(state.remainingMs).toBe(50);
    consumeFreeze(state, 500);
    expect(state.remainingMs).toBe(0);
  });

  it('ignores a non-positive or NaN consumption', () => {
    const state = createFreezeState();
    requestFreeze(state, context(true), 80);
    consumeFreeze(state, -5);
    consumeFreeze(state, Number.NaN);
    consumeFreeze(state, 0);
    expect(state.remainingMs).toBe(80);
  });

  it('rejects a bad request: throws when strict, reports and ignores otherwise', () => {
    const strict = createFreezeState();
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => requestFreeze(strict, context(true), ms)).toThrow();
    }
    const lenient = createFreezeState();
    const ctx = context(false);
    requestFreeze(lenient, ctx, Number.NaN);
    requestFreeze(lenient, ctx, -4);
    requestFreeze(lenient, ctx, Number.POSITIVE_INFINITY);
    expect(lenient.remainingMs).toBe(0);
    expect(ctx.events).toHaveLength(3);
    consumeFreeze(lenient, 1e12);
    expect(lenient.remainingMs).toBe(0);
  });
});
