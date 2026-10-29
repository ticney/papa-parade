import type { TestHost } from '@client/app/testHost';
import type { LoopStats } from '@client/loop';
import type { RenderStats } from '@client/render/renderer';
import { DEBUG_PANEL_REFRESH_MS } from '@shared/constants';
import { guarded } from './guard.ts';
import { feedPerfMeter } from './perfFeed.ts';
import { createPerfMeter, type PerfMeter, type PerfReport } from './perfMeter.ts';

/** The overlay's performance lines, e.g. `60 FPS · frame 16.7 ms (p95 17.0)`. Units are in the text. */
export function formatPerfLines(
  report: Readonly<PerfReport>,
  loop: Readonly<
    Pick<LoopStats, 'simMsLastFrame' | 'renderMsLastFrame' | 'frameMsLastFrame'>
  > | null,
  render: Readonly<Pick<RenderStats, 'drawCalls' | 'triangles'>>,
): string[] {
  const fps = Math.round(report.fpsLastSecond);
  const intervalMs = report.frameMsMeanLastSecond.toFixed(1);
  const lines = [
    `${fps} FPS · frame every ${intervalMs} ms (p95 ${report.frameMsP95.toFixed(1)}, max ${report.frameMsMax.toFixed(1)})`,
  ];
  if (loop !== null) {
    lines.push(
      `work ${loop.frameMsLastFrame.toFixed(1)} ms = sim ${loop.simMsLastFrame.toFixed(2)} ms + render ${loop.renderMsLastFrame.toFixed(1)} ms`,
    );
  }
  lines.push(`${render.drawCalls} draw calls · ${render.triangles} triangles`);
  return lines;
}

export interface PerfPanel {
  /** Starts or stops the measuring (the loop clock and the refresh); the panel costs nothing while off. */
  setActive(isActive: boolean): void;
  dispose(): void;
}

export interface PerfPanelRoot {
  append(...nodes: Node[]): void;
  readonly ownerDocument: Pick<
    Document,
    'createElement' | 'addEventListener' | 'removeEventListener'
  >;
}

/** The meter with every write guarded: a throw in it is logged, never sent up to the loop's listeners. */
function guardedMeter(meter: PerfMeter): PerfMeter {
  return {
    frame: guarded('perf panel: measuring a frame', meter.frame),
    reset: guarded('perf panel: resetting the meter', meter.reset),
    skipNextInterval: guarded('perf panel: skipping an interval', meter.skipNextInterval),
    report: meter.report,
  };
}

/**
 * FPS, frame interval, sim time and render time per frame (the loop's own clock, on only while the
 * overlay is open) and draw calls and triangles (`renderer.info`), rewritten every
 * `DEBUG_PANEL_REFRESH_MS` of real time and not on every frame. While inactive it listens to
 * nothing: the meter's feed and the refresh are attached on `setActive(true)` and detached on
 * `setActive(false)`, and the meter starts afresh each time (the closed time is not a long frame).
 */
export function createPerfPanel(
  host: TestHost,
  root: PerfPanelRoot,
  clock: () => number,
): PerfPanel {
  const element = root.ownerDocument.createElement('pre');
  element.className = 'pp-debug-perf-panel';
  root.append(element);

  const meter = createPerfMeter();
  const feedMeter = guardedMeter(meter);
  let detach: (() => void) | null = null;
  let lastWriteAtReal = Number.NEGATIVE_INFINITY;

  const attach = (): (() => void) => {
    const offFeed = feedPerfMeter(host, feedMeter, root.ownerDocument);
    const offFrame = host.onRenderedFrame(
      guarded('perf panel: refresh', (frameAtReal, stats) => {
        if (frameAtReal - lastWriteAtReal < DEBUG_PANEL_REFRESH_MS) return;
        lastWriteAtReal = frameAtReal;
        element.textContent = formatPerfLines(
          meter.report(),
          host.levelSession.loopStats,
          stats,
        ).join('\n');
      }),
    );
    return () => {
      offFrame();
      offFeed();
    };
  };

  return {
    setActive(next) {
      if (next === (detach !== null)) return;
      if (next) {
        meter.reset();
        lastWriteAtReal = Number.NEGATIVE_INFINITY;
        detach = attach();
      } else {
        detach?.();
        detach = null;
      }
      // The loop reads no clock at all while the overlay is shut.
      host.levelSession.setLoopMeasure(next ? clock : null);
    },
    dispose() {
      detach?.();
      detach = null;
      host.levelSession.setLoopMeasure(null);
      element.remove();
    },
  };
}
