import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createGlyphChip } from './glyphChip.ts';

class FakeElement {
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  private text = '';
  textWrites = 0;
  get textContent(): string {
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.textWrites++;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }
}

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
  const chip = createGlyphChip(scene, doc);
  return { scene, chip, created };
}

const entry = (threatId: number, xM: number, yM: number, zM: number) => ({
  threatId,
  xM,
  yM,
  zM,
  icon: 'bolt' as const,
});

describe('createGlyphChip', () => {
  it('makes one chip: an aria-hidden anchor holding a span with the chip and label classes', () => {
    const { chip, created, scene } = build();
    expect(created).toHaveLength(2);
    const [anchor, span] = created as [FakeElement, FakeElement];
    expect(span.className).toBe('pp-glyph-chip pp-type-label');
    expect(anchor.className).toBe('pp-glyph-chip-anchor');
    expect(anchor.attributes.get('aria-hidden')).toBe('true');
    expect(anchor.children).toEqual([span]);
    expect(scene.children).toHaveLength(1);
    expect(chip.isVisible).toBe(false);
    expect(anchor.style.display).toBe('none');
  });

  it('shows at the icon point with the text, and hides', () => {
    const { chip, created, scene } = build();
    const [anchor, span] = created as [FakeElement, FakeElement];
    chip.showAt(entry(1, -3.95, 0.3, 0.5), 'Espace');
    expect(chip.isVisible).toBe(true);
    expect(span.textContent).toBe('Espace');
    expect(anchor.style.display).toBe('');
    expect(scene.children[0]?.visible).toBe(true);
    expect(scene.children[0]?.position.toArray()).toEqual([-3.95, 0.3, 0.5]);
    chip.hide();
    expect(chip.isVisible).toBe(false);
    expect(scene.children[0]?.visible).toBe(false);
    expect(anchor.style.display).toBe('none');
    chip.hide(); // hiding twice is nothing
    expect(chip.isVisible).toBe(false);
  });

  it('moves with the target: still one chip, at the new point', () => {
    const { chip, scene } = build();
    chip.showAt(entry(1, 1, 0.3, 2), 'A');
    chip.showAt(entry(2, -4, 0.5, 1), 'A');
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]?.position.toArray()).toEqual([-4, 0.5, 1]);
    expect(chip.isVisible).toBe(true);
  });

  it('writes the text only when it changes', () => {
    const { chip, created } = build();
    const span = created[1] as FakeElement;
    chip.showAt(entry(1, 0, 0, 0), 'Espace');
    chip.showAt(entry(1, 0, 0, 0), 'Espace');
    chip.showAt(entry(2, 1, 0, 0), 'Espace');
    expect(span.textWrites).toBe(1);
    chip.hide();
    chip.showAt(entry(2, 1, 0, 0), 'Espace');
    expect(span.textWrites).toBe(1);
    chip.showAt(entry(2, 1, 0, 0), '✕');
    expect(span.textWrites).toBe(2);
    expect(span.textContent).toBe('✕');
  });

  it('leaves the scene on dispose', () => {
    const { chip, scene } = build();
    chip.showAt(entry(1, 0, 0, 0), 'A');
    chip.dispose();
    expect(scene.children).toHaveLength(0);
    expect(chip.isVisible).toBe(false);
  });
});
