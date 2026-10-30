import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHudLayer } from './hudLayer.ts';
import type { SequenceBar } from './sequenceBar.ts';

class FakeElement {
  className = '';
  dataset: Record<string, string> = {};
  hidden = false;
  inert = false;
  children: FakeElement[] = [];
  private readonly attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  addEventListener(): void {}
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('createHudLayer', () => {
  it('puts the gauges in the gauges zone, the timer in the timer zone and the pause button in the pause zone', () => {
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
      createElementNS: () => new FakeElement(),
    });
    const root = new FakeElement();
    const timer = new FakeElement();
    const gauges = new FakeElement();
    createHudLayer(root as unknown as HTMLElement, {
      t: (key) => key,
      onPausePress: () => {},
      gauges: gauges as unknown as HTMLElement,
      timer: timer as unknown as HTMLElement,
      sequenceBar: { attachTo: () => {} } as unknown as SequenceBar,
    });
    const row = root.children[0] as FakeElement;
    const zones = Object.fromEntries(row.children.map((zone) => [zone.dataset.ppZone, zone]));
    expect(Object.keys(zones)).toEqual(['gauges', 'timer', 'pause']);
    expect(zones.timer?.children).toEqual([timer]);
    expect(zones.gauges?.children).toEqual([gauges]);
    expect(zones.pause?.children).toHaveLength(1);
  });
});
