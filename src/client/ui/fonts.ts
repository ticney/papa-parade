import { FONT_LOAD_TIMEOUT_MS } from '@shared/constants';
import { type Logger, log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';

/**
 * One load request per family, in the weights the screens use. Baloo 2 and Nunito are preloaded
 * from index.html; Anton is not (it is unused until the Epic register, and Chromium warns about a
 * preloaded font nothing uses), so it is warmed here.
 */
export const FONT_LOADS = ['800 56px "Baloo 2"', '800 16px "Nunito"', '400 64px "Anton"'] as const;

/** The slice of `document.fonts` the loader needs. */
export interface FontSetLike {
  load(font: string): Promise<readonly unknown[]>;
}

export interface LoadFontsOptions {
  logger?: Pick<Logger, 'warn'>;
  /** How long to wait before giving up, in ms. Default: `FONT_LOAD_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Resolves after the given ms. Default: a `setTimeout`. Tests pass their own. */
  wait?: (ms: number) => Promise<void>;
}

const waitMs = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Waits for the three families, so the start screen never flashes a fallback font, but never longer
 * than `FONT_LOAD_TIMEOUT_MS`: a font request that stalls must not leave the player a blank page. A
 * family that cannot be loaded (or a timeout) is not fatal: the CSS stacks end in system fonts, so
 * it logs a `warn` and the game goes on with the fallback.
 */
export async function loadFonts(
  fontSet: FontSetLike,
  options: LoadFontsOptions = {},
): Promise<Result<void, AppError>> {
  const logger = options.logger ?? log;
  const timeoutMs = options.timeoutMs ?? FONT_LOAD_TIMEOUT_MS;
  const wait = options.wait ?? waitMs;
  const failures: string[] = [];

  const loads = Promise.all(
    FONT_LOADS.map(async (font) => {
      try {
        const faces = await fontSet.load(font);
        if (faces.length === 0) failures.push(`${font}: no matching @font-face`);
      } catch (cause) {
        failures.push(`${font}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }),
  ).then(() => 'loaded' as const);
  const outcome = await Promise.race([loads, wait(timeoutMs).then(() => 'timeout' as const)]);
  if (outcome === 'timeout') failures.push(`still loading after ${timeoutMs} ms`);

  if (failures.length === 0) return ok(undefined);
  const error: AppError = {
    kind: 'assets',
    message: `cannot load ${failures.length} font problem(s): falling back to system fonts`,
    cause: failures,
  };
  logger.warn('assets', error.message, failures);
  return err(error);
}
