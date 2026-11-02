import { type Logger, log } from '@shared/log';
import type { World } from '@sim';
import { DataTexture, Group, Sprite, type SpriteMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTE } from '../materials/palette.ts';
import { createDangerTint, dangerTintOpacity } from './dangerTint.ts';

const LOOK = { radiusM: 0.5, minOpacityPct: 40, peakOpacityPct: 80, pulseHz: 2 };
const ANCHORS = [
  { id: 'outlet_01', positionM: [-3, 0.3, 0.5] as [number, number, number] },
  { id: 'coffee_table', positionM: [0.5, 0.45, -0.6] as [number, number, number] },
];

const worldWith = (...threats: { state: string; defId: string; anchorId: string }[]) =>
  ({ threats }) as unknown as Readonly<World>;

function build() {
  const parent = new Group();
  const tint = createDangerTint(parent, ANCHORS, LOOK, new DataTexture(), ['outlet', 'table']);
  const sprite = (name: string) => parent.getObjectByName(`danger_tint_${name}`) as Sprite;
  return { parent, tint, sprite };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDangerTint', () => {
  it('stands an unlit alert sprite on the real point, drawn over the furniture, hidden at first', () => {
    const { sprite, tint } = build();
    const outlet = sprite('outlet_01');
    expect(outlet).toBeInstanceOf(Sprite);
    expect(outlet.position.toArray()).toEqual([-3, 0.3, 0.5]);
    expect(outlet.visible).toBe(false);
    expect(outlet.scale.x).toBe(1);
    const material = outlet.material as SpriteMaterial;
    expect(material.color.getHex()).toBe(PALETTE.alert);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(tint.shownCount).toBe(0);
    expect(PALETTE.alert).toBe(0xffc21a);
  });

  it.each(['telegraph', 'windowOpen'])('shows the glow while the threat is %s', (state) => {
    const { sprite, tint } = build();
    tint.update(worldWith({ state, defId: 'outlet', anchorId: 'outlet_01' }), 0, false);
    expect(sprite('outlet_01').visible).toBe(true);
    expect(sprite('coffee_table').visible).toBe(false);
    expect(tint.shownCount).toBe(1);
  });

  it.each(['idle', 'hidden', 'resolved', 'gag'])('shows nothing while it is %s', (state) => {
    const { tint } = build();
    tint.update(worldWith({ state, defId: 'outlet', anchorId: 'outlet_01' }), 0, false);
    expect(tint.shownCount).toBe(0);
  });

  it('goes when the threat leaves those states', () => {
    const { sprite, tint } = build();
    tint.update(
      worldWith({ state: 'telegraph', defId: 'outlet', anchorId: 'outlet_01' }),
      0,
      false,
    );
    tint.update(
      worldWith({ state: 'resolved', defId: 'outlet', anchorId: 'outlet_01' }),
      16,
      false,
    );
    expect(sprite('outlet_01').visible).toBe(false);
    expect(tint.shownCount).toBe(0);
  });

  it('shows nothing for a threat that does not aim at an anchor: a wake and a false alarm alike', () => {
    const { tint } = build();
    tint.update(
      worldWith(
        { state: 'telegraph', defId: 'real_wake', anchorId: 'outlet_01' },
        { state: 'windowOpen', defId: 'false_alarm_sigh', anchorId: 'coffee_table' },
      ),
      0,
      false,
    );
    expect(tint.shownCount).toBe(0);
  });

  it('counts two threats on one anchor as one glow', () => {
    const { tint } = build();
    tint.update(
      worldWith(
        { state: 'telegraph', defId: 'outlet', anchorId: 'outlet_01' },
        { state: 'telegraph', defId: 'table', anchorId: 'outlet_01' },
      ),
      0,
      false,
    );
    expect(tint.shownCount).toBe(1);
  });

  it('warns once for an anchor the level lacks, and shows nothing', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation((() => {}) as Logger['warn']);
    const { tint } = build();
    const world = worldWith({ state: 'telegraph', defId: 'outlet', anchorId: 'nowhere' });
    tint.update(world, 0, false);
    tint.update(world, 16, false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(tint.shownCount).toBe(0);
  });

  it('holds its opacity when the clock stands still (a pause)', () => {
    const { sprite, tint } = build();
    const world = worldWith({ state: 'telegraph', defId: 'outlet', anchorId: 'outlet_01' });
    tint.update(world, 60, false);
    const held = sprite('outlet_01').material.opacity;
    tint.update(world, 60, false);
    expect(sprite('outlet_01').material.opacity).toBe(held);
    tint.update(world, 200, false);
    expect(sprite('outlet_01').material.opacity).not.toBe(held);
  });

  it('holds steady under reduced motion', () => {
    const { sprite, tint } = build();
    const world = worldWith({ state: 'telegraph', defId: 'outlet', anchorId: 'outlet_01' });
    for (const clockMs of [0, 60, 125, 400]) {
      tint.update(world, clockMs, true);
      expect(sprite('outlet_01').material.opacity).toBeCloseTo(0.8, 6);
    }
  });

  it('resets and frees', () => {
    const { parent, sprite, tint } = build();
    tint.update(
      worldWith({ state: 'telegraph', defId: 'outlet', anchorId: 'outlet_01' }),
      0,
      false,
    );
    tint.reset();
    expect(sprite('outlet_01').visible).toBe(false);
    expect(tint.shownCount).toBe(0);
    const material = sprite('outlet_01').material;
    const dispose = vi.spyOn(material, 'dispose');
    tint.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
  });
});

describe('dangerTintOpacity', () => {
  it('runs between its low and its top, at pulseHz on the clock', () => {
    expect(dangerTintOpacity(LOOK, 125, false)).toBeCloseTo(0.8, 6); // a quarter of a 500 ms cycle: the top
    expect(dangerTintOpacity(LOOK, 375, false)).toBeCloseTo(0.4, 6); // three quarters: the low
    expect(dangerTintOpacity(LOOK, 625, false)).toBeCloseTo(0.8, 6); // one cycle later
  });
});
