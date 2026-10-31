import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createGlyphChip } from './glyphChip.ts';

class FakeElement {
  ownerDocument = { defaultView: { Element: FakeElement } };
  parentNode: unknown = null;
  className = '';
  style: Record<string, unknown> = {
    setProperty: (name: string, value: string) => {
      this.vars.set(name, value);
    },
    removeProperty: (name: string) => {
      this.vars.delete(name);
    },
  };
  /** The custom properties written with `style.setProperty`. */
  vars = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, force: boolean) => {
      if (force) this.classes.add(name);
      else this.classes.delete(name);
      return force;
    },
  };
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
  followsPapa: false,
  verb: '',
  iconShape: 'circle' as const,
  color: 'parry' as const,
  verbWidthPx: 0,
  verbHeightPx: 0,
  verbOffsetPx: 0,
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

describe('createGlyphChip beside the verb (story 2.2)', () => {
  const BESIDE = 'pp-glyph-chip-anchor--beside-verb';
  /** An entry whose verb box has been laid out: 200 px wide, 50 high, pushed up by 54 px. */
  const withVerb = (offsetPx = 0) => ({
    ...entry(1, 0, 0.3, 0),
    verb: 'SOULÈVE !',
    verbWidthPx: 200,
    verbHeightPx: 50,
    verbOffsetPx: offsetPx,
  });

  it('hangs from half the verb width and rises to the middle of the verb', () => {
    const { chip, created } = build();
    const anchor = created[0] as FakeElement;
    chip.showAt(withVerb(), 'Espace');
    expect(anchor.classes.has(BESIDE)).toBe(true);
    expect(anchor.vars.get('--pp-chip-half')).toBe('100px');
    expect(anchor.vars.get('--pp-chip-rise')).toBe('25px');
  });

  it('follows the verb when it is pushed up by the layout', () => {
    const { chip, created } = build();
    const anchor = created[0] as FakeElement;
    const target = withVerb(0);
    chip.showAt(target, 'Espace');
    target.verbOffsetPx = 54;
    // The layout runs after `showAt`, in `worldUi.render`: `refresh` moves the chip in the same frame.
    chip.refresh();
    expect(anchor.vars.get('--pp-chip-rise')).toBe('79px');
  });

  it('goes with a verb that was shifted sideways to stay on screen, and lets go of it', () => {
    const { chip, created } = build();
    const anchor = created[0] as FakeElement;
    const target = { ...withVerb(), verbShiftXPx: 45 };
    chip.showAt(target, 'Espace');
    expect(anchor.vars.get('--pp-chip-shift')).toBe('45px');
    target.verbShiftXPx = 0;
    chip.refresh();
    expect(anchor.vars.has('--pp-chip-shift')).toBe(false);
    // An entry that never had a shift writes nothing.
    chip.showAt(withVerb(), 'Espace');
    expect(anchor.vars.has('--pp-chip-shift')).toBe(false);
  });

  it('stays beside the icon for an entry with no verb, and leaves no variable behind', () => {
    const { chip, created } = build();
    const anchor = created[0] as FakeElement;
    chip.showAt(withVerb(), 'Espace');
    chip.showAt(entry(2, 1, 0.3, 1), 'Espace');
    expect(anchor.classes.has(BESIDE)).toBe(false);
    expect(anchor.vars.has('--pp-chip-half')).toBe(false);
    expect(anchor.vars.has('--pp-chip-rise')).toBe(false);
  });

  it('writes a variable only when the verb box changes', () => {
    const { chip, created } = build();
    const anchor = created[0] as FakeElement;
    let writes = 0;
    const setProperty = anchor.style.setProperty as (name: string, value: string) => void;
    anchor.style.setProperty = (name: string, value: string) => {
      writes++;
      setProperty(name, value);
    };
    const target = withVerb(0);
    chip.showAt(target, 'Espace');
    expect(writes).toBe(2);
    for (let frame = 0; frame < 5; frame++) {
      chip.showAt(target, 'Espace');
      chip.refresh();
    }
    expect(writes).toBe(2);
  });

  it('refresh does nothing while hidden, and nothing after hide', () => {
    const { chip, created } = build();
    const anchor = created[0] as FakeElement;
    const target = withVerb(0);
    chip.refresh();
    expect(anchor.vars.size).toBe(0);
    chip.showAt(target, 'Espace');
    chip.hide();
    target.verbOffsetPx = 80;
    chip.refresh();
    expect(anchor.vars.get('--pp-chip-rise')).toBe('25px');
    expect(chip.isVisible).toBe(false);
  });

  it('still moves to the point of the target', () => {
    const { chip, scene } = build();
    chip.showAt(withVerb(), 'Espace');
    expect(scene.children[0]?.position.toArray()).toEqual([0, 0.3, 0]);
  });
});
