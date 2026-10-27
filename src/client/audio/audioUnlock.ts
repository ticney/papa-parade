import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import type { AudioContextLike } from './webAudio.ts';

/** The silent buffer that unlocks iOS: one sample, at this rate, in Hz. */
const SILENT_BUFFER_LENGTH = 1;
const SILENT_BUFFER_RATE_HZ = 22_050;

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Creates the context and unlocks it. It must run **synchronously inside the user gesture's
 * handler** (iOS only honours it there): the context is created, `resume()` is called (its promise
 * is caught, not awaited) and one silent buffer is started, the classic iOS unlock. A browser
 * without Web Audio, or a constructor that throws, is an `err` (the caller logs the `warn`): the
 * game goes on, silent.
 */
export function unlockAudioContext(
  createContext: () => AudioContextLike,
): Result<AudioContextLike, AppError> {
  let context: AudioContextLike;
  try {
    context = createContext();
  } catch (cause) {
    return err({
      kind: 'audio',
      message: `audio unlock failed: ${reasonOf(cause)}`,
      cause,
    });
  }
  try {
    void context.resume().catch((cause: unknown) => {
      log.warn('audio', `audio resume failed: ${reasonOf(cause)}`);
    });
  } catch (cause) {
    log.warn('audio', `audio resume failed: ${reasonOf(cause)}`);
  }
  try {
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, SILENT_BUFFER_LENGTH, SILENT_BUFFER_RATE_HZ);
    source.connect(context.destination);
    source.start(0);
  } catch (cause) {
    log.warn('audio', `audio silent unlock buffer failed: ${reasonOf(cause)}`);
  }
  return ok(context);
}
