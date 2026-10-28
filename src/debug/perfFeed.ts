import type { TestHost } from '@client/app/testHost';
import type { PerfMeter } from './perfMeter.ts';

/** The slice of `document` the feed listens on. */
export type VisibilityTarget = Pick<Document, 'addEventListener' | 'removeEventListener'>;

/**
 * Feeds `meter` with the app's level frames: each drawn frame is measured, each new level resets
 * it, and a page that was hidden or comes back, or a game that was paused and resumes (the app
 * sends no frame to the listeners meanwhile), does not count its absence as one long frame. Shared
 * by the FPS counter and `__PP__.perf()`, which each own a meter (story 1.24 D7). Returns the
 * unsubscribe. With no `document` (a Node test) the visibility part is skipped.
 */
export function feedPerfMeter(
  host: TestHost,
  meter: PerfMeter,
  doc: VisibilityTarget | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  const onVisibilityChange = (): void => meter.skipNextInterval();
  const offFrame = host.onRenderedFrame((frameAtReal, stats) => {
    meter.frame(frameAtReal, stats.drawCalls, stats.triangles);
  });
  const offLevel = host.onLevelStarted(() => meter.reset());
  const offResumed = host.onGameResumed(() => meter.skipNextInterval());
  doc?.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    offFrame();
    offLevel();
    offResumed();
    doc?.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
