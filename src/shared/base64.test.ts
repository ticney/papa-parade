import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64.ts';
import { createRng, nextUint32 } from './rng.ts';

const utf8 = (text: string) => new TextEncoder().encode(text);

function randomBytes(count: number, seed: number): Uint8Array {
  const rng = createRng(seed);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = nextUint32(rng) & 255;
  return bytes;
}

describe('encodeBase64', () => {
  it('matches the RFC 4648 test vectors', () => {
    expect(encodeBase64(utf8(''))).toBe('');
    expect(encodeBase64(utf8('f'))).toBe('Zg==');
    expect(encodeBase64(utf8('fo'))).toBe('Zm8=');
    expect(encodeBase64(utf8('foo'))).toBe('Zm9v');
    expect(encodeBase64(utf8('foob'))).toBe('Zm9vYg==');
    expect(encodeBase64(utf8('fooba'))).toBe('Zm9vYmE=');
    expect(encodeBase64(utf8('foobar'))).toBe('Zm9vYmFy');
  });

  it('uses + and / for 62 and 63', () => {
    expect(encodeBase64(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('+/+/');
  });
});

describe('decodeBase64', () => {
  it.each([0, 1, 2, 3, 4096])('round-trips %i random bytes', (count) => {
    const bytes = randomBytes(count, count + 1);
    const decoded = decodeBase64(encodeBase64(bytes));
    expect(decoded).toEqual({ ok: true, value: bytes });
  });

  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(decodeBase64(encodeBase64(bytes))).toEqual({ ok: true, value: bytes });
  });

  it.each([
    ['a length that is not a multiple of 4', 'Zm9'],
    ['a character outside the alphabet', 'Zm9*'],
    ['a url-safe character', 'Zm9-'],
    ['padding in the middle', 'Zg==Zm9v'],
    ['padding before the end of a group', 'Z=9v'],
    ['three padding characters', 'Z==='],
    ['non-zero bits in the padding (2)', 'Zh=='],
    ['non-zero bits in the padding (1)', 'Zm9='],
    ['a space inside a group', 'Zm 9'],
    ['a newline at the end of a group', 'Zm9\n'],
  ])('refuses %s', (_name, text) => {
    expect(decodeBase64(text).ok).toBe(false);
  });
});
