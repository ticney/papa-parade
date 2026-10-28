import type { TestHost } from '@client/app/testHost';
import { PERF_HUD_REFRESH_MS } from '@shared/constants';
import { log } from '@shared/log';
import { feedPerfMeter } from './perfFeed.ts';
import './perfHud.css';
import { createPerfMeter, type PerfReport } from './perfMeter.ts';

/** The slice of the page the counter needs: a parent that can hold it, and the document that makes it. */
export interface PerfHudRoot {
  append(...nodes: Node[]): void;
  readonly ownerDocument: Pick<
    Document,
    'createElement' | 'addEventListener' | 'removeEventListener'
  >;
}

/** The counter's text, e.g. `60 FPS · 16.7 ms · p95 17.0 ms · DPR 2`. « FPS », « ms », « p95 » and « DPR » are units, not prose. */
export function formatPerfHud(report: Readonly<PerfReport>, pixelRatio: number): string {
  const fps = Math.round(report.fpsLastSecond);
  const meanMs = report.frameMsMeanLastSecond.toFixed(1);
  const p95Ms = report.frameMsP95.toFixed(1);
  return `${fps} FPS · ${meanMs} ms · p95 ${p95Ms} ms · DPR ${Math.round(pixelRatio * 100) / 100}`;
}

/**
 * Shows a small FPS counter in `root` (`<body>`: `#pp-ui` is emptied at each screen change), bottom left: the frames of the last
 * second, their mean interval, the level's p95 so far, and the renderer's pixel ratio. Debug only,
 * and only with `?debug=1` (boot decides). It rewrites its text at most every `PERF_HUD_REFRESH_MS`
 * and only when it changed (and once more when the level ends); it stays up, frozen, on the Result
 * screen, where Geo reads the level's p95 for `docs/playtest/device-measurements.md`. Returns what removes it.
 */
export function installPerfHud(host: TestHost, root: PerfHudRoot): () => void {
  const element = root.ownerDocument.createElement('div');
  element.className = 'pp-debug-perf';
  element.setAttribute('aria-hidden', 'true');
  root.append(element);

  const meter = createPerfMeter();
  let lastWriteAtReal = Number.NEGATIVE_INFINITY;
  let lastText = '';
  let lastPixelRatio = 1;
  const write = (pixelRatio: number): void => {
    const text = formatPerfHud(meter.report(), pixelRatio);
    if (text === lastText) return;
    lastText = text;
    element.textContent = text;
  };
  const offFeed = feedPerfMeter(host, meter, root.ownerDocument);
  const offFrame = host.onRenderedFrame((frameAtReal, stats) => {
    lastPixelRatio = stats.pixelRatio;
    if (frameAtReal - lastWriteAtReal < PERF_HUD_REFRESH_MS) return;
    lastWriteAtReal = frameAtReal;
    write(stats.pixelRatio);
  });
  // The Result screen draws no level frame: write the level's final figures when it ends, not up
  // to a refresh period before.
  const offEvents = host.onSimEvent((event) => {
    if (event.type === 'LevelEnded') write(lastPixelRatio);
  });
  log.info('debug', 'FPS counter ready');
  return () => {
    offFeed();
    offFrame();
    offEvents();
    element.remove();
  };
}
