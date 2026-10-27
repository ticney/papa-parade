import type { LogChannel } from '@shared/log';
import { describe, expect, it } from 'vitest';
import { type GlobalErrorTarget, installGlobalErrorHandlers } from './globalErrorHandlers.ts';

interface Logged {
  channel: LogChannel;
  message: string;
  data: unknown;
}

function setup() {
  const listeners = new Map<string, (event: never) => void>();
  const target: GlobalErrorTarget = {
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type: string, listener: (event: never) => void) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const logged: Logged[] = [];
  const logger = {
    error: (channel: LogChannel, message: string, data?: unknown) => {
      logged.push({ channel, message, data });
    },
  };
  const fire = (type: string, event: object): void => {
    const listener = listeners.get(type);
    if (listener === undefined) throw new Error(`no ${type} listener installed`);
    listener(event as never);
  };
  return { target, logger, logged, listeners, fire };
}

describe('installGlobalErrorHandlers', () => {
  it('listens to error and unhandledrejection', () => {
    const { target, logger, listeners } = setup();
    installGlobalErrorHandlers(target, logger);
    expect([...listeners.keys()].sort()).toEqual(['error', 'unhandledrejection']);
  });

  it('logs an uncaught error at error level on the boot channel, with message, file and line', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    const cause = new Error('boom');
    fire('error', {
      message: 'Uncaught Error: boom',
      filename: 'main.js',
      lineno: 12,
      colno: 5,
      error: cause,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]?.channel).toBe('boot');
    expect(logged[0]?.message).toContain('Uncaught Error: boom');
    expect(logged[0]?.data).toMatchObject({ file: 'main.js', line: 12, column: 5, error: cause });
  });

  it('logs an uncaught error that carries no file or line', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    fire('error', { message: 'Script error.' });
    expect(logged).toHaveLength(1);
    expect(logged[0]?.message).toContain('Script error.');
    expect(logged[0]?.data).not.toHaveProperty('file');
    expect(logged[0]?.data).not.toHaveProperty('line');
  });

  it('falls back to the thrown value when the error event has no message', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    fire('error', { error: new Error('from the error object') });
    expect(logged[0]?.message).toContain('from the error object');
  });

  it('says "unknown error" when the error event carries neither a message nor an error', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    fire('error', {});
    fire('error', { message: '', error: null });
    expect(logged).toHaveLength(2);
    expect(logged[0]?.message).toContain('unknown error');
    expect(logged[1]?.message).toContain('unknown error');
  });

  it('still logs a rejection whose reason cannot be turned into a string', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    const noPrototype = Object.create(null) as object;
    const throwingToString = {
      toString() {
        throw new Error('no string for you');
      },
    };
    expect(() => {
      fire('unhandledrejection', { reason: noPrototype });
      fire('unhandledrejection', { reason: throwingToString });
      fire('error', { error: throwingToString });
    }).not.toThrow();
    expect(logged).toHaveLength(3);
    expect(logged[0]?.message).toContain('unprintable');
    expect(logged[0]?.data).toMatchObject({ reason: noPrototype });
    expect(logged[2]?.message).toContain('unprintable');
  });

  it('logs an unhandled rejection with its Error reason', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    const reason = new Error('nope');
    fire('unhandledrejection', { reason });
    expect(logged).toHaveLength(1);
    expect(logged[0]?.channel).toBe('boot');
    expect(logged[0]?.message).toContain('nope');
    expect(logged[0]?.data).toMatchObject({ reason });
  });

  it('logs an unhandled rejection whose reason is not an Error', () => {
    const { target, logger, logged, fire } = setup();
    installGlobalErrorHandlers(target, logger);
    fire('unhandledrejection', { reason: 'plain string' });
    fire('unhandledrejection', { reason: undefined });
    expect(logged).toHaveLength(2);
    expect(logged[0]?.message).toContain('plain string');
  });

  it('removes both listeners when uninstalled', () => {
    const { target, logger, listeners } = setup();
    const uninstall = installGlobalErrorHandlers(target, logger);
    uninstall();
    expect(listeners.size).toBe(0);
  });
});
