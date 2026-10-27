import { asSimMs } from '@shared/time';
import type { SimCommand } from '@sim';
import { describe, expect, it } from 'vitest';
import { createCommandScheduler } from './commandScheduler.ts';

const release = (t: number): SimCommand => ({ type: 'Release', t: asSimMs(t) });
const stop = (t: number): SimCommand => ({ type: 'MoveStop', t: asSimMs(t) });

describe('createCommandScheduler', () => {
  it('hands over a command in the step that holds its t, not before', () => {
    const scheduler = createCommandScheduler();
    scheduler.schedule(release(35));
    const out: SimCommand[] = [];
    scheduler.flush(10, out);
    scheduler.flush(20, out);
    expect(out).toEqual([]);
    expect(scheduler.size).toBe(1);
    scheduler.flush(30, out);
    expect(out).toEqual([release(35)]);
    expect(scheduler.size).toBe(0);
  });

  it('orders what is due by t, and keeps the planned order on a tie', () => {
    const scheduler = createCommandScheduler();
    scheduler.schedule(release(15));
    scheduler.schedule(stop(12));
    scheduler.schedule(stop(15));
    scheduler.schedule(release(40));
    const out: SimCommand[] = [];
    scheduler.flush(10, out);
    expect(out).toEqual([stop(12), release(15), stop(15)]);
    expect(scheduler.size).toBe(1);
  });

  it('puts what is due after what is already in out, without reordering that', () => {
    const scheduler = createCommandScheduler();
    scheduler.schedule(release(11));
    const out: SimCommand[] = [stop(19)];
    scheduler.flush(10, out);
    expect(out).toEqual([stop(19), release(11)]);
  });

  it('moves a command planned in the past to now', () => {
    const scheduler = createCommandScheduler();
    scheduler.schedule(release(3));
    const out: SimCommand[] = [];
    scheduler.flush(10, out);
    expect(out).toEqual([release(10)]);
  });
});
