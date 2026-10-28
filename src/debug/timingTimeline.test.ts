import { DEBUG_TIMELINE_ROWS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createFakeRoot, type FakeElement } from '../../tests/support/fakeDom.ts';
import { createTestResponseWindow } from '../../tests/support/testContent.ts';
import {
  createTimingTimeline,
  formatOffsetMs,
  type ResolvedEvent,
  timelineRow,
} from './timingTimeline.ts';

const baseWindow = createTestResponseWindow();

function resolved(overrides: Partial<ResolvedEvent> = {}): ResolvedEvent {
  return {
    type: 'ResponseResolved',
    t: asSimMs(1000),
    threatId: 1,
    response: 'parry',
    quality: 'success',
    offsetMs: 0,
    responseWindow: { ...baseWindow },
    ...overrides,
  };
}

const earlyLimitMs = (w: typeof baseWindow): number =>
  -(w.windowMs / 2 + w.toleranceMs + w.bufferMs);
const lateLimitMs = (w: typeof baseWindow): number => w.windowMs / 2 + w.toleranceMs;

describe('formatOffsetMs', () => {
  it('signs the offset, with a real minus, and rounds to whole ms', () => {
    expect(formatOffsetMs(23)).toBe('+23 ms');
    expect(formatOffsetMs(-41)).toBe('−41 ms');
    expect(formatOffsetMs(22.6)).toBe('+23 ms');
    expect(formatOffsetMs(-40.6)).toBe('−41 ms');
  });

  it('writes zero without a sign, even a rounded-off tiny offset', () => {
    expect(formatOffsetMs(0)).toBe('0 ms');
    expect(formatOffsetMs(-0.2)).toBe('0 ms');
    expect(formatOffsetMs(0.4)).toBe('0 ms');
  });

  it('says there was no press for a null offset', () => {
    expect(formatOffsetMs(null)).toBe('no press');
  });
});

describe('timelineRow', () => {
  it('spans the axis from the early limit to the late limit of the row’s window', () => {
    const w = baseWindow;
    const spanMs = lateLimitMs(w) - earlyLimitMs(w);
    const row = timelineRow(resolved({ offsetMs: earlyLimitMs(w) }));
    expect(row.markerPct).toBeCloseTo(0, 9);
    expect(timelineRow(resolved({ offsetMs: lateLimitMs(w) })).markerPct).toBeCloseTo(100, 9);
    // The centre of the window sits at buffer-and-tolerance over the span.
    const centrePct = ((0 - earlyLimitMs(w)) / spanMs) * 100;
    expect(timelineRow(resolved({ offsetMs: 0 })).markerPct).toBeCloseTo(centrePct, 9);
  });

  it('puts the tolerance band, the window and the perfect zone on the axis, nested and centred', () => {
    const w = baseWindow;
    const row = timelineRow(resolved());
    const spanMs = lateLimitMs(w) - earlyLimitMs(w);
    expect(row.windowWidthPct).toBeCloseTo((w.windowMs / spanMs) * 100, 9);
    expect(row.perfectWidthPct).toBeCloseTo((w.perfectMs / spanMs) * 100, 9);
    expect(row.toleranceWidthPct).toBeCloseTo(((w.windowMs + 2 * w.toleranceMs) / spanMs) * 100, 9);
    // Nested.
    expect(row.toleranceStartPct).toBeLessThan(row.windowStartPct);
    expect(row.windowStartPct).toBeLessThan(row.perfectStartPct);
    expect(row.perfectStartPct + row.perfectWidthPct).toBeLessThan(
      row.windowStartPct + row.windowWidthPct,
    );
    // Centred: the same margin on each side of the perfect zone inside the window.
    const before = row.perfectStartPct - row.windowStartPct;
    const after =
      row.windowStartPct + row.windowWidthPct - (row.perfectStartPct + row.perfectWidthPct);
    expect(before).toBeCloseTo(after, 9);
    // The tolerance band ends exactly at the late limit.
    expect(row.toleranceStartPct + row.toleranceWidthPct).toBeCloseTo(100, 9);
  });

  it('shows an early press left of the centre with a minus offset, and a late one right of it with a plus', () => {
    const early = timelineRow(resolved({ offsetMs: -41 }));
    const late = timelineRow(resolved({ offsetMs: 23 }));
    const centre = timelineRow(resolved({ offsetMs: 0 }));
    expect(early.markerPct as number).toBeLessThan(centre.markerPct as number);
    expect(late.markerPct as number).toBeGreaterThan(centre.markerPct as number);
    expect(early.offsetLabel).toBe('−41 ms');
    expect(late.offsetLabel).toBe('+23 ms');
    expect(early.isMarkerClamped).toBe(false);
  });

  it('labels the quality, with the reason of a fail', () => {
    expect(timelineRow(resolved({ quality: 'perfect' })).qualityLabel).toBe('perfect');
    expect(timelineRow(resolved({ quality: 'success' })).qualityLabel).toBe('success');
    expect(timelineRow(resolved({ quality: 'fail', reason: 'late' })).qualityLabel).toBe(
      'fail (late)',
    );
    expect(timelineRow(resolved({ quality: 'fail', reason: 'wrongResponse' })).qualityLabel).toBe(
      'fail (wrongResponse)',
    );
  });

  it('has no marker for a response with no press, and says so', () => {
    const row = timelineRow(resolved({ quality: 'fail', reason: 'late', offsetMs: null }));
    expect(row.markerPct).toBeNull();
    expect(row.isMarkerClamped).toBe(false);
    expect(row.offsetLabel).toBe('no press');
  });

  it('keeps the marker on the axis and says it was clamped when the press is off it', () => {
    const w = baseWindow;
    const far = timelineRow(resolved({ offsetMs: lateLimitMs(w) + 500 }));
    expect(far.markerPct).toBe(100);
    expect(far.isMarkerClamped).toBe(true);
    const farEarly = timelineRow(resolved({ offsetMs: earlyLimitMs(w) - 500 }));
    expect(farEarly.markerPct).toBe(0);
    expect(farEarly.isMarkerClamped).toBe(true);
  });

  it('follows a widened window: the same press lands nearer the centre on a wider axis', () => {
    const wide = { ...baseWindow, windowMs: baseWindow.windowMs * 2 };
    const normal = timelineRow(resolved({ offsetMs: 60 }));
    const widened = timelineRow(resolved({ offsetMs: 60, responseWindow: wide }));
    const centrePct = (row: ReturnType<typeof timelineRow>): number =>
      row.windowStartPct + row.windowWidthPct / 2;
    expect(Math.abs((widened.markerPct as number) - centrePct(widened))).toBeLessThan(
      Math.abs((normal.markerPct as number) - centrePct(normal)),
    );
    expect(widened.windowWidthPct).toBeGreaterThan(normal.windowWidthPct);
  });

  it('does not divide by zero for a window with no width', () => {
    const none = { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 };
    const row = timelineRow(resolved({ offsetMs: 5, responseWindow: none }));
    expect(Number.isFinite(row.markerPct)).toBe(true);
    expect(row.windowWidthPct).toBe(0);
  });
});

