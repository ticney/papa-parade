import { describe, expect, it } from 'vitest';
import { createEmitter } from './emitter.ts';

interface TestEvents {
  Ping: { n: number };
  Pong: { label: string };
  Empty: Record<string, never>;
}

describe('createEmitter', () => {
  it('runs the listeners of a type in subscription order', () => {
    const emitter = createEmitter<TestEvents>();
    const order: string[] = [];
    emitter.on('Ping', () => order.push('first'));
    emitter.on('Ping', () => order.push('second'));
    emitter.on('Ping', () => order.push('third'));
    emitter.emit('Ping', { n: 1 });
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('hands the payload to the listeners and only to the listeners of that type', () => {
    const emitter = createEmitter<TestEvents>();
    const pings: number[] = [];
    const pongs: string[] = [];
    emitter.on('Ping', (payload) => pings.push(payload.n));
    emitter.on('Pong', (payload) => pongs.push(payload.label));
    emitter.emit('Ping', { n: 7 });
    emitter.emit('Pong', { label: 'x' });
    expect(pings).toEqual([7]);
    expect(pongs).toEqual(['x']);
  });

  it('stops calling a listener once it is unsubscribed, and unsubscribing twice is harmless', () => {
    const emitter = createEmitter<TestEvents>();
    const calls: number[] = [];
    const off = emitter.on('Ping', (payload) => calls.push(payload.n));
    emitter.emit('Ping', { n: 1 });
    off();
    off();
    emitter.emit('Ping', { n: 2 });
    expect(calls).toEqual([1]);
  });

  it('survives a listener that unsubscribes itself during an emit', () => {
    const emitter = createEmitter<TestEvents>();
    const order: string[] = [];
    const offSelf = emitter.on('Ping', () => {
      order.push('self');
      offSelf();
    });
    emitter.on('Ping', () => order.push('after'));
    emitter.emit('Ping', { n: 1 });
    emitter.emit('Ping', { n: 2 });
    expect(order).toEqual(['self', 'after', 'after']);
  });

  it('does not call a listener that an earlier listener unsubscribed during the same emit', () => {
    const emitter = createEmitter<TestEvents>();
    const order: string[] = [];
    let offLater = (): void => {};
    emitter.on('Ping', () => {
      order.push('first');
      offLater();
    });
    offLater = emitter.on('Ping', () => order.push('later'));
    emitter.on('Ping', () => order.push('last'));
    emitter.emit('Ping', { n: 1 });
    expect(order).toEqual(['first', 'last']);
  });

  it('does not call a listener added during an emit before the next emit', () => {
    const emitter = createEmitter<TestEvents>();
    const order: string[] = [];
    emitter.on('Ping', () => {
      order.push('outer');
      emitter.on('Ping', () => order.push('added'));
    });
    emitter.emit('Ping', { n: 1 });
    expect(order).toEqual(['outer']);
    order.length = 0;
    // The listener added during the first emit is called now; the one this emit adds is not.
    emitter.emit('Ping', { n: 2 });
    expect(order).toEqual(['outer', 'added']);
  });

  it('is fine to emit a type nobody listens to', () => {
    const emitter = createEmitter<TestEvents>();
    expect(() => emitter.emit('Empty', {})).not.toThrow();
  });

  it('keeps two emitters independent', () => {
    const a = createEmitter<TestEvents>();
    const b = createEmitter<TestEvents>();
    const seen: string[] = [];
    a.on('Ping', () => seen.push('a'));
    b.on('Ping', () => seen.push('b'));
    a.emit('Ping', { n: 1 });
    expect(seen).toEqual(['a']);
  });

  it('rejects an unknown event type at compile time', () => {
    const emitter = createEmitter<TestEvents>();
    // @ts-expect-error 'Nope' is not a key of TestEvents
    emitter.on('Nope', () => {});
    // @ts-expect-error the payload must match the type
    emitter.emit('Ping', { label: 'wrong' });
    expect(true).toBe(true);
  });
});
