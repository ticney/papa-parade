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

/**
 * Waits for the three families, so the start screen never flashes a fallback font. A family that
 * cannot be loaded is not fatal: the CSS stacks end in system fonts, so it logs a `warn` and the
 * game goes on with the fallback.
 */
export async function loadFonts(
  fontSet: FontSetLike,
  logger: Pick<Logger, 'warn'> = log,
): Promise<Result<void, AppError>> {
  const failures: string[] = [];
  await Promise.all(
    FONT_LOADS.map(async (font) => {
      try {
        const faces = await fontSet.load(font);
        if (faces.length === 0) failures.push(`${font}: no matching @font-face`);
      } catch (cause) {
        failures.push(`${font}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }),
  );
  if (failures.length === 0) return ok(undefined);
  const error: AppError = {
    kind: 'assets',
    message: `cannot load ${failures.length} font(s): falling back to system fonts`,
    cause: failures,
  };
  logger.warn('assets', error.message, failures);
  return err(error);
}
