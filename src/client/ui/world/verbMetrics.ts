import { log } from '@shared/log';

/**
 * What the verb layout needs to know of the page's typography (story 2.2 T6): the base size of the verb on
 * the current surface, the user's `--pp-verb-scale` (story 2.10 flips it; default 1), and how wide a text
 * is at a font size. Read when the layout refits (a resize, a surface change, the fonts loading), never per
 * frame: the markers are `display: none` until shown, so their own width cannot be read.
 */
export interface VerbMetrics {
  /** Changes when the surface does (`compact` / `regular`): the layout refits. Cheap enough for each frame. */
  surfaceKey(): string;
  /** `typography.verb` (regular) or `typography.verb-compact` size, in CSS px. */
  basePx(): number;
  /** The verb's line height as a multiple of its font size (DESIGN: 1). */
  lineHeight(): number;
  /** The « Grands verbes » multiplier, 1 by default. */
  scale(): number;
  /** The threat icon's size on this surface (`--pp-threat-size`: 56 compact, 64 regular), in CSS px: the chrono-ring's radii hang from it. */
  threatSizePx(): number;
  /** The advance width of `text` (already uppercase) at `fontPx`, in CSS px. */
  widthPx(text: string, fontPx: number): number;
  /**
   * The bottom of the HUD's top row (`.pp-hud-row`: `{spacing.hud-inset}` with the safe area, and the
   * row's `{spacing.touch-target-min}` height), in CSS px from the top of the page, which is the top of the
   * world layer too (both are `position: fixed; inset: 0`). A verb never starts above it (`verbTopMinPx`,
   * story 9.5 review). Read when the verbs refit, never per frame. Absent on a double that lays out no
   * HUD: its verbs are not clamped vertically.
   */
  hudBottomPx?(): number;
}

/**
 * The highest a verb box's top edge may be in the world layer, in CSS px: the bottom of the HUD's top
 * row, so that only a verb the row would cut moves (one that clears it, however closely, keeps its
 * place). `-Infinity` (no clamp) when `metrics` knows no HUD.
 */
export function verbTopMinPx(metrics: VerbMetrics): number {
  if (metrics.hudBottomPx === undefined) return Number.NEGATIVE_INFINITY;
  return metrics.hudBottomPx();
}

/** What `createVerbMetrics` reads, so that a test needs neither a DOM nor a canvas. */
export interface VerbMetricsSource {
  /** `data-pp-surface` of the root: `compact`, `regular`, or empty before the first resize. */
  surface(): string;
  /** A CSS custom property of the root, e.g. `--pp-font-verb-size`; empty when unset. */
  cssVar(name: string): string;
  /** The width of `text` set in the CSS `font` shorthand, or null when it cannot be measured. */
  measure(font: string, text: string): number | null;
  /** The bottom of the HUD's top row, in CSS px from the top of the page; NaN or absent when there is none. */
  hudBottomPx?(): number;
}

function numberOf(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The fallback of a missing token: a verb is never invisible, so the DESIGN regular size and line height. */
const FALLBACK_BASE_PX = 40;
const FALLBACK_LINE_HEIGHT = 1;
/** The regular surface's icon size, when `--pp-threat-size` cannot be read. */
const FALLBACK_THREAT_SIZE_PX = 64;
/** The HUD's top row (`hudLayer.ts`), as `boot.ts` finds it for the silence and off-screen bubbles. */
const HUD_ROW_SELECTOR = '.pp-hud-row';

/** A glyph is about this wide, as a multiple of its font size: used only when the canvas cannot measure. */
const ESTIMATED_GLYPH_EM = 0.6;

export function createVerbMetrics(source: VerbMetricsSource): VerbMetrics {
  let isEstimateWarned = false;
  const warnedTokens = new Set<string>();
  /** A token the design must declare: an unreadable one falls back, with one `warn` per token. */
  const requiredNumber = (name: string, fallback: number): number => {
    const raw = source.cssVar(name);
    const value = Number.parseFloat(raw);
    if (Number.isFinite(value) && value > 0) return value;
    if (!warnedTokens.has(name)) {
      warnedTokens.add(name);
      log.warn(
        'render',
        `cannot read the token ${name} (${JSON.stringify(raw)}): using ${fallback}`,
      );
    }
    return fallback;
  };
  const group = (): 'verb-compact' | 'verb' =>
    source.surface() === 'compact' ? 'verb-compact' : 'verb';
  return {
    surfaceKey: () => source.surface(),
    basePx: () => requiredNumber(`--pp-font-${group()}-size`, FALLBACK_BASE_PX),
    lineHeight: () => requiredNumber(`--pp-font-${group()}-line-height`, FALLBACK_LINE_HEIGHT),
    scale: () => numberOf(source.cssVar('--pp-verb-scale'), 1),
    threatSizePx: () => requiredNumber('--pp-threat-size', FALLBACK_THREAT_SIZE_PX),
    widthPx(text, fontPx) {
      const family = source.cssVar(`--pp-font-${group()}-family`);
      const weight = source.cssVar(`--pp-font-${group()}-weight`);
      const fallback = source.cssVar('--pp-fallback-rounded');
      const stack = [family, fallback].filter((part) => part !== '').join(', ');
      const measured = source.measure(`${weight} ${fontPx}px ${stack}`, text);
      if (measured !== null) return measured;
      if (!isEstimateWarned) {
        isEstimateWarned = true;
        log.warn('render', 'cannot measure the verb text with a canvas: its width is estimated');
      }
      return text.length * fontPx * ESTIMATED_GLYPH_EM;
    },
    hudBottomPx() {
      const bottomPx = source.hudBottomPx?.() ?? Number.NaN;
      if (Number.isFinite(bottomPx) && bottomPx >= 0) return bottomPx;
      if (!warnedTokens.has(HUD_ROW_SELECTOR)) {
        warnedTokens.add(HUD_ROW_SELECTOR);
        log.warn(
          'render',
          `cannot read the bottom of ${HUD_ROW_SELECTOR}: verbs keep to the layer`,
        );
      }
      // No row to keep clear of: a verb still never starts above the layer.
      return 0;
    },
  };
}

/** The browser's: the root element's styles and one offscreen canvas, made on the first measure. */
export function createBrowserVerbMetrics(doc: Document = document): VerbMetrics {
  const root = doc.documentElement;
  let context: CanvasRenderingContext2D | null | undefined;
  return createVerbMetrics({
    surface: () => root.dataset.ppSurface ?? '',
    cssVar: (name) => getComputedStyle(root).getPropertyValue(name).trim(),
    measure(font, text) {
      if (context === undefined) context = doc.createElement('canvas').getContext('2d');
      if (context === null) return null;
      context.font = font;
      return context.measureText(text).width;
    },
    // The row's computed `top` and `height` (its tokens, the safe area resolved): readable while `#pp-hud`
    // is hidden too, which a bounding box is not.
    hudBottomPx() {
      const row = doc.querySelector(HUD_ROW_SELECTOR);
      if (row === null) return Number.NaN;
      const style = getComputedStyle(row);
      return Number.parseFloat(style.top) + Number.parseFloat(style.height);
    },
  });
}
