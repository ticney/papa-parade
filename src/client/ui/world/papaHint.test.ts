import { PAPA_HINT_OFFSET_M } from '@shared/constants';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { PAPA_HEIGHT_M } from '../../render/views/papaView.ts';
import { createPapaHint } from './papaHint.ts';

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

function build() {
  const created: FakeElement[] = [];
  const doc = {
    createElement: () => {
      const element = new FakeElement();
      created.push(element);
      return element;
    },
  } as unknown as Pick<Document, 'createElement'>;
  const scene = new Scene();
  const hint = createPapaHint(scene, doc, (key) =>
    key === 'verb.put_down_first' ? 'PUT HIM DOWN' : key,
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
