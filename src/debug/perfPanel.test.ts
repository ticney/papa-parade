import { log } from '@shared/log';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FakeElement } from '../../tests/support/fakeDom.ts';
import { fakeDocument } from '../../tests/support/fakeDom.ts';
import { createFakeTestHost } from '../../tests/support/fakeTestHost.ts';
import { createPerfPanel } from './perfPanel.ts';

beforeAll(() => {
  log.setLevel('error');
});

function rig() {
  const measures: (null | (() => number))[] = [];
  const host = createFakeTestHost({
    levelSession: {
      active: null,
      loopStats: null,
      setLoopMeasure: (measure: (() => number) | null) => measures.push(measure),
    } as never,
  });
  let pre: FakeElement | null = null;
  const root = {
    append: () => {},
    ownerDocument: {
      createElement: (tag: string) => {
        const element = fakeDocument.createElement(tag);
        pre = element as unknown as FakeElement;
        return element;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
  const clock = () => 0;
  const panel = createPerfPanel(host, root as never, clock);
  const text = (): string => (pre as FakeElement | null)?.textContent ?? '';
  /** `count` frames, one every `intervalMs`, from `fromAtReal`; returns the time after the last. */
  const frames = (fromAtReal: number, count: number, intervalMs: number): number => {
    let at = fromAtReal;
    for (let i = 0; i < count; i++) {
      host.fireRenderedFrame(at);
      at += intervalMs;
    }
    return at;
  };
  return { host, panel, measures, clock, text, frames };
}

describe('createPerfPanel', () => {
  it('measures and writes only while active', () => {
    const { panel, text, frames, measures, clock } = rig();
    frames(0, 80, 16.7);
    expect(text()).toBe('');
    panel.setActive(true);
    expect(measures).toEqual([clock]);
    frames(2000, 80, 16.7);
    expect(text()).toMatch(/^60 FPS · frame every 16\.7 ms/);
    const written = text();
    panel.setActive(false);
    expect(measures).toEqual([clock, null]);
    frames(4000, 80, 40);
    expect(text()).toBe(written);
  });

  it('starts the meter afresh when it is opened again: the closed time is not a long frame', () => {
    const { panel, text, frames } = rig();
    panel.setActive(true);
    const end = frames(0, 80, 16.7);
    panel.setActive(false);
    panel.setActive(true);
    // Five seconds later: the first frame after the reopening has no previous frame to measure from.
    frames(end + 5000, 1, 16.7);
    expect(text()).toMatch(/^0 FPS · frame every 0\.0 ms \(p95 0\.0, max 0\.0\)/);
  });

  it('puts the loop clock back to none on dispose', () => {
    const { panel, measures } = rig();
    panel.setActive(true);
    panel.dispose();
    expect(measures.at(-1)).toBeNull();
  });
});
