import { readFileSync } from 'node:fs';
import { EPIC_STAMP_MAX_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createEpicStamp, EPIC_STAMP_CLASS } from './epicStamp.ts';

/** The few things of the DOM that the stamp touches. */
class FakeElement {
  className = '';
  textContent = '';
  readonly attributes = new Map<string, string>();
  readonly animations: {
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancelled: boolean;
  }[] = [];
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
    const record = { keyframes, options, cancelled: false };
    this.animations.push(record);
    return {
      cancel: () => {
        record.cancelled = true;
      },
    } as unknown as Animation;
  }
}

function setup() {
  let created = 0;
  const doc = {
    createElement: () => {
      created++;
      return new FakeElement();
    },
  } as unknown as Document;
  const stamp = createEpicStamp(doc, { text: 'PARADE PARFAITE' });
  return { stamp, element: stamp.element as unknown as FakeElement, created: () => created };
}

describe('createEpicStamp', () => {
  it('creates one overlay in the Epic register with the text, hidden from assistive tech', () => {
    const { element, created } = setup();
    expect(created()).toBe(1);
    expect(element.className.split(' ')).toContain(EPIC_STAMP_CLASS);
    expect(element.className).toContain('pp-type-epic');
    expect(element.className).toContain('pp-stroked');
    expect(element.textContent).toBe('PARADE PARFAITE');
    expect(element.attributes.get('aria-hidden')).toBe('true');
  });

  it('stamps in real ms: scale and tilt in, a hold, a fade out over the last quarter', () => {
    const { stamp, element } = setup();
    expect(stamp.show(800, false)).toBe(true);
    const [animation] = element.animations;
    expect(animation?.options.duration).toBe(800);
    const keyframes = animation?.keyframes ?? [];
    expect(keyframes.map((frame) => frame.offset)).toEqual([0, 0.15, 0.75, 1]);
    expect(keyframes.map((frame) => frame.opacity)).toEqual([0, 1, 1, 0]);
    expect(String(keyframes[0]?.transform)).toContain('scale(1.35)');
    expect(String(keyframes[1]?.transform)).toContain('scale(1)');
    expect(String(keyframes[0]?.transform)).toContain('rotate');
  });

  it('keeps the offsets in time: the whole animation is linear, only the scale-in eases', () => {
    const { stamp, element } = setup();
    stamp.show(800, false);
    const [animation] = element.animations;
    expect(animation?.options.easing).toBe('linear');
    expect(animation?.keyframes[0]?.easing).toBe('ease-out');
    expect(animation?.keyframes.slice(1).every((frame) => frame.easing === undefined)).toBe(true);
  });

  it('never lasts longer than the UX ceiling, whatever it is asked', () => {
    const { stamp, element } = setup();
    stamp.show(5000, false);
    expect(element.animations[0]?.options.duration).toBe(EPIC_STAMP_MAX_MS);
    stamp.show(400, false);
    expect(element.animations[1]?.options.duration).toBe(400);
  });

  it('is a plain fade in and out under reduced motion: no scale, no tilt', () => {
    const { stamp, element } = setup();
    stamp.show(800, true);
    const keyframes = element.animations[0]?.keyframes ?? [];
    expect(keyframes.map((frame) => frame.opacity)).toEqual([0, 1, 1, 0]);
    expect(keyframes.every((frame) => frame.transform === undefined)).toBe(true);
    expect(element.animations[0]?.options.duration).toBe(800);
  });

  it('cancel ends the stamp under way, and is harmless with none', () => {
    const { stamp, element } = setup();
    expect(() => stamp.cancel()).not.toThrow();
    stamp.show(800, false);
    stamp.cancel();
    expect(element.animations[0]?.cancelled).toBe(true);
    expect(() => stamp.cancel()).not.toThrow();
  });

  it('restarts: the previous animation is cancelled, and there is still one element', () => {
    const { stamp, element, created } = setup();
    stamp.show(800, false);
    stamp.show(800, false);
    expect(element.animations[0]?.cancelled).toBe(true);
    expect(element.animations[1]?.cancelled).toBe(false);
    expect(created()).toBe(1);
  });
});

describe('ui.css › .pp-epic-stamp', () => {
  const css = readFileSync(new URL('../styles/ui.css', import.meta.url), 'utf8');
  const rule = /\.pp-epic-stamp\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('never takes a tap or focus, is hidden when idle, and sits above the flash', () => {
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('opacity: 0');
    expect(rule).toContain('position: fixed');
    const zIndex = Number(/z-index:\s*(\d+)/.exec(rule)?.[1]);
    const flash = Number(/\.pp-screen-flash\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
    expect(zIndex).toBeGreaterThan(flash);
  });

  it('keeps the bottom third free and fits the width', () => {
    expect(rule).toMatch(/top:\s*\d+%/);
    expect(rule).toContain('max-width');
  });
});
