import { type AppError, err, ok, type Result } from '@shared/result';
import type { AudioBufferLike } from '../audio/webAudio.ts';

export interface LoadClipDeps {
  /** The bytes of a file; rejects on a network error, a non-2xx status or a timeout. */
  fetchBytes(url: string): Promise<Uint8Array>;
  /** Decodes a copy of the bytes; rejects when the browser cannot. */
  decode(data: ArrayBuffer): Promise<AudioBufferLike>;
  /** `import.meta.env.BASE_URL` (`./` in builds, `/` in dev). Never write `/assets/…`. */
  baseUrl: string;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const fail = (clip: string, reason: string, cause?: unknown): Result<never, AppError> =>
  err({ kind: 'audio', message: `${clip}.m4a: ${reason}`, cause });

/** Whether an MP4 file's first box is `ftyp` (bytes 4 to 7): its head is the only cheap proof. */
export function hasFtypBox(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 // p
  );
}

/**
 * Fetches `public/assets/audio/<clip>.m4a` and decodes it. Never throws: a failed fetch, a body
 * that is not an MP4 (a single-page fallback answers a missing file with HTML and a 200) and a
 * decode that rejects are each an `err` whose message names the file. The caller logs the `warn`.
 */
export async function loadAudioClip(
  clip: string,
  deps: LoadClipDeps,
): Promise<Result<AudioBufferLike, AppError>> {
  let bytes: Uint8Array;
  try {
    bytes = await deps.fetchBytes(`${deps.baseUrl}assets/audio/${clip}.m4a`);
  } catch (cause) {
    return fail(clip, `cannot fetch: ${reasonOf(cause)}`, cause);
  }
  if (!hasFtypBox(bytes)) return fail(clip, 'not an MP4 audio file (no ftyp box)');
  try {
    // Decoding detaches the buffer it is given: hand it a copy of exactly the file's bytes.
    return ok(await deps.decode(bytes.slice().buffer as ArrayBuffer));
  } catch (cause) {
    return fail(clip, `cannot decode: ${reasonOf(cause)}`, cause);
  }
}