describe('createTimingTimeline', () => {
  function setup() {
    const root = createFakeRoot();
    const timeline = createTimingTimeline(root);
    const rows = (): FakeElement[] => root.findAll('pp-debug-tl-row');
    const labels = (): string[] =>
      rows()
        .filter((row) => !row.hidden)
        .map((row) => (row.findAll('pp-debug-tl-label')[0] as FakeElement).textContent);
    return { root, timeline, rows, labels };
  }

  it('builds its rows once, all hidden', () => {
    const { rows, timeline } = setup();
    expect(rows()).toHaveLength(DEBUG_TIMELINE_ROWS);
    expect(rows().every((row) => row.hidden)).toBe(true);
    expect(timeline.size).toBe(0);
  });

  it('shows the newest response on top, with its offset and quality', () => {
    const { timeline, labels } = setup();
    timeline.add(resolved({ offsetMs: -41, quality: 'perfect' }));
    timeline.add(resolved({ offsetMs: 23, quality: 'success' }));
    expect(labels()).toEqual(['+23 ms · success', '−41 ms · perfect']);
  });

  it('keeps DEBUG_TIMELINE_ROWS responses, dropping the oldest', () => {
    const { timeline, labels, rows } = setup();
    for (let i = 0; i < DEBUG_TIMELINE_ROWS + 3; i++) timeline.add(resolved({ offsetMs: i }));
    expect(timeline.size).toBe(DEBUG_TIMELINE_ROWS);
    expect(labels()).toHaveLength(DEBUG_TIMELINE_ROWS);
    expect(labels()[0]).toContain(`+${DEBUG_TIMELINE_ROWS + 2} ms`);
    expect(labels().at(-1)).toContain('+3 ms');
    expect(rows()).toHaveLength(DEBUG_TIMELINE_ROWS);
  });

  it('shows a response with no press with no marker, and positions the bars through the style object', () => {
    const { timeline, rows } = setup();
    timeline.add(resolved({ quality: 'fail', reason: 'late', offsetMs: null }));
    const row = rows()[0] as FakeElement;
    expect((row.findAll('pp-debug-tl-marker')[0] as FakeElement).hidden).toBe(true);
    expect((row.findAll('pp-debug-tl-label')[0] as FakeElement).textContent).toBe(
      'no press · fail (late)',
    );
    const windowBar = row.findAll('pp-debug-tl-window')[0] as FakeElement;
    expect(windowBar.style.left).toMatch(/%$/);
    expect(windowBar.style.width).toMatch(/%$/);
    expect(row.dataset.quality).toBe('fail');
  });

  it('empties on clear() and removes itself on dispose()', () => {
    const { timeline, root, labels } = setup();
    timeline.add(resolved());
    timeline.clear();
    expect(labels()).toEqual([]);
    expect(timeline.size).toBe(0);
    timeline.dispose();
    expect(root.children).toHaveLength(0);
  });
});
