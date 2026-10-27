import { type Logger, log } from '@shared/log';

/** The fields of an `ErrorEvent` that are logged. */
export interface ErrorEventLike {
  readonly message?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly error?: unknown;
}

/** The field of a `PromiseRejectionEvent` that is logged. */
export interface RejectionEventLike {
  readonly reason?: unknown;
}

/** The slice of `window` the hook needs (a structural type, so tests need no DOM). */
export interface GlobalErrorTarget {
  addEventListener(type: 'error', listener: (event: ErrorEventLike) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (event: RejectionEventLike) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEventLike) => void): void;
  removeEventListener(
    type: 'unhandledrejection',
    listener: (event: RejectionEventLike) => void,
  ): void;
}

function describeThrown(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    // `String(Object.create(null))` or a throwing `toString` must not swallow the error being
    // reported: the raw value still goes in the log data.
    return '[unprintable value]';
  }
}

/**
 * Feeds every uncaught error and unhandled promise rejection to `log.error`, so that they reach
 * the ring buffer on a phone too. Logging only: the player-facing « Oups » screen is story 1.6.
 * Returns the function that removes the listeners.
 */
export function installGlobalErrorHandlers(
  target: GlobalErrorTarget,
  logger: Pick<Logger, 'error'> = log,
): () => void {
  const onError = (event: ErrorEventLike): void => {
    const hasError = event.error !== undefined && event.error !== null;
    const message = event.message || (hasError ? describeThrown(event.error) : 'unknown error');
    const data: Record<string, unknown> = { error: event.error };
    if (event.filename) {
      data.file = event.filename;
      data.line = event.lineno;
      data.column = event.colno;
    }
    logger.error('boot', `uncaught error: ${message}`, data);
  };
  const onRejection = (event: RejectionEventLike): void => {
    logger.error('boot', `unhandled promise rejection: ${describeThrown(event.reason)}`, {
      reason: event.reason,
    });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
