import { LOG_BUFFER_SIZE } from './constants.ts';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type LogChannel =
  | 'boot'
  | 'assets'
  | 'audio'
  | 'input'
  | 'render'
  | 'feedback'
  | 'storage'
  | 'platform'
  | 'debug'
  | 'content'
  | 'sim';

export interface LogEntry {
  atReal: number;
  level: LogLevel;
  channel: LogChannel;
  message: string;
  data?: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export interface LoggerOptions {
  /**
   * Sink threshold (console output). Defaults to `debug` in dev and `info` otherwise. It does not
   * affect the ring buffer, which always keeps `info` and above.
   */
  level?: LogLevel;
  /**
   * Where entries go besides the ring buffer. `null` silences it. Defaults to the console in dev,
   * and to `warn` and `error` on the console when `VITE_DEBUG_ALLOWED` is `true` (playtest build).
   */
  sink?: LogSink | null;
  /** Real-time clock for `atReal`. */
  now?: () => number;
  bufferSize?: number;
}

type ConsoleLike = Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

// `import.meta.env` is undefined under Node/tsx, where tools should still print.
const isDev = import.meta.env?.DEV !== false;

/** The slice of `import.meta.env` that the logger reads. */
export interface LogEnv {
  DEV?: boolean;
  VITE_DEBUG_ALLOWED?: string;
}

/** Console sink. Entries more verbose than `maxLevel` are dropped. */
export function createConsoleSink(
  target: ConsoleLike = console,
  maxLevel: LogLevel = 'debug',
): LogSink {
  const limit = LEVEL_RANK[maxLevel];
  return (entry) => {
    if (LEVEL_RANK[entry.level] > limit) return;
    const label = `[${entry.channel}] ${entry.message}`;
    if (entry.data === undefined) target[entry.level](label);
    else target[entry.level](label, entry.data);
  };
}

/**
 * The sink used when `createLogger` gets no `sink` option: the whole console in dev (`DEV` is also
 * true when there is no Vite env, as under Node/tsx), `warn` and `error` only in a playtest build
 * (`VITE_DEBUG_ALLOWED=true`), none in production.
 */
export function createDefaultSink(env: LogEnv | undefined, target?: ConsoleLike): LogSink | null {
  if (env?.DEV !== false) return createConsoleSink(target);
  if (env?.VITE_DEBUG_ALLOWED === 'true') return createConsoleSink(target, 'warn');
  return null;
}

export interface Logger {
  error(channel: LogChannel, message: string, data?: unknown): void;
  warn(channel: LogChannel, message: string, data?: unknown): void;
  info(channel: LogChannel, message: string, data?: unknown): void;
  debug(channel: LogChannel, message: string, data?: unknown): void;
  enabled(level: LogLevel): boolean;
  setLevel(level: LogLevel): void;
  /**
   * Last entries of level `info` and above, oldest first (copies). `data` is kept by reference:
   * do not mutate an object after logging it.
   */
  buffer(): LogEntry[];
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const requestedSize = options.bufferSize ?? LOG_BUFFER_SIZE;
  const capacity = Number.isFinite(requestedSize)
    ? Math.max(1, Math.floor(requestedSize))
    : LOG_BUFFER_SIZE;
  const sink = options.sink === undefined ? createDefaultSink(import.meta.env) : options.sink;
  const now = options.now ?? (() => performance.now());
  let threshold = LEVEL_RANK[options.level ?? (isDev ? 'debug' : 'info')];

  const ring = new Array<LogEntry | undefined>(capacity);
  let next = 0;
  let count = 0;

  function write(level: LogLevel, channel: LogChannel, message: string, data: unknown): void {
    const buffered = level !== 'debug';
    const emitted = LEVEL_RANK[level] <= threshold;
    // Check before building anything: a call nobody wants must not allocate.
    if (!buffered && !emitted) return;
    const entry: LogEntry =
      data === undefined
        ? { atReal: now(), level, channel, message }
        : { atReal: now(), level, channel, message, data };
    if (buffered) {
      ring[next] = entry;
      next = (next + 1) % capacity;
      if (count < capacity) count++;
    }
    if (emitted) sink?.(entry);
  }

  return {
    error: (channel, message, data) => write('error', channel, message, data),
    warn: (channel, message, data) => write('warn', channel, message, data),
    info: (channel, message, data) => write('info', channel, message, data),
    debug: (channel, message, data) => write('debug', channel, message, data),
    enabled: (level) => LEVEL_RANK[level] <= threshold,
    setLevel: (level) => {
      threshold = LEVEL_RANK[level];
    },
    buffer: () => {
      const entries: LogEntry[] = [];
      const start = count < capacity ? 0 : next;
      for (let i = 0; i < count; i++) {
        entries.push({ ...(ring[(start + i) % capacity] as LogEntry) });
      }
      return entries;
    },
  };
}

export const log: Logger = createLogger();
