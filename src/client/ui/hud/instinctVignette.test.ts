import { describe, expect, it } from 'vitest';
import { createInstinctVignette, INSTINCT_VIGNETTE_CLASSES } from './instinctVignette.ts';

/** The few things of the DOM that the vignette touches; it counts the writes of `className`. */
class FakeElement {
  classWrites = 0;
  private name = '';
  readonly attributes = new Map<string, string>();
  get className(): string {
    return this.name;
  }
  set className(value: string) {
    this.name = value;
    this.classWrites++;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function setup() {
  const doc = { createElement: () => new FakeElement() } as unknown as Document;
  const vignette = createInstinctVignette(doc);
  const element = vignette.element as unknown as FakeElement;
  return { vignette, element, writesAtStart: element.classWrites };
}

describe('the instinct vignette (story 2.9)', () => {
  it('is hidden from assistive technology and starts off', () => {
    const { element } = setup();
    expect(element.attributes.get('aria-hidden')).toBe('true');
    expect(element.className).toBe(INSTINCT_VIGNETTE_CLASSES.root);
    expect(element.className).not.toContain(INSTINCT_VIGNETTE_CLASSES.on);
  });

  it('gets its on class while active and loses it when not', () => {
    const { vignette, element } = setup();
    vignette.update(true);
    expect(element.className).toBe(
      `${INSTINCT_VIGNETTE_CLASSES.root} ${INSTINCT_VIGNETTE_CLASSES.on}`,
    );
    vignette.update(false);
    expect(element.className).toBe(INSTINCT_VIGNETTE_CLASSES.root);
  });

  it('writes the DOM only when the state changes', () => {
    const { vignette, element, writesAtStart } = setup();
    for (let i = 0; i < 100; i++) vignette.update(false);
    expect(element.classWrites).toBe(writesAtStart);
    for (let i = 0; i < 100; i++) vignette.update(true);
    expect(element.classWrites).toBe(writesAtStart + 1);
    for (let i = 0; i < 100; i++) vignette.update(false);
    expect(element.classWrites).toBe(writesAtStart + 2);
  });

  it('has the classes the stylesheet uses', () => {
    expect(INSTINCT_VIGNETTE_CLASSES).toEqual({
      root: 'pp-instinct-vignette',
      on: 'pp-instinct-vignette-on',
    });
  });
});
