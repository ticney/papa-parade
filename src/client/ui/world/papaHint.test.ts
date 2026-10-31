import { PAPA_HINT_OFFSET_M } from '@shared/constants';
import { OrthographicCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { createPapaHint } from './papaHint.ts';
import type { VerbMetrics } from './verbMetrics.ts';

class FakeElement {
  // What three's CSS2DObject reads when it is removed from a scene.
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  textWrites: string[] = [];
  private text = '';
  get textContent(): string {
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.textWrites.push(value);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const PAPA = { xM: 2, zM: -1 };
const HOLD_MS = 1200;

function build(getMetrics?: () => VerbMetrics) {
  const created: FakeElement[] = [];
  const doc = {
    createElement: () => {
      const element = new FakeElement();
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement'>;
  const scene = new Scene();
  const hint = createPapaHint(
    scene,
    doc,
    (key) => (key === 'verb.put_down_first' ? 'PUT HIM DOWN' : key),
    getMetrics,
  );
  return { hint, element: created[0] as FakeElement, scene };
}

describe('createPapaHint', () => {
  it('is one hidden, aria-hidden element with the verb look, its text written once from the strings', () => {
    const { hint, element, scene } = build();
    expect(element.className).toBe('pp-papa-hint pp-threat-verb');
    expect(element.attributes.get('aria-hidden')).toBe('true');
    expect(element.textWrites).toEqual(['PUT HIM DOWN']);
    expect(element.style.display).toBe('none');
    expect(hint.isVisible).toBe(false);
    expect(scene.children).toHaveLength(1);
  });

  it('sits above the combo badge: higher than the badge’s own offset above Papa’s head', () => {
    const { scene } = build();
    expect(PAPA_HINT_OFFSET_M).toBeGreaterThan(0.3);
    expect(scene.children[0]?.position.y).toBeCloseTo(PAPA_HEIGHT_M + PAPA_HINT_OFFSET_M, 9);
  });

  it('shows for holdMs of real time, follows Papa, then hides', () => {
    const { hint, element, scene } = build();
    hint.show(HOLD_MS, 1000);
    expect(hint.isVisible).toBe(true);
    expect(element.style.display).toBe('');
    hint.update(PAPA, 1500);
    expect(scene.children[0]?.position.x).toBe(PAPA.xM);
    expect(scene.children[0]?.position.z).toBe(PAPA.zM);
    hint.update({ xM: 5, zM: 6 }, 2199);
    expect(hint.isVisible).toBe(true);
    expect(scene.children[0]?.position.x).toBe(5);
    hint.update(PAPA, 2200);
    expect(hint.isVisible).toBe(false);
    expect(element.style.display).toBe('none');
  });

  it('restarts the hold on a second refusal instead of stacking, and writes no text again', () => {
    const { hint, element } = build();
    hint.show(HOLD_MS, 1000);
    hint.update(PAPA, 2000);
    hint.show(HOLD_MS, 2000);
    hint.update(PAPA, 2300); // past the first hold's end (2200)
    expect(hint.isVisible).toBe(true);
    hint.update(PAPA, 3200);
    expect(hint.isVisible).toBe(false);
    expect(element.textWrites).toEqual(['PUT HIM DOWN']);
  });

  it('hides at once when Papa has no pose, and does not come back by itself', () => {
    const { hint } = build();
    hint.show(HOLD_MS, 0);
    hint.update(null, 10);
    expect(hint.isVisible).toBe(false);
    hint.update(PAPA, 20);
    expect(hint.isVisible).toBe(false);
  });

  it('writes the display only when it changes', () => {
    const { hint, element } = build();
    let writes = 0;
    let display = element.style.display;
    Object.defineProperty(element.style, 'display', {
      get: () => display,
      set: (value: string) => {
        writes++;
        display = value;
      },
    });
    for (let t = 0; t < 5; t++) hint.update(PAPA, t); // nothing shown: nothing written
    expect(writes).toBe(0);
    hint.show(HOLD_MS, 0);
    hint.show(HOLD_MS, 10);
    for (let t = 20; t < 100; t += 20) hint.update(PAPA, t);
    expect(writes).toBe(1);
  });

  describe('fit and layout (story 2.10 review)', () => {
    const state = { scale: 1 };
    /** Every character is half the font size wide: 'PUT HIM DOWN' is 12 characters. */
    const metrics: VerbMetrics = {
      surfaceKey: () => 'regular',
      basePx: () => 40,
      lineHeight: () => 1,
      scale: () => state.scale,
      widthPx: (text, fontPx) => text.length * fontPx * 0.5,
    };
    const camera = (): OrthographicCamera => {
      // One world unit is 100 px: x → 400 + 100x on a 800 px layer.
      const cam = new OrthographicCamera(-4, 4, 2, -2, 0.1, 100);
      cam.position.set(0, 0, 10);
      cam.updateMatrixWorld();
      return cam;
    };
    const buildFitted = () => {
      const made = build(() => metrics);
      state.scale = 1;
      return made;
    };

    it('measures nothing until the hint is shown, then fits it to the layer', () => {
      const reads: string[] = [];
      const spy: VerbMetrics = {
        ...metrics,
        basePx: () => {
          reads.push('base');
          return 40;
        },
      };
      const { hint, element } = build(() => spy);
      hint.refit(500);
      expect(reads).toEqual([]);
      hint.show(HOLD_MS, 0);
      // 12 characters at 40 px are 240 px, over 45 % of 500 less the outline (215): the font shrinks.
      expect(element.style.fontSize).toBe(`${(40 * 215) / 240}px`);
    });

    it('keeps the font when it fits, and grows it with « Grands verbes »', () => {
      const { hint, element } = buildFitted();
      hint.refit(800);
      hint.show(HOLD_MS, 0);
      expect(element.style.fontSize).toBe('40px');
      state.scale = 1.25;
      hint.refit(800);
      expect(element.style.fontSize).toBe('50px');
    });

    it('shifts the hint back inside the layer at an edge, and lets go in the middle', () => {
      const { hint, element, scene } = buildFitted();
      hint.refit(800);
      hint.show(HOLD_MS, 0);
      // The box is 12 * 20 + 10 = 250 px wide. Papa at x = -3.9 puts its centre at 10 px.
      hint.update({ xM: -3.9, zM: 0 }, 10);
      hint.layout(camera());
      const shift = Number.parseInt(element.style.marginLeft as string, 10);
      expect(shift).toBeGreaterThanOrEqual(115);
      expect(shift).toBeLessThanOrEqual(116);
      hint.update({ xM: 0, zM: 0 }, 20);
      hint.layout(camera());
      expect(element.style.marginLeft).toBe('');
      expect(scene.children[0]?.position.x).toBe(0);
    });

    it('does not lay out a hidden hint, nor one that was never measured', () => {
      const { hint, element } = buildFitted();
      hint.refit(800);
      hint.layout(camera());
      expect(element.style.marginLeft).toBeUndefined();
      const bare = build();
      bare.hint.show(HOLD_MS, 0);
      bare.hint.update({ xM: -3.9, zM: 0 }, 10);
      bare.hint.layout(camera());
      expect(bare.element.style.marginLeft).toBeUndefined();
    });
  });

  it('hide() clears it, and dispose() takes it out of the scene', () => {
    const { hint, scene } = build();
    hint.show(HOLD_MS, 0);
    hint.hide();
    expect(hint.isVisible).toBe(false);
    hint.show(HOLD_MS, 0);
    hint.dispose();
    expect(hint.isVisible).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
});
