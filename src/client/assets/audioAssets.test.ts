import { describe, expect, it } from 'vitest';
import { hasFtypBox, loadAudioClip } from './audioAssets.ts';

/** `\0\0\0\x18ftypM4A ` and some more bytes: the head of an `.m4a`. */
const M4A = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3,
]);
const HTML = new TextEncoder().encode('<!doctype html><html></html>');

const decodeTo = (duration: number) => (data: ArrayBuffer) => {
  expect(data.byteLength).toBeGreaterThan(0);
  return Promise.resolve({ duration });
};

describe('hasFtypBox', () => {
  it('looks at bytes 4 to 7', () => {
    expect(hasFtypBox(M4A)).toBe(true);
    expect(hasFtypBox(HTML)).toBe(false);
    expect(hasFtypBox(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(hasFtypBox(new Uint8Array())).toBe(false);
  });
});

describe('loadAudioClip', () => {
  it('fetches <baseUrl>assets/audio/<clip>.m4a and decodes it', async () => {
    const urls: string[] = [];
    const result = await loadAudioClip('papa_bump', {
      fetchBytes: (url) => {
        urls.push(url);
        return Promise.resolve(M4A);
      },
      decode: decodeTo(0.15),
      baseUrl: './',
    });
    expect(result).toMatchObject({ ok: true, value: { duration: 0.15 } });
    expect(urls).toEqual(['./assets/audio/papa_bump.m4a']);
  });

  it('hands the decoder a copy: the cached bytes are not detached', async () => {
    let handed: ArrayBuffer | null = null;
    await loadAudioClip('papa_bump', {
      fetchBytes: () => Promise.resolve(M4A),
      decode: (data) => {
        handed = data;
        return Promise.resolve({ duration: 1 });
      },
      baseUrl: './',
    });
    expect(handed).not.toBe(M4A.buffer);
    expect((handed as unknown as ArrayBuffer).byteLength).toBe(M4A.length);
  });

  it('is an err naming the file when the fetch rejects (a 404, a timeout)', async () => {
    const result = await loadAudioClip('papa_bump', {
      fetchBytes: () => Promise.reject(new Error('HTTP 404')),
      decode: decodeTo(1),
      baseUrl: './',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'audio', message: 'papa_bump.m4a: cannot fetch: HTTP 404' },
    });
  });

  it('is an err for an HTML body served with a 200, and never decodes it', async () => {
    let decoded = 0;
    const result = await loadAudioClip('papa_bump', {
      fetchBytes: () => Promise.resolve(HTML),
      decode: (data) => {
        decoded++;
        return decodeTo(1)(data);
      },
      baseUrl: './',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('not an MP4') },
    });
    expect(decoded).toBe(0);
  });

  it('is an err when the decode rejects', async () => {
    const result = await loadAudioClip('papa_bump', {
      fetchBytes: () => Promise.resolve(M4A),
      decode: () => Promise.reject(new Error('EncodingError')),
      baseUrl: './',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'papa_bump.m4a: cannot decode: EncodingError' },
    });
  });
});
