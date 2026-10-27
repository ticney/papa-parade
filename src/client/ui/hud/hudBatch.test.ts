import { describe, expect, it } from 'vitest';
import { createHudBatch } from './hudBatch.ts';

function setup(slots = 2) {
  const writes: Array<[number, number]> = [];
  const writers = Array.from({ length: slots }, (_, slot) => (value: number) => {
    writes.push([slot, value]);
  });
  return { batch: createHudBatch(writers), writes };
}

describe('createHudBatch', () => {
  it('writes nothing until flush, then each changed slot once', () => {
    const { batch, writes } = setup();
    batch.set(0, 1);
    batch.set(1, 5);
    expect(writes).toEqual([]);
    batch.flush();
    expect(writes).toEqual([
      [0, 1],
      [1, 5],
    ]);
  });

  it('writes a slot once even when it is set several times in a frame, with the last value', () => {
    const { batch, writes } = setup();
    batch.set(0, 1);
    batch.set(0, 2);
    batch.set(0, 3);
    batch.flush();
    expect(writes).toEqual([[0, 3]]);
  });

  it('does not write a value that did not change', () => {
    const { batch, writes } = setup();
    batch.set(0, 4);
    batch.flush();
    batch.set(0, 4);
    batch.flush();
    expect(writes).toEqual([[0, 4]]);
  });

  it('does not write when a slot goes away and comes back within one frame', () => {
    const { batch, writes } = setup();
    batch.set(0, 4);
    batch.flush();
    batch.set(0, 9);
    batch.set(0, 4);
    batch.flush();
    expect(writes).toEqual([[0, 4]]);
  });

  it('writes 0 the first time (the first value is never "unchanged")', () => {
    const { batch, writes } = setup();
    batch.set(1, 0);
    batch.flush();
    expect(writes).toEqual([[1, 0]]);
  });

  it('does nothing on a flush with nothing to write', () => {
    const { batch, writes } = setup();
    batch.flush();
    batch.flush();
    expect(writes).toEqual([]);
  });

  it('rejects a slot out of range and a value that is not a finite number', () => {
    const { batch } = setup();
    expect(() => batch.set(2, 1)).toThrow(/out of range/);
    expect(() => batch.set(-1, 1)).toThrow(/out of range/);
    expect(() => batch.set(0.5, 1)).toThrow(/out of range/);
    expect(() => batch.set(0, Number.NaN)).toThrow(/hudBatch/);
    expect(() => batch.set(0, Number.POSITIVE_INFINITY)).toThrow(/hudBatch/);
  });
});
