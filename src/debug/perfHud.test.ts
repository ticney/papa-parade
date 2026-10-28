import { PERF_HUD_REFRESH_MS } from '@shared/constants';
import { log } from '@shared/log';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeTestHost } from '../../tests/support/fakeTestHost.ts';
import { formatPerfHud, installPerfHud, type PerfHudRoot } from './perfHud.ts';
import type { PerfReport } from './perfMeter.ts';

beforeAll(() => {
  log.setLevel('error');
});

const REPORT: PerfReport = {
  frames: 600,
  fpsLastSecond: 59.9,
  frameMsMeanLastSecond: 16.69,
  frameMsMean: 16.7,
  frameMsP95: 17,
  frameMsMax: 40,
  drawCallsMax: 30,
  trianglesMax: 5000,
};

describe('formatPerfHud', () => {
  it('writes the frames of the last second, their mean, the p95 and the pixel ratio', () => {
    expect(formatPerfHud(REPORT, 2)).toBe('60 FPS · 16.7 ms · p95 17.0 ms · DPR 2');
  });

  it('writes a fractional pixel ratio as it is, without float noise', () => {
    expect(formatPerfHud(REPORT, 1.5)).toContain('DPR 1.5');
    expect(formatPerfHud(REPORT, 1.2500000001)).toContain('DPR 1.25');
  });

  it('writes zeros before a whole second has passed', () => {
    const empty = { ...REPORT, fpsLastSecond: 0, frameMsMeanLastSecond: 0, frameMsP95: 0 };
    expect(formatPerfHud(empty, 1)).toBe('0 FPS · 0.0 ms · p95 0.0 ms · DPR 1');
  });
});

/** The little of the DOM the counter touches; the node environment has none. */
class FakeNode {
  className = '';
  attributes = new Map<string, string>();
  textWrites: string[] = [];
  isRemoved = false;
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  set textContent(value: string) {
    this.textWrites.push(value);
  }
  remove(): void {
    this.isRemoved = true;
  }
}

function createRoot() {
  const created: FakeNode[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const root = {
    append: (...nodes: unknown[]) => created.push(...(nodes as FakeNode[])),
    ownerDocument: {
      createElement: () => new FakeNode(),
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
      },
      removeEventListener: (type: string, listener: () => void) => {
        listeners.get(type)?.delete(listener);
      },
    },
  } as unknown as PerfHudRoot;
  return { root, created, listeners };
}

/** Feeds 60 FPS frames for `ms` of real time from `startAt`. */
function frames(host: ReturnType<typeof createFakeTestHost>, startAt: number, ms: number): number {
  let at = startAt;
  for (; at < startAt + ms; at += 1000 / 60) host.fireRenderedFrame(at);
  return at;
}

describe('installPerfHud', () => {
  it('adds one aria-hidden div.pp-debug-perf to the root', () => {
    const host = createFakeTestHost();
    const { root, created } = createRoot();
    installPerfHud(host, root);
    expect(created).toHaveLength(1);
    expect(created[0]?.className).toBe('pp-debug-perf');
    expect(created[0]?.attributes.get('aria-hidden')).toBe('true');
  });

  it('rewrites its text at most every PERF_HUD_REFRESH_MS, and only when it changed', () => {
    const host = createFakeTestHost();
    const { root, created } = createRoot();
    installPerfHud(host, root);
    const element = created[0] as FakeNode;
    // 3 s of 60 FPS frames: well over a dozen refresh slots, but the text settles after the first second.
    frames(host, 0, 3000);
    const writes = element.textWrites;
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.length).toBeLessThanOrEqual(Math.ceil(3000 / PERF_HUD_REFRESH_MS));
    for (let i = 1; i < writes.length; i++) expect(writes[i]).not.toBe(writes[i - 1]);
    expect(writes.at(-1)).toMatch(/^60 FPS · 16\.[67] ms · p95 16\.[78] ms · DPR 2$/);
  });

  it('writes nothing between two refresh slots', () => {
    const host = createFakeTestHost();
    const { root, created } = createRoot();
    installPerfHud(host, root);
    host.fireRenderedFrame(0);
    const element = created[0] as FakeNode;
    const before = element.textWrites.length;
    host.fireRenderedFrame(PERF_HUD_REFRESH_MS / 2);
    expect(element.textWrites).toHaveLength(before);
  });

  it('shows the pixel ratio of the frame', () => {
    const host = createFakeTestHost();
    const { root, created } = createRoot();
    installPerfHud(host, root);
    host.fireRenderedFrame(0, { pixelRatio: 1.5 });
    expect(created[0]?.textWrites.at(-1)).toContain('DPR 1.5');
  });

  it('starts its p95 over on a new level, and a hidden page adds no long frame', () => {
    const host = createFakeTestHost();
    const { root, created, listeners } = createRoot();
    installPerfHud(host, root);
    const element = created[0] as FakeNode;
    const end = frames(host, 0, 2000);
    // The page is hidden for 30 s, and comes back.
    for (const listener of listeners.get('visibilitychange') ?? []) listener();
    const back = end + 30_000;
    frames(host, back, 2000);
    expect(element.textWrites.at(-1)).not.toMatch(/p95 \d{2}\d+/);
    expect(element.textWrites.at(-1)).toMatch(/p95 1[67]\.\d ms/);
    // A new level: a slow first second would now own the p95.
    host.fireLevelStarted({} as never);
    let at = back + 10_000;
    for (let i = 0; i < 40; i++, at += 50) host.fireRenderedFrame(at);
    expect(element.textWrites.at(-1)).toMatch(/p95 50\.\d ms/);
  });

  it('removes the element and its listeners when told to', () => {
    const host = createFakeTestHost();
    const { root, created, listeners } = createRoot();
    const remove = installPerfHud(host, root);
    remove();
    expect(created[0]?.isRemoved).toBe(true);
    expect(listeners.get('visibilitychange')?.size).toBe(0);
    host.fireRenderedFrame(0);
    expect(created[0]?.textWrites).toEqual([]);
  });

  it('logs nothing at warn or above', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    installPerfHud(createFakeTestHost(), createRoot().root);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
