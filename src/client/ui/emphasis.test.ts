import { describe, expect, it } from 'vitest';
import { appendEmphasizedText, emphasisSegmentsOf } from './emphasis.ts';

// The little of the DOM the helper uses; the node environment has none.
class FakeNode {
  readonly children: FakeNode[] = [];
  readonly tag: string;
  private readonly ownText: string;
  constructor(tag: string, ownText = '') {
    this.tag = tag;
    this.ownText = ownText;
  }
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }
  get textContent(): string {
    return this.children.length > 0
      ? this.children.map((child) => child.textContent).join('')
      : this.ownText;
  }
}
const doc = {
  createElement: (tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => new FakeNode('#text', text),
};
const render = (text: string) => {
  const parent = new FakeNode('span');
  appendEmphasizedText(parent as never, text, doc as never);
  return parent;
};
/** `Encore` in an em, then the rest: `[em]Encore[/em] l'escalier ?!` as strings. */
const shapeOf = (parent: FakeNode): string[] =>
  parent.children.map((child) =>
    child.tag === 'em' ? `<em>${child.textContent}</em>` : child.textContent,
  );

describe('emphasisSegmentsOf (story 3.8, AC 9)', () => {
  it('cuts a line at its asterisks and never keeps them', () => {
    expect(emphasisSegmentsOf("*Encore* l'escalier ?!")).toEqual([
      { text: 'Encore', isEmphasized: true },
      { text: " l'escalier ?!", isEmphasized: false },
    ]);
  });

  it('leaves a line with no asterisk as one plain run', () => {
    expect(emphasisSegmentsOf('Joli brushing !')).toEqual([
      { text: 'Joli brushing !', isEmphasized: false },
    ]);
  });

  it('handles an emphasis in the middle, at the end, and several', () => {
    expect(emphasisSegmentsOf('Pas *si* près')).toEqual([
      { text: 'Pas ', isEmphasized: false },
      { text: 'si', isEmphasized: true },
      { text: ' près', isEmphasized: false },
    ]);
    expect(emphasisSegmentsOf('Quel *bazar*').at(-1)).toEqual({
      text: 'bazar',
      isEmphasized: true,
    });
    expect(emphasisSegmentsOf('*Encore* ce *brushing* ?!').filter((s) => s.isEmphasized)).toEqual([
      { text: 'Encore', isEmphasized: true },
      { text: 'brushing', isEmphasized: true },
    ]);
  });

  it('drops the empty runs (`**`) and gives nothing for an empty line', () => {
    expect(emphasisSegmentsOf('a**b')).toEqual([
      { text: 'a', isEmphasized: false },
      { text: 'b', isEmphasized: false },
    ]);
    expect(emphasisSegmentsOf('')).toEqual([]);
  });

  it('shows an unpaired asterisk as nothing and its run as plain, never as an emphasis', () => {
    expect(emphasisSegmentsOf('*Encore la nappe')).toEqual([
      { text: 'Encore la nappe', isEmphasized: false },
    ]);
    expect(emphasisSegmentsOf('*Encore* la *nappe')).toEqual([
      { text: 'Encore', isEmphasized: true },
      { text: ' la ', isEmphasized: false },
      { text: 'nappe', isEmphasized: false },
    ]);
  });
});

describe('appendEmphasizedText', () => {
  it('builds text nodes and em elements: Encore is inside an em, no asterisk is shown', () => {
    const parent = render("*Encore* l'escalier ?!");
    expect(shapeOf(parent)).toEqual(['<em>Encore</em>', " l'escalier ?!"]);
    expect(parent.textContent).toBe("Encore l'escalier ?!");
    expect(parent.textContent).not.toContain('*');
  });

  it('makes no em for a plain line', () => {
    const parent = render('Joli brushing !');
    expect(parent.children.map((child) => child.tag)).toEqual(['#text']);
    expect(parent.textContent).toBe('Joli brushing !');
  });

  it('keeps markup as text: a line is content, never HTML', () => {
    const parent = render('<img src=x onerror=alert(1)> *<b>fort</b>*');
    expect(parent.children.map((child) => child.tag)).toEqual(['#text', 'em']);
    expect(parent.textContent).toBe('<img src=x onerror=alert(1)> <b>fort</b>');
    expect(parent.children.some((child) => child.tag === 'img' || child.tag === 'b')).toBe(false);
  });

  it('appends after what the parent already holds and clears nothing', () => {
    const parent = new FakeNode('span');
    parent.append(new FakeNode('#text', 'avant '));
    appendEmphasizedText(parent as never, '*vite*', doc as never);
    expect(parent.textContent).toBe('avant vite');
  });
});
