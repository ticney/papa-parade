import { log } from '@shared/log';
import { describe, expect, it } from 'vitest';
import { type ContextObject, contextObjectsOf, pickContextObject } from './contextObject.ts';

const COFFEE: ContextObject = { id: 'coffee_machine', xM: -3.6, zM: -2 };
const PHONE: ContextObject = { id: 'phone', xM: -1.3, zM: -1.2 };
const REACH_M = 1.5;

describe('pickContextObject', () => {
  it('picks the nearest object within reach', () => {
    expect(pickContextObject([COFFEE, PHONE], -3, -2, REACH_M)).toBe('coffee_machine');
    expect(pickContextObject([COFFEE, PHONE], -1.5, -1, REACH_M)).toBe('phone');
    expect(pickContextObject([PHONE, COFFEE], -2.3, -1.6, REACH_M)).toBe('phone');
  });

  it('picks none when every object is out of reach', () => {
    expect(pickContextObject([COFFEE, PHONE], 3, 3, REACH_M)).toBeNull();
  });

  it('counts the reach as inclusive', () => {
    const at = { id: 'x', xM: 1.5, zM: 0 };
    expect(pickContextObject([at], 0, 0, 1.5)).toBe('x');
    expect(pickContextObject([at], 0, 0, 1.4999)).toBeNull();
  });

  it('gives an exact tie to the earlier entry', () => {
    const a = { id: 'a', xM: 1, zM: 0 };
    const b = { id: 'b', xM: -1, zM: 0 };
    expect(pickContextObject([a, b], 0, 0, REACH_M)).toBe('a');
    expect(pickContextObject([b, a], 0, 0, REACH_M)).toBe('b');
  });

  it('picks none from an empty list', () => {
    expect(pickContextObject([], 0, 0, REACH_M)).toBeNull();
  });

  it('measures from Papa on the floor, so an object on Papa is picked', () => {
    expect(pickContextObject([PHONE], PHONE.xM, PHONE.zM, REACH_M)).toBe('phone');
  });
});

describe('contextObjectsOf', () => {
  const anchors = [
    { id: 'phone', positionM: [-1.3, 0.65, -1.2] as const },
    { id: 'coffee_machine', positionM: [-3.6, 1.05, -2] as const },
  ];

  it('puts each object at the floor point of its anchor, in the level order', () => {
    expect(
      contextObjectsOf(
        [
          { id: 'coffee_machine', anchor: 'coffee_machine' },
          { id: 'telephone', anchor: 'phone' },
        ],
        anchors,
      ),
    ).toEqual([
      { id: 'coffee_machine', xM: -3.6, zM: -2 },
      { id: 'telephone', xM: -1.3, zM: -1.2 },
    ]);
  });

  it('leaves out an object whose anchor the room lacks, and says so', () => {
    const before = log.buffer().length;
    expect(contextObjectsOf([{ id: 'kettle', anchor: 'kettle_spot' }], anchors)).toEqual([]);
    const warnings = log
      .buffer()
      .slice(before)
      .filter((entry) => entry.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/kettle.*kettle_spot/);
  });

  it('gives an empty list for a level with no objects', () => {
    expect(contextObjectsOf([], anchors)).toEqual([]);
  });
});
