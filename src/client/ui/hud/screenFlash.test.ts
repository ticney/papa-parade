import { readFileSync } from 'node:fs';
import { SCREEN_FLASH_MIN_INTERVAL_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createScreenFlash, SCREEN_FLASH_CLASSES } from './screenFlash.ts';

/** The few things of the DOM that the flash touches. */
class FakeElement {
  className = '';
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly animations: {
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancelled: boolean;
  }[] = [];
  readonly classList = {
    toggle: (name: string, force: boolean): void => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
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
  let nowReal = 1000;
  const doc = { createElement: () => new FakeElement() } as unknown as Document;
  const flash = createScreenFlash(doc, { nowReal: () => nowReal });
  return {
    flash,
    element: flash.element as unknown as FakeElement,
    advance: (ms: number) => {
      nowReal += ms;
    },
  };
}

describe('createScreenFlash', () => {
  it('creates one overlay, hidden from assistive tech', () => {
    const { element } = setup();
    expect(element.className).toBe(SCREEN_FLASH_CLASSES.root);
    expect(element.attributes.get('aria-hidden')).toBe('true');
  });

  it('fades from the peak opacity to 0 over the given real ms', () => {
    const { flash, element } = setup();
    expect(flash.flash(35, 180, false)).toBe(true);
    const [animation] = element.animations;
    expect(animation?.keyframes).toEqual([{ opacity: 0.35 }, { opacity: 0 }]);
    expect(animation?.options.duration).toBe(180);
  });

  it('shows a border glow instead under reduced motion, with the same peak and duration', () => {
    const { flash, element, advance } = setup();
    flash.flash(35, 180, true);
    expect(element.classes.has(SCREEN_FLASH_CLASSES.glow)).toBe(true);
    expect(element.animations[0]?.keyframes).toEqual([{ opacity: 0.35 }, { opacity: 0 }]);
    expect(element.animations[0]?.options.duration).toBe(180);
    advance(SCREEN_FLASH_MIN_INTERVAL_MS);
    flash.flash(35, 180, false);
    expect(element.classes.has(SCREEN_FLASH_CLASSES.glow)).toBe(false);
  });

  it('skips a flash that starts less than 334 real ms after the previous one', () => {
    const { flash, element, advance } = setup();
    expect(SCREEN_FLASH_MIN_INTERVAL_MS).toBe(334);
    expect(flash.flash(35, 180, false)).toBe(true);
    advance(SCREEN_FLASH_MIN_INTERVAL_MS - 1);
    expect(flash.flash(35, 180, false)).toBe(false);
    expect(element.animations).toHaveLength(1);
    // The skipped flash did not move the window: 334 ms after the first one it plays.
    advance(1);
    expect(flash.flash(35, 180, false)).toBe(true);
    expect(element.animations).toHaveLength(2);
  });

  it('cancels the previous fade before it starts a new one', () => {
    const { flash, element, advance } = setup();
    flash.flash(35, 180, false);
    advance(SCREEN_FLASH_MIN_INTERVAL_MS);
    flash.flash(20, 100, false);
    expect(element.animations[0]?.cancelled).toBe(true);
    expect(element.animations[1]?.cancelled).toBe(false);
  });

  it('plays the very first flash whatever the clock says', () => {
    const { flash } = setup();
    expect(flash.flash(35, 180, false)).toBe(true);
  });
});

describe('ui.css › .pp-screen-flash', () => {
  const css = readFileSync(new URL('../styles/ui.css', import.meta.url), 'utf8');
  const rule = /\.pp-screen-flash\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('covers the screen, never takes a tap, and uses the paper token', () => {
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('inset: 0');
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('var(--pp-color-paper)');
  });
});
