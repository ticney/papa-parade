import { describe, expect, it } from 'vitest';
import { createStartGesture, type StartPointerEvent } from './startGesture.ts';

const touch = (pointerId = 1): StartPointerEvent => ({
  isPrimary: true,
  pointerType: 'touch',
  button: 0,
  pointerId,
});

describe('createStartGesture', () => {
  it('does not start on a lone pointerup (the tail of a gesture begun before the screen)', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerUp(touch());
    expect(starts).toBe(0);
  });

  it('starts on a pointerup whose pointerdown it saw, once the pointerup comes', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerDown(touch());
    expect(starts).toBe(0);
    gesture.onPointerUp(touch());
    expect(starts).toBe(1);
  });

  it('needs the same pointer: another finger lifting does not start it', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerDown(touch(1));
    gesture.onPointerUp(touch(2));
    expect(starts).toBe(0);
    gesture.onPointerUp(touch(1));
    expect(starts).toBe(1);
  });

  it('ignores a non-primary pointer', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    const second = { ...touch(2), isPrimary: false };
    gesture.onPointerDown(second);
    gesture.onPointerUp(second);
    expect(starts).toBe(0);
  });

  it('starts on the left button of a mouse only', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    const mouse = (button: number): StartPointerEvent => ({
      isPrimary: true,
      pointerType: 'mouse',
      button,
      pointerId: 1,
    });
    gesture.onPointerDown(mouse(2));
    gesture.onPointerUp(mouse(2));
    expect(starts).toBe(0);
    gesture.onPointerDown(mouse(0));
    gesture.onPointerUp(mouse(0));
    expect(starts).toBe(1);
  });

  it('forgets a pointerdown once it has started, so a second lone pointerup does nothing', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerDown(touch());
    gesture.onPointerUp(touch());
    gesture.onPointerUp(touch());
    expect(starts).toBe(1);
  });

  it('follows the latest pointerdown', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerDown(touch(1));
    gesture.onPointerDown(touch(3));
    gesture.onPointerUp(touch(1));
    expect(starts).toBe(0);
    gesture.onPointerUp(touch(3));
    expect(starts).toBe(1);
  });

  it('forgets a pointerdown that was cancelled: a later pointerup of that pointer does not start', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerDown(touch(1));
    gesture.onPointerCancel(touch(1));
    gesture.onPointerUp(touch(1));
    expect(starts).toBe(0);
  });

  it('keeps the pointerdown of another pointer when one is cancelled', () => {
    let starts = 0;
    const gesture = createStartGesture(() => starts++);
    gesture.onPointerDown(touch(1));
    gesture.onPointerCancel(touch(2));
    gesture.onPointerUp(touch(1));
    expect(starts).toBe(1);
  });
});
