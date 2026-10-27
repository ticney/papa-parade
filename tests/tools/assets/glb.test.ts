import { describe, expect, it } from 'vitest';
import { buildGlb, GlbError, parseGlb } from '../../../tools/assets/glb.ts';

describe('parseGlb', () => {
  it('returns the JSON and the BIN chunk of a file built in memory', () => {
    const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const parsed = parseGlb(buildGlb({ asset: { version: '2.0' }, nodes: [] }, bin));
    expect(parsed.json).toEqual({ asset: { version: '2.0' }, nodes: [] });
    expect([...(parsed.bin ?? [])]).toEqual([...bin]);
  });

  it('accepts a file without a BIN chunk', () => {
    expect(parseGlb(buildGlb({ a: 1 })).bin).toBeNull();
  });

  it('reads a view into a larger buffer (a Node Buffer slice)', () => {
    const glb = buildGlb({ a: 1 });
    const padded = new Uint8Array(glb.length + 10);
    padded.set(glb, 7);
    expect(parseGlb(padded.subarray(7, 7 + glb.length)).json).toEqual({ a: 1 });
  });

  it('refuses a bad magic', () => {
    const glb = buildGlb({});
    glb[0] = 0;
    expect(() => parseGlb(glb)).toThrow(GlbError);
    expect(() => parseGlb(glb)).toThrow(/magic/);
  });

  it('refuses a file shorter than a header', () => {
    expect(() => parseGlb(new Uint8Array(4))).toThrow(/shorter than a header/);
  });

  it('refuses another version', () => {
    const glb = buildGlb({});
    new DataView(glb.buffer).setUint32(4, 1, true);
    expect(() => parseGlb(glb)).toThrow(/version 1/);
  });

  it('refuses a length that does not match the file', () => {
    const glb = buildGlb({});
    expect(() => parseGlb(glb.subarray(0, glb.length - 4))).toThrow(/length/);
  });

  it('refuses a chunk that runs past the end', () => {
    const glb = buildGlb({});
    new DataView(glb.buffer).setUint32(12, 9999, true);
    expect(() => parseGlb(glb)).toThrow(/past the end/);
  });

  it('refuses a JSON chunk that is not JSON', () => {
    const glb = buildGlb({});
    glb.fill(0x7b, 20, 24); // "{{{{"
    expect(() => parseGlb(glb)).toThrow(/not valid JSON/);
  });

  it('refuses a file with no JSON chunk', () => {
    const glb = new Uint8Array(12);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 12, true);
    expect(() => parseGlb(glb)).toThrow(/no JSON chunk/);
  });
});
