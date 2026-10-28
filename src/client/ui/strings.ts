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

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** `text|name` pairs already warned about: a screen rebuilt each frame must not flood the log. */
const reportedPlaceholders = new Set<string>();

/**
 * Fills the `{name}` placeholders of a translated `text` (`« {count} étoiles sur {max} »`). A
 * placeholder with no value is a bug in the caller: it warns once per text and name and stays in
 * the text as it is, so the problem shows instead of an empty hole.
 */
export function formatString(
  text: string,
  values: Readonly<Record<string, string | number>>,
  logger: Pick<Logger, 'warn'> = log,
): string {
  return text.replace(PLACEHOLDER, (placeholder, name: string) => {
    // `hasOwn`: `{constructor}` is no value.
    if (Object.hasOwn(values, name)) return String(values[name]);
    const key = `${text}|${name}`;
    if (!reportedPlaceholders.has(key)) {
      reportedPlaceholders.add(key);
      logger.warn('boot', `no value for the placeholder {${name}}`, { text });
    }
    return placeholder;
  });
}
