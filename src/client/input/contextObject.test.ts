import { describe, expect, it } from 'vitest';
import {
  type ContextObject,
  isKindInReach,
  pickContextObject,
  pickMessProp,
} from './contextObject.ts';

const COFFEE: ContextObject = {
  id: 'coffee_machine',
  kind: 'coffee_machine' as const,
  xM: -3.6,
  zM: -2,
};
const PHONE: ContextObject = { id: 'phone', kind: 'phone' as const, xM: -1.3, zM: -1.2 };
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
    const at = { id: 'x', kind: 'phone' as const, xM: 1.5, zM: 0 };
    expect(pickContextObject([at], 0, 0, 1.5)).toBe('x');
    expect(pickContextObject([at], 0, 0, 1.4999)).toBeNull();
  });

  it('gives an exact tie to the earlier entry', () => {
    const a = { id: 'a', kind: 'phone' as const, xM: 1, zM: 0 };
    const b = { id: 'b', kind: 'phone' as const, xM: -1, zM: 0 };
    expect(pickContextObject([a, b], 0, 0, REACH_M)).toBe('a');
    expect(pickContextObject([b, a], 0, 0, REACH_M)).toBe('b');
  });

  it('picks none from an empty list', () => {
    expect(pickContextObject([], 0, 0, REACH_M)).toBeNull();
  });

  it('measures from Papa on the floor, so an object on Papa is picked', () => {
    expect(pickContextObject([PHONE], PHONE.xM, PHONE.zM, REACH_M)).toBe('phone');
  });

  it('skips the objects of the skipped kind (a toilet while the baby is carried, story 4.3)', () => {
    const toilet: ContextObject = { id: 'toilet', kind: 'toilet', xM: -3, zM: -2 };
    expect(pickContextObject([toilet, COFFEE], -3, -2, REACH_M)).toBe('toilet');
    expect(pickContextObject([toilet, COFFEE], -3, -2, REACH_M, 'toilet')).toBe('coffee_machine');
    expect(pickContextObject([toilet], -3, -2, REACH_M, 'toilet')).toBeNull();
    expect(pickContextObject([toilet, COFFEE], -3, -2, REACH_M, null)).toBe('toilet');
  });
});

describe('isKindInReach', () => {
  const objects: ContextObject[] = [
    { id: 'coffee', kind: 'coffee_machine', xM: 0.5, zM: 0 },
    { id: 'door', kind: 'toilet', xM: 1.5, zM: 0 },
  ];

  it('asks every object of the kind, not the nearest object', () => {
    expect(isKindInReach(objects, 'toilet', 0, 0, 1.5)).toBe(true);
    expect(isKindInReach(objects, 'toilet', 0, 0, 1.49)).toBe(false);
    expect(isKindInReach(objects, 'coffee_machine', 0, 0, 0.5)).toBe(true);
  });

  it('is false for a kind the level does not have', () => {
    expect(isKindInReach(objects, 'phone', 0, 0, 10)).toBe(false);
    expect(isKindInReach([], 'toilet', 0, 0, 10)).toBe(false);
  });
});

describe('pickMessProp (story 3.5)', () => {
  const prop = (id: string, xM: number, zM: number, isMess = true) => ({ id, xM, zM, isMess });

  it('takes the nearest prop that is a mess within reach, ties to the earlier', () => {
    const props = [
      prop('far', 3, 0),
      prop('near', 1, 0),
      prop('same', 0, 1),
      prop('no', 0.2, 0, false),
    ];
    expect(pickMessProp(props, 0, 0, 1.5)).toBe('near');
    expect(pickMessProp([prop('b', 1, 0), prop('a', 0, 1)], 0, 0, 1.5)).toBe('b');
  });

  it('counts the reach as inclusive and returns null when nothing is in reach or no prop is a mess', () => {
    expect(pickMessProp([prop('edge', 1.5, 0)], 0, 0, 1.5)).toBe('edge');
    expect(pickMessProp([prop('out', 1.51, 0)], 0, 0, 1.5)).toBeNull();
    expect(pickMessProp([prop('tidy', 0.5, 0, false)], 0, 0, 1.5)).toBeNull();
    expect(pickMessProp([], 0, 0, 1.5)).toBeNull();
  });
});
