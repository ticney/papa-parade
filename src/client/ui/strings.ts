import { type Logger, log } from '@shared/log';

/** Looks a player-facing string up by key. */
export type Translator = (key: string) => string;

/**
 * `t(key)`: reads the validated strings of the content bundle. A key the file lacks is a bug in the
 * caller, not a reason to crash a level: it warns once per key and shows the key itself (never an
 * empty string, which would hide the problem). The architecture test scans the sources for such
 * keys, so this is the last line of defence.
 */
export function createTranslator(
  strings: Readonly<Record<string, string>>,
  logger: Pick<Logger, 'warn'> = log,
): Translator {
  const reported = new Set<string>();
  return (key) => {
    // `hasOwn`: `strings['constructor']` is the Object constructor, not a missing key.
    const text = Object.hasOwn(strings, key) ? strings[key] : undefined;
    if (text !== undefined) return text;
    if (!reported.has(key)) {
      reported.add(key);
      logger.warn('boot', `missing string key "${key}"`);
    }
    return key;
  };
}
