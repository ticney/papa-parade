import { LOG_BUFFER_SIZE } from '@shared/constants';
import { createConsoleSink, createLogger, type LogEntry, type LogLevel } from '@shared/log';
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

  it('does not buffer entries filtered out by the level threshold', () => {
    const { logger } = setup('error');
    logger.info('boot', 'filtered out');
    expect(logger.buffer()).toEqual([]);
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

  it('still buffers when the console sink is disabled', () => {
    const logger = createLogger({ level: 'info', sink: null });
    logger.info('boot', 'quiet');
    expect(logger.buffer()).toHaveLength(1);
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
