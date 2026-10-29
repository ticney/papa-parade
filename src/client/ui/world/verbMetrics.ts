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
  /** The advance width of `text` (already uppercase) at `fontPx`, in CSS px. */
  widthPx(text: string, fontPx: number): number;
}

/** What `createVerbMetrics` reads, so that a test needs neither a DOM nor a canvas. */
export interface VerbMetricsSource {
  /** `data-pp-surface` of the root: `compact`, `regular`, or empty before the first resize. */
  surface(): string;
  /** A CSS custom property of the root, e.g. `--pp-font-verb-size`; empty when unset. */
  cssVar(name: string): string;
  /** The width of `text` set in the CSS `font` shorthand, or null when it cannot be measured. */
  measure(font: string, text: string): number | null;
}

function numberOf(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The fallback of a missing token: a verb is never invisible, so the DESIGN regular size and line height. */
const FALLBACK_BASE_PX = 40;
const FALLBACK_LINE_HEIGHT = 1;
/** A glyph is about this wide, as a multiple of its font size: used only when the canvas cannot measure. */
const ESTIMATED_GLYPH_EM = 0.6;

export function createVerbMetrics(source: VerbMetricsSource): VerbMetrics {
  let isEstimateWarned = false;
  const group = (): 'verb-compact' | 'verb' =>
    source.surface() === 'compact' ? 'verb-compact' : 'verb';
  return {
    surfaceKey: () => source.surface(),
    basePx: () => numberOf(source.cssVar(`--pp-font-${group()}-size`), FALLBACK_BASE_PX),
    lineHeight: () =>
      numberOf(source.cssVar(`--pp-font-${group()}-line-height`), FALLBACK_LINE_HEIGHT),
    scale: () => numberOf(source.cssVar('--pp-verb-scale'), 1),
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
  });
}
