import { type AppError, err, ok, type Result } from '@shared/result';
import type { PadFamily } from './gamepadInput.ts';

/** `navigator.keyboard`, the slice this reads: the WICG Keyboard Map API (Chromium, secure contexts, top level only). */
export interface KeyboardLayoutSource {
  readonly keyboard?: { getLayoutMap(): Promise<ReadonlyMap<string, string>> };
}

/**
 * The browser's names for the keys of the layout in use (`KeyboardEvent.code` → the character it
 * types), or an error: no `navigator.keyboard` (Safari, Firefox), or a rejection (an iframe, an
 * insecure context). The caller logs **one** `warn` and falls back to the built-in names. Note
 * that the map covers writing-system keys (letters, digits, punctuation) only: it never names Space
 * (D10 of story 1.17), so the Space chip says « Espace » everywhere today.
 */
export async function loadKeyboardLayoutMap(
  navigator: object,
): Promise<Result<ReadonlyMap<string, string>, AppError>> {
  // `Navigator` does not declare `keyboard` (a Chromium API): read it through the slice we use.
  const nav: KeyboardLayoutSource = navigator;
  if (nav.keyboard === undefined || typeof nav.keyboard.getLayoutMap !== 'function') {
    return err({
      kind: 'input',
      message: 'navigator.keyboard.getLayoutMap() is not available here',
    });
  }
  try {
    return ok(await nav.keyboard.getLayoutMap());
  } catch (cause) {
    return err({
      kind: 'input',
      message: 'navigator.keyboard.getLayoutMap() was refused (an iframe or an insecure context?)',
      cause,
    });
  }
}

const ARROW_STRINGS: Readonly<Record<string, string>> = {
  ArrowUp: 'key.arrow_up',
  ArrowDown: 'key.arrow_down',
  ArrowLeft: 'key.arrow_left',
  ArrowRight: 'key.arrow_right',
};

/**
 * What a key is called on a chip: the layout map's name for it (trimmed, upper-cased) when it has
 * one; else Space reads `t('key.space')`, the arrows their arrow glyphs, and any other code is
 * shown as it is. `t` is the string table; `layoutMap` is null until it loaded or when it cannot.
 */
export function keyGlyph(
  code: string,
  layoutMap: ReadonlyMap<string, string> | null,
  t: (key: string) => string,
): string {
  const named = layoutMap?.get(code)?.trim().toUpperCase();
  if (named !== undefined && named !== '') return named;
  if (code === 'Space') return t('key.space');
  const arrow = ARROW_STRINGS[code];
  if (arrow !== undefined) return t(arrow);
  return code;
}

/** The confirm button's glyph of a pad family: « A » on an Xbox-style pad, « ✕ » on a PlayStation one. */
export function padConfirmGlyph(family: PadFamily, t: (key: string) => string): string {
  return t(family === 'playstation' ? 'key.pad_confirm_playstation' : 'key.pad_confirm_xbox');
}
