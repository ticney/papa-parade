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
  /** Console threshold. Defaults to `debug` in dev and `info` otherwise. */
  level?: LogLevel;
  /** Where entries go besides the ring buffer. `null` silences it. Defaults to the console in dev. */
  sink?: LogSink | null;
  /** Real-time clock for `atReal`. */
  now?: () => number;
  bufferSize?: number;
}

type ConsoleLike = Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

// `import.meta.env` is undefined under Node/tsx, where tools should still print.
const isDev = import.meta.env?.DEV !== false;

export function createConsoleSink(target: ConsoleLike = console): LogSink {
  return (entry) => {
    const label = `[${entry.channel}] ${entry.message}`;
    if (entry.data === undefined) target[entry.level](label);
    else target[entry.level](label, entry.data);
  };
}

export interface Logger {
  error(channel: LogChannel, message: string, data?: unknown): void;
  warn(channel: LogChannel, message: string, data?: unknown): void;
  info(channel: LogChannel, message: string, data?: unknown): void;
  debug(channel: LogChannel, message: string, data?: unknown): void;
  enabled(level: LogLevel): boolean;
  setLevel(level: LogLevel): void;
  /** Last entries of level `info` and above, oldest first (a copy). */
  buffer(): LogEntry[];
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const capacity = options.bufferSize ?? LOG_BUFFER_SIZE;
  const sink = options.sink === undefined ? (isDev ? createConsoleSink() : null) : options.sink;
  const now = options.now ?? (() => performance.now());
  let threshold = LEVEL_RANK[options.level ?? (isDev ? 'debug' : 'info')];

  const ring = new Array<LogEntry | undefined>(capacity);
  let next = 0;
  let count = 0;

  function write(level: LogLevel, channel: LogChannel, message: string, data: unknown): void {
    // Check before building anything: a filtered-out call must not allocate.
    if (LEVEL_RANK[level] > threshold) return;
    const entry: LogEntry =
      data === undefined
        ? { atReal: now(), level, channel, message }
        : { atReal: now(), level, channel, message, data };
    if (level !== 'debug') {
      ring[next] = entry;
      next = (next + 1) % capacity;
      if (count < capacity) count++;
    }
    sink?.(entry);
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
        entries.push(ring[(start + i) % capacity] as LogEntry);
      }
      return entries;
    },
  };
}

export const log: Logger = createLogger();
