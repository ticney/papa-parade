import { describe, expect, it } from 'vitest';
import { keyGlyph, loadKeyboardLayoutMap, padConfirmGlyph } from './keyGlyphs.ts';

const STRINGS: Record<string, string> = {
  'key.space': 'Espace',
  'key.arrow_up': '↑',
  'key.arrow_down': '↓',
  'key.arrow_left': '←',
  'key.arrow_right': '→',
  'key.pad_confirm_xbox': 'A',
  'key.pad_confirm_playstation': '✕',
};
const t = (key: string): string => STRINGS[key] ?? `?${key}`;

describe('loadKeyboardLayoutMap', () => {
  it('returns the map the browser gives', async () => {
    const map = new Map([['KeyW', 'z']]);
    const result = await loadKeyboardLayoutMap({ keyboard: { getLayoutMap: async () => map } });
    expect(result).toEqual({ ok: true, value: map });
  });

  it('is an error where there is no navigator.keyboard (Safari, Firefox)', async () => {
    const result = await loadKeyboardLayoutMap({});
    expect(result).toMatchObject({ ok: false, error: { kind: 'input' } });
  });

  it('is an error, not a throw, when the browser refuses (an iframe, an insecure context)', async () => {
    const cause = new Error('SecurityError');
    const result = await loadKeyboardLayoutMap({
      keyboard: {
        getLayoutMap: () => Promise.reject(cause),
      },
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'input', cause } });
  });

  it('is an error when getLayoutMap is not a function', async () => {
    const result = await loadKeyboardLayoutMap({ keyboard: {} as never });
    expect(result.ok).toBe(false);
  });
});

describe('keyGlyph', () => {
  it("uses the layout map's name, trimmed and upper-cased", () => {
    const map = new Map([
      ['KeyW', 'z'],
      ['KeyE', ' e '],
    ]);
    expect(keyGlyph('KeyW', map, t)).toBe('Z');
    expect(keyGlyph('KeyE', map, t)).toBe('E');
  });

  it('falls back to « Espace » for Space, which no layout map names', () => {
    expect(keyGlyph('Space', new Map([['KeyW', 'z']]), t)).toBe('Espace');
    expect(keyGlyph('Space', null, t)).toBe('Espace');
  });

  it('ignores an empty or blank name', () => {
    expect(keyGlyph('Space', new Map([['Space', '   ']]), t)).toBe('Espace');
    expect(keyGlyph('KeyQ', new Map([['KeyQ', '']]), t)).toBe('KeyQ');
  });

  it('names Space when a map does give it a name', () => {
    expect(keyGlyph('Space', new Map([['Space', ' ']]), t)).toBe('Espace');
    expect(keyGlyph('Space', new Map([['Space', 'espace']]), t)).toBe('ESPACE');
  });

  it('gives the arrows their glyphs', () => {
    expect(keyGlyph('ArrowUp', null, t)).toBe('↑');
    expect(keyGlyph('ArrowDown', null, t)).toBe('↓');
    expect(keyGlyph('ArrowLeft', null, t)).toBe('←');
    expect(keyGlyph('ArrowRight', null, t)).toBe('→');
  });

  it('shows an unknown code as it is', () => {
    expect(keyGlyph('F13', null, t)).toBe('F13');
  });
});

describe('padConfirmGlyph', () => {
  it('is A on an Xbox-style pad and ✕ on a PlayStation one', () => {
    expect(padConfirmGlyph('xbox', t)).toBe('A');
    expect(padConfirmGlyph('playstation', t)).toBe('✕');
  });
});
