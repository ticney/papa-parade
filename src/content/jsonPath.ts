const PLAIN_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * `['timing', 'windowMs']` → `timing.windowMs`; `['mama', 'starThresholdPoints', 2]` →
 * `mama.starThresholdPoints[2]`; a key that is not a plain identifier (string keys contain dots)
 * is bracketed and quoted: `["start.tap_to_start"]`.
 */
export function formatJsonPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
      continue;
    }
    const key = String(segment);
    if (PLAIN_IDENTIFIER.test(key)) out += out === '' ? key : `.${key}`;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out;
}
