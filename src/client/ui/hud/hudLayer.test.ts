import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHudLayer } from './hudLayer.ts';

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
  it('puts the timer in the timer zone, the pause button in the pause zone, and nothing in the gauges', () => {
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
      createElementNS: () => new FakeElement(),
    });
    const root = new FakeElement();
    const timer = new FakeElement();
    createHudLayer(root as unknown as HTMLElement, {
      t: (key) => key,
      onPausePress: () => {},
      timer: timer as unknown as HTMLElement,
    });
    const row = root.children[0] as FakeElement;
    const zones = Object.fromEntries(row.children.map((zone) => [zone.dataset.ppZone, zone]));
    expect(Object.keys(zones)).toEqual(['gauges', 'timer', 'pause']);
    expect(zones.timer?.children).toEqual([timer]);
    expect(zones.gauges?.children).toEqual([]);
    expect(zones.pause?.children).toHaveLength(1);
  });
});
