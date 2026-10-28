import type { TestHost } from '@client/app/testHost';
import type { LoopStats } from '@client/loop';
import type { RenderStats } from '@client/render/renderer';
import { DEBUG_PANEL_REFRESH_MS } from '@shared/constants';
import { feedPerfMeter } from './perfFeed.ts';
import { createPerfMeter, type PerfReport } from './perfMeter.ts';

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

/**
 * FPS, frame interval, sim time and render time per frame (the loop's own clock, on only while the
 * overlay is open) and draw calls and triangles (`renderer.info`), rewritten every
 * `DEBUG_PANEL_REFRESH_MS` of real time and not on every frame.
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
  const offFeed = feedPerfMeter(host, meter, root.ownerDocument);
  let isActive = false;
  let lastWriteAtReal = Number.NEGATIVE_INFINITY;
  const offFrame = host.onRenderedFrame((frameAtReal, stats) => {
    if (!isActive || frameAtReal - lastWriteAtReal < DEBUG_PANEL_REFRESH_MS) return;
    lastWriteAtReal = frameAtReal;
    element.textContent = formatPerfLines(meter.report(), host.levelSession.loopStats, stats).join(
      '\n',
    );
  });

  return {
    setActive(next) {
      if (next === isActive) return;
      isActive = next;
      // The loop reads no clock at all while the overlay is shut.
      host.levelSession.setLoopMeasure(next ? clock : null);
      if (next) lastWriteAtReal = Number.NEGATIVE_INFINITY;
    },
    dispose() {
      host.levelSession.setLoopMeasure(null);
      offFrame();
      offFeed();
      element.remove();
    },
  };
}
