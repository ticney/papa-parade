import { LOG_BUFFER_SIZE } from '@shared/constants';
import {
  createConsoleSink,
  createDefaultSink,
  createLogger,
  type LogEntry,
  type LogLevel,
} from '@shared/log';
import { describe, expect, it } from 'vitest';

function setup(level: LogLevel = 'debug') {
  const sunk: LogEntry[] = [];
  let clock = 0;
  const logger = createLogger({ level, sink: (entry) => sunk.push(entry), now: () => clock++ });
  return { logger, sunk };
}

describe('createLogger', () => {
  it('filters by level (info threshold drops debug)', () => {
    const { logger, sunk } = setup('info');
    logger.debug('boot', 'hidden');
    logger.info('boot', 'shown');
    logger.warn('boot', 'warned');
    logger.error('boot', 'failed');
    expect(sunk.map((e) => e.level)).toEqual(['info', 'warn', 'error']);
  });

  it('error threshold keeps only errors', () => {
    const { logger, sunk } = setup('error');
    logger.warn('sim', 'nope');
    logger.error('sim', 'yes');
    expect(sunk.map((e) => e.message)).toEqual(['yes']);
  });

  it('enabled() reflects the threshold and setLevel() changes it', () => {
    const { logger } = setup('warn');
    expect(logger.enabled('error')).toBe(true);
    expect(logger.enabled('warn')).toBe(true);
    expect(logger.enabled('info')).toBe(false);
    expect(logger.enabled('debug')).toBe(false);
    logger.setLevel('debug');
    expect(logger.enabled('debug')).toBe(true);
  });

  it('builds entries with channel, message, data and a real-time stamp', () => {
    const { logger, sunk } = setup();
    logger.info('content', 'loaded', { count: 3 });
    expect(sunk).toEqual([
      { atReal: 0, level: 'info', channel: 'content', message: 'loaded', data: { count: 3 } },
    ]);
  });

  it('never buffers debug entries, even when debug is enabled', () => {
    const { logger, sunk } = setup('debug');
    logger.debug('render', 'frame');
    logger.info('render', 'ready');
    expect(sunk).toHaveLength(2);
    expect(logger.buffer().map((e) => e.message)).toEqual(['ready']);
  });

  it('buffers info and above whatever the sink threshold, but never reaches the sink below it', () => {
    const { logger, sunk } = setup('error');
    logger.debug('boot', 'dropped');
    logger.info('boot', 'kept');
    logger.warn('boot', 'kept too');
    expect(sunk).toEqual([]);
    expect(logger.buffer().map((e) => e.message)).toEqual(['kept', 'kept too']);
  });

  it('keeps buffering after the threshold is raised', () => {
    const { logger } = setup('debug');
    logger.setLevel('error');
    logger.warn('sim', 'still recorded');
    expect(logger.buffer().map((e) => e.message)).toEqual(['still recorded']);
  });

  it('clamps a nonsensical bufferSize instead of corrupting the ring', () => {
    for (const bufferSize of [0, -3, 1.9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const logger = createLogger({ level: 'info', sink: null, bufferSize });
      logger.info('boot', 'a');
      logger.info('boot', 'b');
      const messages = logger.buffer().map((e) => e.message);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[messages.length - 1]).toBe('b');
    }
    const one = createLogger({ level: 'info', sink: null, bufferSize: 0 });
    one.info('boot', 'a');
    one.info('boot', 'b');
    expect(one.buffer().map((e) => e.message)).toEqual(['b']);
  });

  it('keeps exactly the last 200 entries, oldest first, after 250 writes', () => {
    const { logger } = setup('info');
    expect(LOG_BUFFER_SIZE).toBe(200);
    for (let i = 0; i < 250; i++) logger.info('boot', `m${i}`);
    const entries = logger.buffer();
    expect(entries).toHaveLength(200);
    expect(entries[0]?.message).toBe('m50');
    expect(entries[199]?.message).toBe('m249');
    expect(entries.map((e) => e.message)).toEqual(
      Array.from({ length: 200 }, (_, i) => `m${i + 50}`),
    );
  });

  it('returns entries in order before the buffer wraps', () => {
    const { logger } = setup('info');
    logger.info('boot', 'a');
    logger.warn('boot', 'b');
    logger.error('boot', 'c');
    expect(logger.buffer().map((e) => e.message)).toEqual(['a', 'b', 'c']);
  });

  it('buffer() returns a copy', () => {
    const { logger } = setup('info');
    logger.info('boot', 'a');
    const copy = logger.buffer();
    copy.length = 0;
    expect(logger.buffer()).toHaveLength(1);
    logger.info('boot', 'b');
    expect(copy).toHaveLength(0);
  });

  it('buffer() returns copies of the entries', () => {
    const { logger } = setup('info');
    logger.info('boot', 'a');
    const [first] = logger.buffer();
    (first as LogEntry).message = 'tampered';
    expect(logger.buffer()[0]?.message).toBe('a');
  });

  it('still buffers when the console sink is disabled', () => {
    const logger = createLogger({ level: 'info', sink: null });
    logger.info('boot', 'quiet');
    expect(logger.buffer()).toHaveLength(1);
  });
});

