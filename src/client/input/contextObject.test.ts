import { describe, expect, it } from 'vitest';
import { type ContextObject, pickContextObject } from './contextObject.ts';

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
