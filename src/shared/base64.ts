import { err, ok, type Result } from './result.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

/** Standard base64 (RFC 4648, with `=` padding) of `bytes`. Pure: no `btoa`, no `Buffer`. */
export function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    text += ALPHABET[(word >> 18) & 63];
    text += ALPHABET[(word >> 12) & 63];
    text += b === undefined ? '=' : ALPHABET[(word >> 6) & 63];
    text += c === undefined ? '=' : ALPHABET[word & 63];
  }
  return text;
}

/**
 * The bytes of a base64 `text` written by {@link encodeBase64}: canonical only (length a multiple
 * of 4, padding only at the end, and zero bits in the padding), so that a damaged or hand-edited
 * snapshot is refused instead of read loosely.
 */
export function decodeBase64(text: string): Result<Uint8Array, string> {
  if (text.length % 4 !== 0) return err('the length is not a multiple of 4');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      const char = text[i + j] as string;
      const isPadding = char === '=' && i + j >= text.length - padding;
      const value = isPadding ? 0 : LOOKUP.get(char);
      if (value === undefined) return err(`unexpected character at ${i + j}`);
      word = (word << 6) | value;
    }
    if (at < bytes.length) bytes[at++] = (word >> 16) & 255;
    if (at < bytes.length) bytes[at++] = (word >> 8) & 255;
    if (at < bytes.length) bytes[at++] = word & 255;
    // The unused low bits of a padded group must be zero, or two texts would decode to one value.
    const isLast = i + 4 === text.length;
    if (isLast && padding === 2 && (word & 0xffff) !== 0) return err('non-zero padding bits');
    if (isLast && padding === 1 && (word & 0xff) !== 0) return err('non-zero padding bits');
  }
  return ok(bytes);
}