describe('createDefaultSink', () => {
  function recordingConsole() {
    const calls: string[] = [];
    const record =
      (level: string) =>
      (...args: unknown[]) =>
        calls.push(`${level}:${args[0]}`);
    return {
      calls,
      target: {
        error: record('error'),
        warn: record('warn'),
        info: record('info'),
        debug: record('debug'),
      },
    };
  }
  const entry = (level: LogLevel): LogEntry => ({
    atReal: 0,
    level,
    channel: 'boot',
    message: 'm',
  });
  const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];

  it('prints everything in dev and when there is no Vite env (Node, tsx)', () => {
    for (const env of [{ DEV: true }, undefined, {}]) {
      const { calls, target } = recordingConsole();
      const sink = createDefaultSink(env, target);
      for (const level of levels) sink?.(entry(level));
      expect(calls).toHaveLength(4);
    }
  });

  it('prints only warn and error in a playtest build (VITE_DEBUG_ALLOWED=true)', () => {
    const { calls, target } = recordingConsole();
    const sink = createDefaultSink({ DEV: false, VITE_DEBUG_ALLOWED: 'true' }, target);
    for (const level of levels) sink?.(entry(level));
    expect(calls).toEqual(['error:[boot] m', 'warn:[boot] m']);
  });

  it('prints nothing in a production build', () => {
    expect(createDefaultSink({ DEV: false, VITE_DEBUG_ALLOWED: 'false' })).toBeNull();
    expect(createDefaultSink({ DEV: false })).toBeNull();
  });
});

describe('createConsoleSink', () => {
  it('routes each level to the matching console method', () => {
    const calls: string[] = [];
    const fake = {
      error: (...args: unknown[]) => calls.push(`error:${args.join('|')}`),
      warn: (...args: unknown[]) => calls.push(`warn:${args.join('|')}`),
      info: (...args: unknown[]) => calls.push(`info:${args.join('|')}`),
      debug: (...args: unknown[]) => calls.push(`debug:${args.join('|')}`),
    };
    const sink = createConsoleSink(fake);
    const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
    for (const level of levels) {
      sink({ atReal: 0, level, channel: 'boot', message: 'hello' });
    }
    expect(calls).toEqual([
      'error:[boot] hello',
      'warn:[boot] hello',
      'info:[boot] hello',
      'debug:[boot] hello',
    ]);
  });

  it('forwards the optional data as an extra argument', () => {
    const received: unknown[][] = [];
    const sink = createConsoleSink({
      error: () => {},
      warn: () => {},
      info: (...args: unknown[]) => received.push(args),
      debug: () => {},
    });
    sink({ atReal: 0, level: 'info', channel: 'sim', message: 'x', data: { a: 1 } });
    expect(received).toEqual([['[sim] x', { a: 1 }]]);
  });
});
