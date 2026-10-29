import { DEBUG_TIMELINE_ROWS } from '@shared/constants';
import type { SimEvent } from '@sim';

export type ResolvedEvent = Extract<SimEvent, { type: 'ResponseResolved' }>;

/**
 * One row of the timing timeline, in percent of the row's axis (0 = the early limit, 100 = the
 * late limit). The axis is centred on the window's centre: from `−(windowMs / 2 + toleranceMs +
 * bufferMs)` (the earliest press the sim still keeps) to `windowMs / 2 + toleranceMs` (the latest).
 */
export interface TimelineRow {
  /** The hidden tolerance on each side of the window: the whole band a press may land in. */
  toleranceStartPct: number;
  toleranceWidthPct: number;
  /** The standard window. */
  windowStartPct: number;
  windowWidthPct: number;
  /** The perfect zone, centred in the window. */
  perfectStartPct: number;
  perfectWidthPct: number;
  /** Where the press landed, or `null` when there was none. */
  markerPct: number | null;
  /** The press fell outside the axis (a very late or early one): the marker sits on the edge. */
  isMarkerClamped: boolean;
  /** `+23 ms`, `−41 ms`, `0 ms`, or `no press`. */
  offsetLabel: string;
  /** `perfect`, `success`, or `fail (late)`. */
  qualityLabel: string;
  quality: ResolvedEvent['quality'];
}

const MINUS = '−';

/** The signed offset as shown: a real minus sign, a plus for a late press, no `+0`. */
export function formatOffsetMs(offsetMs: number | null): string {
  if (offsetMs === null) return 'no press';
  const rounded = Math.round(offsetMs);
  if (rounded === 0) return '0 ms';
  return rounded > 0 ? `+${rounded} ms` : `${MINUS}${-rounded} ms`;
}

const clampPct = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * The geometry of the row of one `ResponseResolved`, from the window the threat was judged against
 * (`responseWindow`). Pure. A window with no width (all zero) gets a centred marker rather than a
 * division by zero.
 */
export function timelineRow(event: ResolvedEvent): TimelineRow {
  const { windowMs, perfectMs, toleranceMs, bufferMs } = event.responseWindow;
  const earlyMs = -(windowMs / 2 + toleranceMs + bufferMs);
  const lateMs = windowMs / 2 + toleranceMs;
  const spanMs = lateMs - earlyMs;
  const pct = (ms: number): number => (spanMs > 0 ? ((ms - earlyMs) / spanMs) * 100 : 50);
  const widthPct = (ms: number): number => (spanMs > 0 ? (ms / spanMs) * 100 : 0);

  const rawMarker = event.offsetMs === null ? null : pct(event.offsetMs);
  const markerPct = rawMarker === null ? null : clampPct(rawMarker);
  return {
    toleranceStartPct: pct(-(windowMs / 2 + toleranceMs)),
    toleranceWidthPct: widthPct(windowMs + 2 * toleranceMs),
    windowStartPct: pct(-windowMs / 2),
    windowWidthPct: widthPct(windowMs),
    perfectStartPct: pct(-perfectMs / 2),
    perfectWidthPct: widthPct(perfectMs),
    markerPct,
    isMarkerClamped: rawMarker !== null && rawMarker !== markerPct,
    offsetLabel: formatOffsetMs(event.offsetMs),
    qualityLabel: event.quality === 'fail' ? `fail (${event.reason ?? '?'})` : event.quality,
    quality: event.quality,
  };
}

/** The slice of the page a timeline needs: a parent to append to. */
export interface TimelineRoot {
  append(...nodes: Node[]): void;
  readonly ownerDocument: Pick<Document, 'createElement'>;
}

interface RowElements {
  root: HTMLElement;
  tolerance: HTMLElement;
  windowBar: HTMLElement;
  perfect: HTMLElement;
  marker: HTMLElement;
  label: HTMLElement;
}

export interface TimingTimeline {
  /** Adds the response on top of the list; the oldest of `DEBUG_TIMELINE_ROWS` leaves. */
  add(event: ResolvedEvent): void;
  /** Empties the list (a new level). */
  clear(): void;
  /** How many rows hold a response now. */
  readonly size: number;
  dispose(): void;
}

const setPct = (element: HTMLElement, left: number, width: number): void => {
  element.style.left = `${left}%`;
  element.style.width = `${width}%`;
};

/**
 * The timeline list in `root`: `DEBUG_TIMELINE_ROWS` rows built once; a response rewrites them in
 * place, newest on top. It updates on events only (never per frame), and positions its bars
 * through the CSSOM (no inline style attribute, so the playtest CSP is kept).
 */
export function createTimingTimeline(root: TimelineRoot): TimingTimeline {
  const doc = root.ownerDocument;
  const make = (tag: string, className: string): HTMLElement => {
    const element = doc.createElement(tag);
    element.className = className;
    return element;
  };
  const list = make('div', 'pp-debug-timeline');
  const rows: RowElements[] = [];
  for (let i = 0; i < DEBUG_TIMELINE_ROWS; i++) {
    const rowRoot = make('div', 'pp-debug-tl-row');
    rowRoot.hidden = true;
    const axis = make('div', 'pp-debug-tl-axis');
    const tolerance = make('div', 'pp-debug-tl-tolerance');
    const windowBar = make('div', 'pp-debug-tl-window');
    const perfect = make('div', 'pp-debug-tl-perfect');
    const marker = make('div', 'pp-debug-tl-marker');
    axis.append(tolerance, windowBar, perfect, marker);
    const label = make('div', 'pp-debug-tl-label');
    rowRoot.append(axis, label);
    list.append(rowRoot);
    rows.push({ root: rowRoot, tolerance, windowBar, perfect, marker, label });
  }
  root.append(list);

  // The responses shown, newest first: a ring of the last rows, rewritten on each `add`.
  const shown: TimelineRow[] = [];
  const paint = (): void => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as RowElements;
      const data = shown[i];
      row.root.hidden = data === undefined;
      if (data === undefined) continue;
      setPct(row.tolerance, data.toleranceStartPct, data.toleranceWidthPct);
      setPct(row.windowBar, data.windowStartPct, data.windowWidthPct);
      setPct(row.perfect, data.perfectStartPct, data.perfectWidthPct);
      row.marker.hidden = data.markerPct === null;
      if (data.markerPct !== null) row.marker.style.left = `${data.markerPct}%`;
      row.marker.dataset.clamped = String(data.isMarkerClamped);
      row.root.dataset.quality = data.quality;
      row.root.dataset.offset = data.offsetLabel;
      row.label.textContent = `${data.offsetLabel} · ${data.qualityLabel}`;
    }
  };

  return {
    add(event) {
      shown.unshift(timelineRow(event));
      if (shown.length > DEBUG_TIMELINE_ROWS) shown.length = DEBUG_TIMELINE_ROWS;
      paint();
    },
    clear() {
      shown.length = 0;
      paint();
    },
    get size() {
      return shown.length;
    },
    dispose() {
      list.remove();
    },
  };
}
